import asyncio
import sys
from argparse import ArgumentParser
from client.client import TunnelClient

def main():
      if len(sys.argv) < 2:
          print("Usage: griq http <port> [--subdomain SUBDOMAIN] [--url URL]")
          sys.exit(1)
      command = sys.argv[1]
      if command == "http":
          parser = ArgumentParser(description="Expose a local HTTP server")
          parser.add_argument("port", type=int, help="Local port to expose")
          parser.add_argument("--subdomain", "-s", help="Custom subdomain")
          parser.add_argument("--url", "-u", default="wss://griq.site/", help="Tunnel server URL")
          args = parser.parse_args(sys.argv[2:])
          try:
              asyncio.run(run_client(args.port, args.subdomain, args.url))
          except Exception as e:
              print(f"Error: {e}")
              sys.exit(1)

async def run_client(port, subdomain, url):
      client = TunnelClient(port, subdomain, url)
      try:
        await client.connect_to_server()
      except Exception as e:
          print(f"Connection error: {e}")
          raise

if __name__ == "__main__":
      main()