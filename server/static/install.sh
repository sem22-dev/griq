#!/bin/bash
set -e

# Define variables
VERSION="v1.0.0"
URL_PREFIX="https://github.com/sem22-dev/griq/releases/download/$VERSION"
INSTALL_DIR="/usr/local/bin"
DEFAULT_SERVER="wss://griq.site/"
BINARY="griq"
WRAPPER_FILE="$INSTALL_DIR/griq"

# Detect OS and architecture
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
if [ "$OS" = "linux" ]; then
  BINARY="griq-ubuntu"
elif [ "$OS" = "darwin" ]; then
  if [ "$ARCH" = "arm64" ]; then
    BINARY="griq-macos-arm64"
  else
    BINARY="griq-macos-x64"
  fi
else
  echo "❌ Unsupported OS: $OS" >&2
  exit 1
fi

echo "🚀 Installing Griq Tunneling Service"
echo "📦 Downloading $BINARY..."

# Create config directory if it doesn’t exist
CONFIG_DIR="$HOME/.griq"
mkdir -p "$CONFIG_DIR"

# Create config file with default server URL if not exists
if [ ! -f "$CONFIG_DIR/config.json" ]; then
  echo "{\"server_url\":\"$DEFAULT_SERVER\"}" > "$CONFIG_DIR/config.json"
  echo "✅ Created default configuration in $CONFIG_DIR"
else
  echo "⚙️  Configuration already exists at $CONFIG_DIR/config.json"
fi

# Download the binary
if ! curl -sSLf "$URL_PREFIX/$BINARY" -o "$INSTALL_DIR/griq"; then
  echo "❌ Failed to write to $INSTALL_DIR; trying with sudo..." >&2
  if ! sudo curl -sSLf "$URL_PREFIX/$BINARY" -o "$INSTALL_DIR/griq"; then
    echo "❌ Installation failed. Please try again with sudo privileges." >&2
    exit 1
  fi
fi

# Make the binary executable
if ! sudo chmod +x "$INSTALL_DIR/griq"; then
  echo "❌ Failed to set executable permission on $INSTALL_DIR/griq" >&2
  exit 1
fi

echo "✅ Griq is successfully installed!"
echo ""
echo "🔰 Quick start:"
echo "   griq http 3000       # Expose port 3000"
echo ""
echo "📚 For more information, visit: https://github.com/sem22-dev/griq"