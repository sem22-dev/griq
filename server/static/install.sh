#!/bin/bash
set -e

# Define variables
URL_PREFIX="https://github.com/sem22-dev/griq/releases/download/v1.0.0"
INSTALL_DIR="/usr/local/bin"
DEFAULT_SERVER="wss://griq.site/"
FILENAME="griq.js"
WRAPPER_FILE="$INSTALL_DIR/griq"

echo "🚀 Installing Griq Tunneling Service"
echo "📦 Downloading $FILENAME..."

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

# Download the bundled JS file
if ! curl -sSLf "$URL_PREFIX/$FILENAME" -o "$INSTALL_DIR/$FILENAME"; then
  echo "❌ Failed to write to $INSTALL_DIR; trying with sudo..." >&2
  if ! sudo curl -sSLf "$URL_PREFIX/$FILENAME" -o "$INSTALL_DIR/$FILENAME"; then
    echo "❌ Installation failed. Please try again with sudo privileges." >&2
    exit 1
  fi
fi

echo "✅ Downloaded $FILENAME to $INSTALL_DIR"

# Create a wrapper script to run with Node.js
echo "📄 Creating wrapper script..."

sudo bash -c "cat > $WRAPPER_FILE" << EOF
#!/bin/bash
node "$INSTALL_DIR/$FILENAME" "\$@"
EOF

# Make the wrapper executable
if ! sudo chmod +x "$WRAPPER_FILE"; then
  echo "❌ Failed to set executable permission on $WRAPPER_FILE" >&2
  exit 1
fi

echo "✅ Griq is successfully installed!"
echo ""
echo "🔰 Quick start:"
echo "   griq http 3000       # Expose port 3000"
echo ""
echo "📚 For more information, visit: https://github.com/sem22-dev/griq"
echo "⚠️ Note: Requires Node.js to be installed (https://nodejs.org/)"
