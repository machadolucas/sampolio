# Sampolio - Personal Finance Planner

A self-hosted personal finance planning tool that replaces budgeting spreadsheets with a powerful, private workflow. Track multiple accounts, project your financial future, manage debts and investments, and reconcile balances — all stored locally with AES-256-GCM encryption.

## Features

### Cash Flow Management
- **Multi-Account Support**: Manage multiple financial accounts independently with different currencies (EUR, USD, BRL, GBP, JPY, CHF, CAD, AUD)
- **Recurring Income & Expenses**: Track fixed items (salary, rent, subscriptions) with monthly, quarterly, yearly, or custom interval frequencies
- **Planned Items**: One-off expenses (taxes, annual fees) and repeating non-monthly items (quarterly payments)
- **Occurrence Overrides**: Edit or skip individual occurrences of recurring items without changing the series
- **Salary Calculator**: Net salary computation with gross salary, taxable/non-taxable benefits, tax rate, contributions, and deductions — automatically linked to recurring income
- **Taxed Income**: Handle bonuses, holiday pay, and other special income with tax withholding (using salary settings or custom rates)
- **Category Management**: Built-in categories (Salary, Housing, Utilities, etc.) plus custom categories; remove or restore defaults

### Wealth Management
- **Investments**: Track investment accounts with starting valuations, annual growth rates, and one-off or recurring contributions/withdrawals
- **Debts**: Manage amortized loans (mortgages with fixed/variable interest, reference rates like Euribor) and fixed-installment debts (no interest). Track extra payments and remaining installments
- **Receivables**: Track money owed to you with optional interest rates, expected monthly repayments, and repayment recording

### Financial Projections
- **Multi-Year Cash Flow Projections**: See your financial future up to 10 years ahead with instant recalculation across all accounts
- **Net Worth Projection**: Aggregate wealth over time combining cash accounts, investments, receivables, and debts
- **Debt Amortization Schedules**: Automatic calculation with support for variable interest rates and rate reset frequencies
- **Investment Growth Modeling**: Compound monthly growth based on annual rates, incorporating contributions and withdrawals

### Reconciliation
- **Monthly Balance Verification**: Compare projected vs. actual balances for all entity types (cash, investments, receivables, debts)
- **Variance Tracking**: Calculate and display differences between expected and actual balances
- **Adjustment Categories**: Classify variances as untracked income/expense, valuation change, interest adjustment, data correction, or other
- **Session Management**: Track reconciliation sessions with in-progress and completed states

### Data Visualization
- **Sankey Flow Chart**: Visualize how income flows through the budget to expenses each month
- **Waterfall Chart**: Balance progression month-by-month showing how each month's net change builds on the previous
- **Treemap Chart**: Expense proportions by category and individual items
- **Net Worth Line Chart**: Track net worth trend over time
- **Stacked Area Chart**: Wealth composition breakdown (cash, investments, receivables, debts)

### User Experience
- **Onboarding Wizard**: Guided 5-step setup for first-time users (account, income, expenses)
- **Command Palette**: Quick access to any action via keyboard (Cmd+K)
- **Keyboard Shortcuts**: Cmd+I (add income), Cmd+E (add expense), Cmd+R (reconcile)
- **Dark/Light Theme**: System-wide theme toggle with PrimeReact dark theme integration
- **Interactive Month Navigation**: Scrollable month strip for quick date navigation in cashflow view

### Administration
- **User Management**: Admin panel for creating, updating, and deactivating users
- **Role-Based Access**: Admin and user roles with first-user-becomes-admin logic
- **Self-Signup Control**: Admins can enable/disable public registration
- **Cache Management**: Force revalidation of all caches from settings

### Security & Privacy
- **File-Based Encrypted Storage**: AES-256-GCM encryption with PBKDF2 key derivation — your data stays on your server
- **Password Security**: bcrypt hashing (12 rounds), strong password requirements (8+ chars, mixed case, numbers, special chars)
- **Brute Force Protection**: Account lockout after 5 failed attempts within 15 minutes
- **Security Headers**: XSS protection, frame options, CSP, HSTS, restricted permissions policy
- **Single File Deployment**: Deploy as a standalone package — no external database needed

## Getting Started

### Prerequisites

- Node.js 24+
- pnpm (recommended) or npm

### Installation

1. Clone the repository:
```bash
git clone https://github.com/machadolucas/sampolio.git
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

## Architecture

### Server Actions (No REST API)

The application uses Next.js Server Actions exclusively for all backend operations — there are no traditional REST API routes (except the NextAuth handler at `/api/auth/[...nextauth]`). All server actions are located in `src/lib/actions/` and follow a consistent pattern:

- `'use server'` directive at the top
- Input validation with Zod schemas
- Authentication check via `auth()`
- Return type: `ActionResult<T>` (`{ success: boolean; data?: T; error?: string }`)
- Cache invalidation via `updateTag()` after mutations

### File-Based Encrypted Database

All data is stored as individually encrypted JSON files in `~/.sampolio/data/` (configurable):

```
~/.sampolio/data/
├── users-index.enc              # User ID/email lookup
├── app-settings.enc             # Global settings (self-signup, etc.)
└── users/
    └── {userId}/
        ├── user.enc             # Profile, password hash, role
        ├── preferences.enc      # Onboarding state, categories, tax defaults
        ├── accounts/
        │   └── {accountId}.enc  # Cash accounts
        ├── recurring-items/
        │   └── {itemId}.enc     # Recurring income/expenses
        ├── planned-items/
        │   └── {itemId}.enc     # One-off and repeating items
        ├── salary-configs/
        │   └── {configId}.enc   # Salary configurations
        ├── investments/
        │   └── {investmentId}.enc
        ├── debts/
        │   └── {debtId}.enc
        ├── receivables/
        │   └── {receivableId}.enc
        ├── taxed-income/
        │   └── {incomeId}.enc
        └── reconciliation/
            ├── snapshots/       # Balance snapshots
            └── sessions/        # Reconciliation sessions
```

**Encryption**: AES-256-GCM with PBKDF2 key derivation (100,000 iterations). Each file has its own random salt and IV. Derived keys are cached in an LRU cache (max 500 entries) to avoid repeated PBKDF2 computation.

### Caching Strategy

- Next.js `cacheLife('indefinite')` for data queries (1-year stale/revalidate/expire)
- Granular cache tags per entity type: `user:{userId}:accounts`, `user:{userId}:debts`, etc.
- Cache invalidation via `updateTag()` after any mutation in server actions
- Admin can force-revalidate all caches from settings

### Projection Engine

**Cash Flow Projection** (`src/lib/projection.ts`):
1. Starts with each account's starting balance at its starting date
2. Iterates month-by-month through the planning horizon
3. For each month: applies recurring items (checking frequency/dates), one-off planned items, and occurrence overrides
4. Rolls up monthly data into yearly summaries

**Wealth Projection** (`src/lib/wealth-projection.ts`):
Aggregates across all entity types for each month:
- Cash accounts: balance from cashflow projection
- Investments: compound monthly growth + contributions - withdrawals
- Receivables: principal - repayments + interest accrual
- Debts: amortization schedule with interest (fixed or variable rates)
- Net worth: cash + investments + receivables - debts

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

To run: Use Command Palette (Cmd+Shift+P) > "Tasks: Run Task"

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

**Important**:
- Keep your `.env` file secure and backed up
- Never change `ENCRYPTION_KEY` — existing data will be unreadable
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

**Important**: Use the same `ENCRYPTION_KEY` to decrypt existing data.

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

**Important Notes**:
- Always keep your `.env` file — it contains the encryption key for your data
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

### Docker Deployment

Create a `Dockerfile`:

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3999
CMD ["node", "server.js"]
```

Build and run:
```bash
docker build -t sampolio .

# Option 1: Using .env file (recommended)
docker run -p 3999:3999 -v $(pwd)/data:/app/data --env-file .env sampolio

# Option 2: Explicit environment variables
docker run -p 3999:3999 \
  -v $(pwd)/data:/app/data \
  -e AUTH_SECRET=your-secret \
  -e ENCRYPTION_KEY=your-key \
  sampolio
```

## Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `AUTH_SECRET` | NextAuth.js secret key | Yes* | Auto-generated |
| `ENCRYPTION_KEY` | 64-character hex key for file encryption | Yes* | Auto-generated |
| `AUTH_TRUST_HOST` | Set to `true` behind reverse proxy | No | - |
| `AUTH_URL` | Public URL for auth (behind reverse proxy) | No | - |
| `DATA_DIR` / `SAMPOLIO_DATA_DIR` | Custom data directory path | No | `~/.sampolio/data` |
| `PORT` / `SAMPOLIO_PORT` | Server port | No | `3999` |
| `HOSTNAME` / `SAMPOLIO_HOST` | Server hostname | No | `0.0.0.0` |

*Auto-generated if not provided, but using a `.env` file with fixed values is recommended for production.

## Tech Stack

- **Framework**: Next.js 16 (App Router, Server Actions)
- **Language**: TypeScript (strict mode)
- **Authentication**: NextAuth.js v5 (JWT sessions, credentials provider)
- **UI Components**: PrimeReact with PrimeIcons
- **Styling**: Tailwind CSS v4
- **Icons**: PrimeIcons, Lucide React, React Icons
- **Forms**: React Hook Form + Zod validation
- **Charts**: ECharts (via echarts-for-react), Chart.js
- **Date Handling**: date-fns
- **Encryption**: Node.js crypto (AES-256-GCM, PBKDF2)
- **Password Hashing**: bcryptjs
- **IDs**: uuid v13

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

## File Locations

| Path | Description |
|------|-------------|
| `~/.sampolio/data/` | User data and settings (encrypted) |
| `~/.sampolio/logs/` | Application logs (when using launchd) |
| `~/Library/LaunchAgents/com.sampolio.app.plist` | launchd configuration |

## License

MIT
