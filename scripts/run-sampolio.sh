#!/bin/bash

# Sampolio Run Script
# Starts the Sampolio application

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Configuration
PORT="${SAMPOLIO_PORT:-3999}"
HOST="${SAMPOLIO_HOST:-0.0.0.0}"
DATA_DIR="${SAMPOLIO_DATA_DIR:-$HOME/.sampolio/data}"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo -e "${RED}Error: Node.js is not installed.${NC}"
    echo "Please install Node.js 18 or later from https://nodejs.org"
    exit 1
fi

# Check Node.js version (minimum 18)
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}Error: Node.js 18 or later is required.${NC}"
    echo "Current version: $(node -v)"
    exit 1
fi

# Create data directory if it doesn't exist
mkdir -p "$DATA_DIR"

# Check if server.js exists
if [ ! -f "$SCRIPT_DIR/server.js" ]; then
    echo -e "${RED}Error: server.js not found. Make sure you're running from the correct directory.${NC}"
    exit 1
fi

# Generate a random AUTH_SECRET if not set
if [ -z "$AUTH_SECRET" ]; then
    # Try to read from saved config
    CONFIG_FILE="$DATA_DIR/.auth_secret"
    if [ -f "$CONFIG_FILE" ]; then
        export AUTH_SECRET=$(cat "$CONFIG_FILE")
    else
        # Generate a new secret and save it
        export AUTH_SECRET=$(openssl rand -base64 32)
        echo "$AUTH_SECRET" > "$CONFIG_FILE"
        chmod 600 "$CONFIG_FILE"
        echo -e "${YELLOW}Generated new AUTH_SECRET (saved for future runs)${NC}"
    fi
fi

echo -e "${GREEN}=== Starting Sampolio ===${NC}"
echo ""
echo "  Port: $PORT"
echo "  Data: $DATA_DIR"
echo ""
echo -e "${GREEN}Open your browser at: http://localhost:$PORT${NC}"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

# Set environment variables and start the server
export PORT="$PORT"
export HOSTNAME="$HOST"
export DATA_DIR="$DATA_DIR"
export NODE_ENV="production"

# Run the Next.js standalone server
exec node "$SCRIPT_DIR/server.js"
