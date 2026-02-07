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
| `AUTH_SECRET` | Auth secret (auto-generated if not set) | - |

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
docker run -p 3000:3000 -v $(pwd)/data:/app/data -e AUTH_SECRET=your-secret -e ENCRYPTION_KEY=your-key sampolio
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

| Variable | Description | Required |
|----------|-------------|----------|
| `AUTH_SECRET` | NextAuth.js secret key | Yes |
| `ENCRYPTION_KEY` | 64-character hex key for file encryption | Yes |
| `AUTH_TRUST_HOST` | Set to `true` in production | No |
| `DATA_DIR` | Custom data directory path | No |

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
| `./scripts/build-package.sh` | Build and create distributable zip |
| `./scripts/run-sampolio.sh` | Run the standalone server |
| `./scripts/install-launchd.sh` | Install macOS auto-start |
| `./scripts/uninstall-launchd.sh` | Remove macOS auto-start |

## License

MIT
