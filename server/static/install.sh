#!/bin/bash
set -e

# Define variables
URL_PREFIX="https://github.com/sem22-dev/griq/releases/download/v1.0.0"
INSTALL_DIR="/usr/local/bin"
DEFAULT_SERVER="wss://griq.site/"
FILENAME="griq.js"

echo "🚀 Installing Griq Tunneling Service"
echo "📦 Downloading $FILENAME..."

# Create config directory if it doesn’t exist
CONFIG_DIR="$HOME/.griq"
mkdir -p "$CONFIG_DIR"

# Create config file with default server URL
echo "{\"server_url\":\"$DEFAULT_SERVER\"}" > "$CONFIG_DIR/config.json"
echo "✅ Created default configuration in $CONFIG_DIR"

# Download the bundled JS file
if ! curl -sSLf "$URL_PREFIX/$FILENAME" -o "$INSTALL_DIR/griq.js"; then
  echo "❌ Failed to write to $INSTALL_DIR; trying with sudo..." >&2
  if ! sudo curl -sSLf "$URL_PREFIX/$FILENAME" -o "$INSTALL_DIR/griq.js"; then
    echo "❌ Installation failed. Please try again with sudo privileges." >&2
    exit 1
  fi
fi

# Create a wrapper script to run with Node.js
cat << 'EOF' > "$INSTALL_DIR/griq"
#!/bin/bash
node "$INSTALL_DIR/griq.js" "$@"
EOF

# Make the wrapper executable
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
echo "📚 For more information, visit: https://github.com/sem22-dev/griq"
echo "⚠️ Note: Requires Node.js to be installed (https://nodejs.org/)"