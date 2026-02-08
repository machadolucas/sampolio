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

# Copy standalone build (dereference symlinks so the package is fully self-contained;
# exit code 23 = some dangling symlinks were skipped, which is harmless)
rsync -aL "$PROJECT_ROOT/.next/standalone/" "$PACKAGE_DIR/" || {
    rc=$?
    if [ $rc -eq 23 ]; then
        echo -e "${YELLOW}Warning: Some dangling symlinks were skipped (harmless).${NC}"
    else
        exit $rc
    fi
}

# Copy static files
if [ -d "$PROJECT_ROOT/.next/static" ]; then
    mkdir -p "$PACKAGE_DIR/.next/static"
    rsync -a "$PROJECT_ROOT/.next/static/" "$PACKAGE_DIR/.next/static/"
fi

# Copy public folder
if [ -d "$PROJECT_ROOT/public" ]; then
    mkdir -p "$PACKAGE_DIR/public"
    rsync -a "$PROJECT_ROOT/public/" "$PACKAGE_DIR/public/"
fi

# Copy the run/install scripts
cp "$SCRIPT_DIR/run-sampolio.sh" "$PACKAGE_DIR/"
cp "$SCRIPT_DIR/install-launchd.sh" "$PACKAGE_DIR/"
cp "$SCRIPT_DIR/uninstall-launchd.sh" "$PACKAGE_DIR/"
chmod +x "$PACKAGE_DIR/"*.sh

# Create .env.example file
cat > "$PACKAGE_DIR/.env.example" << 'EOF'
# Sampolio Configuration
# Copy this file to .env and fill in your values

# Authentication secret (required) - generate with: openssl rand -base64 32
AUTH_SECRET=your-auth-secret-here

# Encryption key (required) - generate with: openssl rand -hex 32
# WARNING: Changing this will make existing data unreadable!
ENCRYPTION_KEY=your-encryption-key-here

# Optional: Custom port (default: 3999)
#SAMPOLIO_PORT=3999

# Optional: Custom host (default: 0.0.0.0)
#SAMPOLIO_HOST=0.0.0.0

# Optional: Custom data directory (default: ~/.sampolio/data)
#SAMPOLIO_DATA_DIR=/path/to/data

# Optional: Public URL (required if behind a reverse proxy)
# This tells NextAuth the correct URL for redirects
#AUTH_URL=https://sampolio.example.com
EOF

# Create a simple README for the distribution
cat > "$PACKAGE_DIR/README.txt" << 'EOF'
=== Sampolio - Personal Finance Manager ===

QUICK START:

Method 1: Auto-generated secrets (simplest)
  1. Run: ./run-sampolio.sh
  2. Open: http://localhost:3999
  Secrets will be auto-generated and saved in ~/.sampolio/data/

Method 2: Fixed secrets (recommended for production)
  1. Copy .env.example to .env
  2. Generate secrets:
       openssl rand -base64 32    # Use for AUTH_SECRET
       openssl rand -hex 32       # Use for ENCRYPTION_KEY
  3. Edit .env and paste the generated secrets
  4. Run: ./run-sampolio.sh
  5. Open: http://localhost:3999

AUTO-START ON LOGIN:
  ./install-launchd.sh
  The app will start automatically when you log in.

TO STOP AUTO-START:
  ./uninstall-launchd.sh

IMPORTANT NOTES:
- Keep your .env file secure and backed up!
- Changing ENCRYPTION_KEY will make existing data unreadable
- Changing AUTH_SECRET will invalidate all user sessions
- Never commit .env file to version control

MIGRATING DATA:
If you have existing data on another server:
  1. Copy .env file from original server
  2. Copy ~/.sampolio/data/ directory
  3. Use the same .env file on new server

CONFIGURATION:
- Default port: 3999
- Data directory: ~/.sampolio/data/
- Logs (when using launchd): ~/.sampolio/logs/

REQUIREMENTS:
- Node.js 20 or later

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
