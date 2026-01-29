#!/bin/bash

# Sampolio Build and Package Script
# Creates a distributable zip file in /dist folder

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get script directory (project root)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

echo -e "${YELLOW}=== Sampolio Build & Package Script ===${NC}"
echo ""

# Check if pnpm is installed
if ! command -v pnpm &> /dev/null; then
    echo -e "${RED}Error: pnpm is not installed. Please install it first.${NC}"
    exit 1
fi

# Check if node is installed
if ! command -v node &> /dev/null; then
    echo -e "${RED}Error: Node.js is not installed. Please install it first.${NC}"
    exit 1
fi

NODE_VERSION=$(node -v)
echo -e "${GREEN}Using Node.js: $NODE_VERSION${NC}"

# Get version from package.json
VERSION=$(node -e "console.log(require('./package.json').version)")
echo -e "${GREEN}Building Sampolio version: $VERSION${NC}"
echo ""

# Step 1: Install dependencies
echo -e "${YELLOW}Step 1/5: Installing dependencies...${NC}"
pnpm install --frozen-lockfile

# Step 2: Run type check
echo -e "${YELLOW}Step 2/5: Running type check...${NC}"
pnpm exec tsc --noEmit

# Step 3: Build the application
echo -e "${YELLOW}Step 3/5: Building the application...${NC}"
pnpm build

# Step 4: Prepare distribution folder
echo -e "${YELLOW}Step 4/5: Preparing distribution package...${NC}"

DIST_DIR="$PROJECT_ROOT/dist"
PACKAGE_DIR="$DIST_DIR/sampolio"
ZIP_NAME="sampolio-v${VERSION}-macos.zip"

# Clean up previous builds
rm -rf "$DIST_DIR"
mkdir -p "$PACKAGE_DIR"

# Copy standalone build
cp -r "$PROJECT_ROOT/.next/standalone/"* "$PACKAGE_DIR/"

# Copy static files
if [ -d "$PROJECT_ROOT/.next/static" ]; then
    mkdir -p "$PACKAGE_DIR/.next/static"
    cp -r "$PROJECT_ROOT/.next/static/"* "$PACKAGE_DIR/.next/static/"
fi

# Copy public folder
if [ -d "$PROJECT_ROOT/public" ]; then
    mkdir -p "$PACKAGE_DIR/public"
    cp -r "$PROJECT_ROOT/public/"* "$PACKAGE_DIR/public/"
fi

# Copy the run/install scripts
cp "$SCRIPT_DIR/run-sampolio.sh" "$PACKAGE_DIR/"
cp "$SCRIPT_DIR/install-launchd.sh" "$PACKAGE_DIR/"
cp "$SCRIPT_DIR/uninstall-launchd.sh" "$PACKAGE_DIR/"
chmod +x "$PACKAGE_DIR/"*.sh

# Create a simple README for the distribution
cat > "$PACKAGE_DIR/README.txt" << 'EOF'
=== Sampolio - Personal Finance Manager ===

QUICK START:
1. Run the app: ./run-sampolio.sh
2. Open browser: http://localhost:3999

AUTO-START ON LOGIN:
1. Run: ./install-launchd.sh
2. The app will start automatically when you log in

TO STOP AUTO-START:
1. Run: ./uninstall-launchd.sh

CONFIGURATION:
- Default port: 3999
- Data is stored in: ~/.sampolio/data/
- Set AUTH_SECRET environment variable for production security

REQUIREMENTS:
- Node.js 18 or later

For more information, visit the project repository.
EOF

# Step 5: Create zip archive
echo -e "${YELLOW}Step 5/5: Creating zip archive...${NC}"
cd "$DIST_DIR"
zip -r "$ZIP_NAME" "sampolio"

# Clean up unzipped folder
rm -rf "$PACKAGE_DIR"

echo ""
echo -e "${GREEN}=== Build Complete! ===${NC}"
echo -e "${GREEN}Package created: $DIST_DIR/$ZIP_NAME${NC}"
echo ""
echo "To install elsewhere:"
echo "  1. Copy the zip file to the target machine"
echo "  2. Unzip: unzip $ZIP_NAME"
echo "  3. Run: cd sampolio && ./run-sampolio.sh"
echo "  4. (Optional) Install auto-start: ./install-launchd.sh"
