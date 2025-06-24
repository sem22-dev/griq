import asyncio
import gzip
import json
import websockets
import http.client
from typing import Dict, Callable, Optional
import os
import logging

class TunnelClient:
    def __init__(self, local_port: int, subdomain: Optional[str] = None, server_url: str = "wss://griq.site/"):
        self.local_port = local_port
        self.subdomain = subdomain
        self.public_url = ""
        self.reconnect_attempts = 0
        self.max_reconnect_attempts = 5
        self.pending_requests: Dict[str, Callable] = {}
        self.ws = None
        self.logger = logging.getLogger(__name__)
        logging.basicConfig(level=logging.INFO)

        # Config setup
        config_dir = os.path.expanduser("~/.griq")
        config_file = os.path.join(config_dir, "config.json")
        self.server_url = server_url  # Use provided URL or default
        if not os.path.exists(config_dir):
            os.makedirs(config_dir)
        if os.path.exists(config_file):
            try:
                with open(config_file, "r") as f:
                    config = json.load(f)
                self.server_url = config.get("server_url", self.server_url)
            except json.JSONDecodeError:
                self.logger.warning("Invalid config file, using default server URL")
        self.logger.info(f"Using server URL: {self.server_url}")

    async def connect_to_server(self):
        self.logger.info("Connecting to tunnel server...")
        while self.reconnect_attempts < self.max_reconnect_attempts:
            try:
                self.ws = await websockets.connect(self.server_url)
                self.reconnect_attempts = 0
                self.logger.info("Connected to tunnel server")
                await self.register()
                async for message in self.ws:
                    await self.handle_message(message)
            except Exception as e:
                self.logger.error(f"Connection failed: {e}")
                await self.attempt_reconnect()

    async def register(self):
        register_message = {
            "type": "register",
            "port": self.local_port,
            "subdomain": self.subdomain
        }
        await self.ws.send(json.dumps(register_message))

    async def handle_message(self, message):
        data = json.loads(message)
        if data["type"] == "registered":
            self.public_url = data["url"]
            self.logger.info(f"Tunnel established at: {self.public_url}")
        elif data["type"] == "tunnel":
            await self.handle_tunnel_request(data["data"])

    async def attempt_reconnect(self):
        self.reconnect_attempts += 1
        delay = min(1000 * (2 ** self.reconnect_attempts), 30000) / 1000
        self.logger.info(f"Attempting to reconnect in {delay} seconds...")
        await asyncio.sleep(delay)
        await self.connect_to_server()

    async def handle_tunnel_request(self, request):
        conn = http.client.HTTPConnection("localhost", self.local_port)
        conn.request(request["method"], request["path"], body=request.get("body"), headers=request["headers"])
        response = conn.getresponse()
        chunks = []
        while True:
            chunk = response.read(8192)
            if not chunk:
                break
            chunks.append(chunk)
        full_response = b"".join(chunks)
        is_gzip = response.getheader("content-encoding", "").lower() == "gzip"
        if is_gzip:
            full_response = gzip.decompress(full_response)
        tunnel_response = {
            "id": request["id"],
            "statusCode": response.status,
            "headers": dict(response.getheaders()),
            "body": full_response.decode('utf-8') if isinstance(full_response, bytes) else full_response
        }
        await self.ws.send(json.dumps({"type": "tunnel", "data": tunnel_response}))
        conn.close()

    def get_public_url(self):
        return self.public_url

    async def close(self):
        if self.ws:
            await self.ws.close()