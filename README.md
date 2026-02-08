# Sampolio - Personal Finance Planner

A personal finance planning tool that replaces your budgeting spreadsheet with a cleaner, more powerful workflow.

## Features

- **Multi-Account Support**: Manage multiple financial accounts independently (e.g., checking, savings, investment accounts)
- **Recurring Income & Expenses**: Track fixed monthly items like salary, rent, subscriptions with start/end dates
- **Planned Items**: One-off expenses (taxes, annual fees) and repeating non-monthly items (quarterly payments)
- **Salary Calculator**: Net salary calculation with deductions, bonuses, and automatic linking to recurring income
- **Multi-Year Projections**: See your financial future up to 10 years ahead with instant recalculation
- **User Management**: Admin panel for managing users and app settings
- **Role-Based Access**: Admin and user roles with first-user-becomes-admin logic
- **Self-Signup Control**: Admins can enable/disable public registration
- **Secure & Private**: File-based encrypted storage - your data stays on your server
- **Single File Deployment**: Deploy as a standalone package - no external database needed

## Getting Started

### Prerequisites

- Node.js 20+ 
- pnpm (recommended) or npm

### Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/sampolio.git
cd sampolio
```

2. Install dependencies:
```bash
pnpm install
```

3. Set up environment variables:
```bash
cp .env.example .env.local
```

4. Generate secrets (update `.env.local` with these values):
```bash
# Generate AUTH_SECRET
openssl rand -base64 32

# Generate ENCRYPTION_KEY  
openssl rand -hex 32
```

5. Run the development server:
```bash
pnpm dev
```

6. Open [http://localhost:3999](http://localhost:3999) and create your account

> **Note**: The first user to sign up automatically becomes an admin.

## Development

### VS Code Setup

This project includes VS Code configuration for debugging and running tasks.

#### Debug Configurations (`.vscode/launch.json`)

- **Next.js: debug server-side** - Debug server-side code with Chrome auto-open
- **Next.js: debug client-side** - Debug client-side code in Chrome
- **Next.js: debug full stack** - Combined server and client debugging
- **Next.js: run production build** - Build and run in production mode

To use: Open the Run and Debug panel (Cmd+Shift+D) and select a configuration.

#### Tasks (`.vscode/tasks.json`)

| Task | Description | Shortcut |
|------|-------------|----------|
| `dev` | Start development server | Default build task |
| `build` | Create production build | - |
| `start` | Start production server | - |
| `lint` | Run ESLint | - |
| `type-check` | Run TypeScript type checking | - |
| `package` | Build and create distributable zip | - |

To run: Use Command Palette (Cmd+Shift+P) → "Tasks: Run Task"

## Production Deployment

### Build for Production

```bash
pnpm build
```

This creates a standalone build in `.next/standalone` that includes everything needed to run the app.

### Run Production Build

```bash
node .next/standalone/server.js
```

### macOS Standalone Deployment

Build and package the app into a distributable zip file:

```bash
./scripts/build-package.sh
```

This creates `/dist/sampolio-v{version}-macos.zip` containing:
- Standalone Next.js server
- Static assets
- Run and install scripts

#### Installing on macOS

1. Copy the zip file to the target machine
2. Unzip:
```bash
unzip sampolio-v0.1.0-macos.zip
cd sampolio
```

3. Run manually:
```bash
./run-sampolio.sh
```

4. Or install as auto-starting service:
```bash
./install-launchd.sh
```

The app will start automatically when you log in.

#### Environment Variables on Deployment

**Recommended: Using .env File** (ensures secrets stay consistent)

The package includes a `.env.example` template. Create your `.env` file with fixed secrets:

```bash
# In the deployment directory
cp .env.example .env

# Generate your secrets
echo "AUTH_SECRET=$(openssl rand -base64 32)" >> .env
echo "ENCRYPTION_KEY=$(openssl rand -hex 32)" >> .env

# Edit .env to verify values
nano .env
```

Then run normally:
```bash
./run-sampolio.sh  # or ./install-launchd.sh
```

⚠️ **Important**: 
- Keep your `.env` file secure and backed up
- Never change `ENCRYPTION_KEY` - existing data will be unreadable
- Never commit `.env` to version control

**Alternative: Auto-Generated Secrets**

If you don't provide a `.env` file, secrets are auto-generated on first run:
- `AUTH_SECRET`: Stored in `~/.sampolio/data/.auth_secret`
- `ENCRYPTION_KEY`: Stored in `~/.sampolio/data/.encryption_key`

**Optional Environment Variables** (in .env or as exports):
```bash
SAMPOLIO_PORT=3999                    # Server port (default: 3999)
SAMPOLIO_HOST=0.0.0.0                # Server host (default: 0.0.0.0)
SAMPOLIO_DATA_DIR=~/.sampolio/data   # Data directory
```

**Migrating Data Between Servers**:

⚠️ **Important**: Use the same `ENCRYPTION_KEY` to decrypt existing data.

**Method 1: Copy .env file and data** (simplest):
```bash
# On source server, backup everything
tar -czf sampolio-backup.tar.gz -C /path/to/sampolio .env -C ~/.sampolio data

# Transfer to new server
scp sampolio-backup.tar.gz new-server:~/

# On new server, extract
cd /path/to/new/sampolio
tar -xzf ~/sampolio-backup.tar.gz

# The .env file from source server is now in place
./run-sampolio.sh
```

**Method 2: Using auto-generated secrets**:
```bash
# On source server, backup secrets and data
tar -czf sampolio-backup.tar.gz -C ~/.sampolio data

# Transfer to new server
scp sampolio-backup.tar.gz new-server:~/

# On new server, extract before first run
cd ~
mkdir -p .sampolio
tar -xzf sampolio-backup.tar.gz -C .sampolio

# Run - will use existing .auth_secret and .encryption_key files
cd /path/to/sampolio
./run-sampolio.sh
```

#### Upgrading to a New Version

When you develop and release a new version, follow these steps to upgrade the server:

**1. Build the new version** (on development machine):
```bash
./scripts/build-package.sh
```

**2. Transfer to server**:
```bash
scp dist/sampolio-v*.zip server:~/
```

**3. On the server, backup your configuration and data**:
```bash
# Backup .env file (contains your secrets)
cp /path/to/current/sampolio/.env ~/sampolio-config-backup.env

# Optional: Backup data (recommended before major upgrades)
tar -czf ~/sampolio-data-backup-$(date +%Y%m%d).tar.gz -C ~/.sampolio data
```

**4. Stop the running app** (if using launchd):
```bash
cd /path/to/current/sampolio
./uninstall-launchd.sh
```

Or if running manually, press `Ctrl+C` to stop.

**5. Extract new version**:
```bash
cd ~
unzip sampolio-v*.zip
# Optionally rename: mv sampolio sampolio-v1.2.0
```

**6. Restore your .env file**:
```bash
cd ~/sampolio  # or your versioned directory
cp ~/sampolio-config-backup.env .env
```

**7. Start the new version**:
```bash
./run-sampolio.sh  # or ./install-launchd.sh for auto-start
```

**8. Verify the upgrade**:
```bash
# Check logs if using launchd
tail -f ~/.sampolio/logs/sampolio.log

# Open the app in browser
open http://localhost:3999
```

**Quick Upgrade (when using launchd)**:
```bash
# Stop, backup, upgrade, and restart in one go
cd /path/to/current/sampolio && ./uninstall-launchd.sh
cp .env ~/sampolio-backup.env
cd ~ && unzip -o sampolio-v*.zip
cd sampolio && cp ~/sampolio-backup.env .env
./install-launchd.sh
```

⚠️ **Important Notes**:
- Always keep your `.env` file - it contains the encryption key for your data
- Your data in `~/.sampolio/data/` is preserved across upgrades
- Test upgrades on a development server first for major version changes
- Keep a backup of your data before major upgrades
- To rollback: Keep the old version directory, stop the new version, and restart the old one

**Version Management Tip**: Keep multiple versions side-by-side:
```bash
~/sampolio-v1.0.0/
~/sampolio-v1.1.0/
~/sampolio-v1.2.0/  # Current
```
Use symbolic link for easy switching:
```bash
ln -sf ~/sampolio-v1.2.0 ~/sampolio-current
# Update launchd to point to ~/sampolio-current/
```

#### Uninstalling Auto-Start

```bash
./uninstall-launchd.sh
```

#### Configuration

| Environment Variable | Description | Default |
|---------------------|-------------|---------|
| `SAMPOLIO_PORT` | Server port | `3999` |
| `SAMPOLIO_HOST` | Server host | `0.0.0.0` |
| `SAMPOLIO_DATA_DIR` | Data storage directory | `~/.sampolio/data` |
| `AUTH_SECRET` | Auth secret (auto-generated if not set) | Auto-generated |
| `ENCRYPTION_KEY` | File encryption key (auto-generated if not set) | Auto-generated |

#### File Locations

| Path | Description |
|------|-------------|
| `~/.sampolio/data/` | User data and settings |
| `~/.sampolio/logs/` | Application logs (when using launchd) |
| `~/Library/LaunchAgents/com.sampolio.app.plist` | launchd configuration |

### Docker Deployment

Create a `Dockerfile`:

```dockerfile
FROM node:18-alpine AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:18-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000
CMD ["node", "server.js"]
```

Build and run:
```bash
docker build -t sampolio .

# Option 1: Using .env file (recommended)
docker run -p 3000:3000 -v $(pwd)/data:/app/data --env-file .env sampolio

# Option 2: Explicit environment variables
docker run -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  -e AUTH_SECRET=your-secret \
  -e ENCRYPTION_KEY=your-key \
  sampolio
```

## Architecture

### File-Based Database

All data is stored in encrypted JSON files:
- `data/users/` - User accounts (password hashed with bcrypt)
- `data/users/{userId}/accounts.json` - Financial accounts
- `data/users/{userId}/recurring-items.json` - Recurring income/expenses
- `data/users/{userId}/planned-items.json` - One-off and repeating items
- `data/users/{userId}/salary-configs.json` - Salary configurations
- `data/app-settings.json` - Application settings (self-signup, etc.)

Files are encrypted using AES-256-GCM with PBKDF2 key derivation.

### User Roles

- **Admin**: Can manage all users, create/update/delete accounts, toggle self-signup
- **User**: Standard user with access to personal finance features

The first user to register automatically becomes an admin.

### Projection Engine

The projection engine calculates future balances by:
1. Starting with each account's current balance
2. Applying recurring items based on their frequency and date ranges
3. Adding planned items on their scheduled dates
4. Rolling up monthly data into yearly summaries

## Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `AUTH_SECRET` | NextAuth.js secret key | Yes* | Auto-generated in production |
| `ENCRYPTION_KEY` | 64-character hex key for file encryption | Yes* | Auto-generated in production |
| `AUTH_TRUST_HOST` | Set to `true` in production | No | - |
| `DATA_DIR` / `SAMPOLIO_DATA_DIR` | Custom data directory path | No | `~/.sampolio/data` |
| `PORT` / `SAMPOLIO_PORT` | Server port | No | `3999` |
| `HOSTNAME` / `SAMPOLIO_HOST` | Server hostname | No | `0.0.0.0` |

*Required variables are auto-generated if not provided, but using a `.env` file with fixed values is recommended for production.

**For Development**: 
```bash
cp .env.example .env.local
# Edit .env.local with your secrets
```

**For Production**: 
```bash
cp .env.example .env
# Generate and set AUTH_SECRET and ENCRYPTION_KEY in .env
# The deployment scripts will load from .env file
```

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Authentication**: NextAuth.js v5
- **UI Components**: PrimeReact
- **Styling**: Tailwind CSS v4
- **Icons**: PrimeIcons, Lucide React
- **Forms**: React Hook Form + Zod validation
- **Date Handling**: date-fns

## Scripts Reference

| Script | Description |
|--------|-------------|
| `pnpm dev` | Start development server on port 3999 |
| `pnpm build` | Create production build |
| `pnpm start` | Start production server |
| `pnpm lint` | Run ESLint |
| `./scripts/build-package.sh` | Build and create distributable zip for deployment/upgrades |
| `./scripts/run-sampolio.sh` | Run the standalone server |
| `./scripts/install-launchd.sh` | Install macOS auto-start |
| `./scripts/uninstall-launchd.sh` | Remove macOS auto-start |

## License

MIT
