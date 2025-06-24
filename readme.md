# GRIQ

**GRIQ** is a lightweight HTTP tunneling service, now powered by Python, that allows you to expose your local servers to the internet through secure tunnels.

---

## Features

* 🚀 Expose local servers to the internet instantly
* 🔀 Custom subdomains for better branding
* 🌐 WebSocket support for real-time communication
* ⚡ Lightweight Python-based client with minimal dependencies
* 🔄 Automatic reconnection for reliable connections
* 💻 User-friendly CLI with real-time status updates

---

## Quick Install

GRIQ requires **Python 3** and **pip**. Choose your preferred installation method:

### Via pip (Recommended)

```bash
pip3 install git+https://github.com/sem22-dev/griq.git
```

### Via Install Script (Alternative)

```bash
curl -fsSL https://griq.site/install.sh | bash
```

Once installed, create a tunnel with:

```bash
griq http 3000    # Expose localhost:3000
```

This will give you a public URL like:

```
https://[random-subdomain].griq.site
```

---

## Project Structure

```
/GRIQ
  /client
    - __init__.py      # Python package marker
    - cli.py           # CLI entry point and commands
    - client.py        # Client implementation
  /server
    - index.ts         # Server entry point
    - server.ts        # Server implementation
  /shared
    - types.ts         # Shared type definitions
    - utils.ts         # Shared utility functions
  - setup.py           # Python package setup
  - README.md          # Documentation
  - .gitignore         # Git ignore file
  - install.sh         # Installation script
```

---

## Roadmap

* User authentication and authorization
* HTTPS support
* Custom domain mapping
* Request/response logging
* Rate limiting
* API for programmatic access
* Support for serving static files

---

## Security Notice

⚠️ **Currently, GRIQ does not include authentication. Authentication will be added in a future update.**

---

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request or open an issue on GitHub.

---

