#!/bin/bash
set -e
# Define variables
URL_PREFIX="http://localhost:8000/dist/bin"  # Point to your local dist/bin directory
INSTALL_DIR="/usr/local/bin"
DEFAULT_SERVER="ws://localhost:8000/"  # For local testing, use your local server

# Determine system architecture
case "$(uname -sm)" in
  "Darwin x86_64") FILENAME="griq-darwin-amd64" ;;
  "Darwin arm64") FILENAME="griq-darwin-arm64" ;;
  "Linux x86_64") FILENAME="griq-linux-amd64" ;;
  "Linux i686") FILENAME="griq-linux-386" ;;
  "Linux armv7l") FILENAME="griq-linux-arm" ;;
  "Linux aarch64") FILENAME="griq-linux-arm64" ;;
  *) echo "Unsupported architecture: $(uname -sm)" >&2; exit 1 ;;
esac

echo "🚀 Installing Griq Tunneling Service"
echo "📦 Downloading $FILENAME from local server..."

# Create config directory if it doesn't exist
CONFIG_DIR="$HOME/.griq"
mkdir -p "$CONFIG_DIR"

# Create config file with default server URL
echo "{\\\"server_url\\\":\\\"$DEFAULT_SERVER\\\"}" > "$CONFIG_DIR/config.json"
echo "✅ Created default configuration in $CONFIG_DIR"

# Download the binary
if ! curl -sSLf "$URL_PREFIX/$FILENAME" -o "$INSTALL_DIR/griq"; then
  echo "❌ Failed to write to $INSTALL_DIR; trying with sudo..." >&2
  if ! sudo curl -sSLf "$URL_PREFIX/$FILENAME" -o "$INSTALL_DIR/griq"; then
    echo "❌ Installation failed. Please try again with sudo privileges." >&2
    exit 1
  fi
fi

# Make binary executable
if ! chmod +x "$INSTALL_DIR/griq"; then
  echo "❌ Failed to set executable permission on $INSTALL_DIR/griq" >&2
  if ! sudo chmod +x "$INSTALL_DIR/griq"; then
    echo "❌ Installation failed. Please try again with sudo privileges." >&2
    exit 1
  fi
fi

echo "✅ Griq is successfully installed!"
echo ""
echo "🔰 Quick start:"
echo "   griq http 3000       # Expose port 3000"
echo ""
echo "📚 For more information, visit: http://localhost:8000"