# Sampolio - Personal Finance Planner

A personal finance planning tool that replaces your budgeting spreadsheet with a cleaner, more powerful workflow.

## Features

- **Multi-Account Support**: Manage multiple financial accounts independently (e.g., checking, savings, investment accounts)
- **Recurring Income & Expenses**: Track fixed monthly items like salary, rent, subscriptions with start/end dates
- **Planned Items**: One-off expenses (taxes, annual fees) and repeating non-monthly items (quarterly payments)
- **Salary Calculator**: Net salary calculation with deductions, bonuses, and automatic linking to recurring income
- **Multi-Year Projections**: See your financial future up to 10 years ahead with instant recalculation
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

Files are encrypted using AES-256-GCM with PBKDF2 key derivation.

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

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Authentication**: NextAuth.js v5
- **Styling**: Tailwind CSS v4
- **Icons**: Lucide React
- **Forms**: React Hook Form + Zod validation
- **Date Handling**: date-fns

## License

MIT
