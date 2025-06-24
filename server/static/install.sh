#!/bin/bash
set -e

# Define variables
VERSION="v1.1.0"  # Update to match your GitHub release tag
URL_PREFIX="https://github.com/sem22-dev/griq/releases/download/$VERSION"
INSTALL_DIR="$HOME/.local/bin"  # Use user-writable dir instead of /usr/local/bin
DEFAULT_SERVER="wss://griq.site/"
BINARY="griq"

# Detect OS and architecture
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
if [ "$OS" = "linux" ]; then
  BINARY="griq-linux-$ARCH"
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

echo "🚀 Installing Griq Tunneling Service (Python Edition)"
echo "📦 Setting up environment..."

# Ensure pip is installed
if ! command -v pip3 &> /dev/null; then
  echo "❌ pip3 not found. Please install Python 3 and pip." >&2
  exit 1
fi

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

# Option 1: Install via pip (preferred for Python package)
echo "📥 Installing Griq via pip..."
if ! pip3 install --user git+https://github.com/sem22-dev/griq.git@$VERSION; then
  echo "❌ Pip installation failed. Falling back to binary download..." >&2
  # Option 2: Download prebuilt binary as fallback
  if ! curl -sSLf "$URL_PREFIX/$BINARY" -o "$INSTALL_DIR/griq"; then
    echo "❌ Failed to download binary. Please try again with sudo or check the release." >&2
    exit 1
  fi
  chmod +x "$INSTALL_DIR/griq"
fi

# Ensure INSTALL_DIR is in PATH
if ! echo "$PATH" | grep -q "$INSTALL_DIR"; then
  echo "🔧 Adding $INSTALL_DIR to PATH in ~/.zshrc"
  echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
  source ~/.zshrc
fi

echo "✅ Griq is successfully installed!"
echo ""
echo "🔰 Quick start:"
echo "   griq http 3000       # Expose port 3000"
echo ""
echo "📚 For more information, visit: https://github.com/sem22-dev/griq"