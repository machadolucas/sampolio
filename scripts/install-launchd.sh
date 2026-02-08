#!/bin/bash

# Sampolio launchd Installation Script
# Adds Sampolio to start automatically on macOS login

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Get script directory (installation directory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Configuration
PLIST_NAME="com.sampolio.app"
PLIST_FILE="$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"
LOG_DIR="$HOME/.sampolio/logs"
DATA_DIR="$HOME/.sampolio/data"

echo -e "${YELLOW}=== Sampolio Auto-Start Installation ===${NC}"
echo ""

# Check if Node.js is installed and get its path
NODE_PATH=$(which node 2>/dev/null || echo "")
if [ -z "$NODE_PATH" ]; then
    echo -e "${RED}Error: Node.js is not installed.${NC}"
    echo "Please install Node.js first."
    exit 1
fi

echo "Node.js found at: $NODE_PATH"
echo "Installation directory: $SCRIPT_DIR"
echo ""

# Create log directory
mkdir -p "$LOG_DIR"
mkdir -p "$DATA_DIR"

# Check if already installed
if [ -f "$PLIST_FILE" ]; then
    echo -e "${YELLOW}Existing installation found. Updating...${NC}"
    launchctl unload "$PLIST_FILE" 2>/dev/null || true
fi

# Load .env file if it exists
if [ -f "$SCRIPT_DIR/.env" ]; then
    echo -e "${GREEN}Loading environment variables from .env file...${NC}"
    # Source variables from .env file
    set -a
    source "$SCRIPT_DIR/.env"
    set +a
fi

# Read or generate AUTH_SECRET
if [ -z "$AUTH_SECRET" ]; then
    CONFIG_FILE="$DATA_DIR/.auth_secret"
    if [ -f "$CONFIG_FILE" ]; then
        AUTH_SECRET=$(cat "$CONFIG_FILE")
    else
        AUTH_SECRET=$(openssl rand -base64 32)
        echo "$AUTH_SECRET" > "$CONFIG_FILE"
        chmod 600 "$CONFIG_FILE"
    fi
fi

# Read or generate ENCRYPTION_KEY
if [ -z "$ENCRYPTION_KEY" ]; then
    ENCRYPTION_CONFIG_FILE="$DATA_DIR/.encryption_key"
    if [ -f "$ENCRYPTION_CONFIG_FILE" ]; then
        ENCRYPTION_KEY=$(cat "$ENCRYPTION_CONFIG_FILE")
    else
        ENCRYPTION_KEY=$(openssl rand -hex 32)
        echo "$ENCRYPTION_KEY" > "$ENCRYPTION_CONFIG_FILE"
        chmod 600 "$ENCRYPTION_CONFIG_FILE"
    fi
fi

# Create the LaunchAgents directory if it doesn't exist
mkdir -p "$HOME/Library/LaunchAgents"

# Create the plist file
cat > "$PLIST_FILE" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_NAME}</string>
    
    <key>ProgramArguments</key>
    <array>
        <string>${NODE_PATH}</string>
        <string>${SCRIPT_DIR}/server.js</string>
    </array>
    
    <key>WorkingDirectory</key>
    <string>${SCRIPT_DIR}</string>
    
    <key>EnvironmentVariables</key>
    <dict>
        <key>PORT</key>
        <string>3999</string>
        <key>HOSTNAME</key>
        <string>0.0.0.0</string>
        <key>NODE_ENV</key>
        <string>production</string>
        <key>DATA_DIR</key>
        <string>${DATA_DIR}</string>
        <key>AUTH_SECRET</key>
        <string>${AUTH_SECRET}</string>
        <key>ENCRYPTION_KEY</key>
        <string>${ENCRYPTION_KEY}</string>
        <key>AUTH_TRUST_HOST</key>
        <string>true</string>${AUTH_URL:+
        <key>AUTH_URL</key>
        <string>${AUTH_URL}</string>}
    </dict>
    
    <key>RunAtLoad</key>
    <true/>
    
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    
    <key>StandardOutPath</key>
    <string>${LOG_DIR}/sampolio.log</string>
    
    <key>StandardErrorPath</key>
    <string>${LOG_DIR}/sampolio-error.log</string>
    
    <key>ProcessType</key>
    <string>Background</string>
</dict>
</plist>
EOF

# Set proper permissions
chmod 644 "$PLIST_FILE"

# Load the launch agent
launchctl load "$PLIST_FILE"

echo -e "${GREEN}=== Installation Complete! ===${NC}"
echo ""
echo "Sampolio has been installed and is now running!"
echo ""
echo "  Web Interface: http://localhost:3999"
echo "  Logs:          $LOG_DIR/sampolio.log"
echo "  Data:          $DATA_DIR"
echo ""
echo "The app will automatically start when you log in."
echo ""
echo "To check status:   launchctl list | grep sampolio"
echo "To stop:           launchctl unload $PLIST_FILE"
echo "To start:          launchctl load $PLIST_FILE"
echo "To uninstall:      ./uninstall-launchd.sh"
