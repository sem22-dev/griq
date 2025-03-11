# GRIQ 

GRIQ is a lightweight HTTP tunneling service that allows you to expose your local servers to the internet through secure tunnels.

---

## Features

- 🚀 **Expose local servers** to the internet instantly  
- 🔀 **Custom subdomains** for better branding  
- 📁 **Static file serving** built-in  
- 🔄 **Automatic reconnection** for reliable connections  
- 💻 **User-friendly CLI** with real-time status updates  
- 🌐 **WebSocket support** for real-time communication  
- ⚡ **Lightweight client** with minimal dependencies  

---

### Quick Install

One-line installation:

```bash
curl -fsSL https://griq.site/install.sh | bash
```

Once installed, create a tunnel with:

```bash
griq http 3000    # Expose localhost:3000
```

This will give you a public URL like:

```
http://[random-subdomain].griq.site
```

---

## Project Structure

```
/GRIQ
  /cli
    - index.ts         # CLI entry point and commands
    - client.ts        # Client implementation
  /server
    - index.ts         # Server entry point
    - server.ts        # Server implementation
  /shared
    - types.ts         # Shared type definitions
    - utils.ts         # Shared utility functions
  - package.json       # Main package file
  - README.md          # Documentation
  - .gitignore         # Git ignore file
```

---

## Roadmap

- [ ] User authentication and authorization  
- [ ] HTTPS support  
- [ ] Custom domain mapping  
- [ ] Request/response logging  
- [ ] Rate limiting  
- [ ] API for programmatic access  

---

## Security Notice

⚠️ **Currently, GRIQ does not include authentication.** Authentication will be added in a future update.

---

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

