# Settings Page (`/settings`)

User preferences and administration panel.

## Key File

`page.tsx` — Settings form with sections for different preference areas.

## Features

### Appearance
- Dark/light mode toggle (persisted via ThemeProvider)

### Keyboard Shortcuts Display
Shows available keyboard shortcuts:
- `Cmd+K` — Open command palette
- `Cmd+I` — Quick add income
- `Cmd+E` — Quick add expense
- `Cmd+R` — Start reconciliation

### Data & Export
- Export and Import buttons (UI placeholders — functionality not yet implemented)

### Accounts Management
- Button to open accounts management drawer
- View, create, edit, archive cash accounts

### Categories Management
- View active categories (built-in defaults + user-created custom categories)
- Remove default categories (moves them to a "removed" list)
- Add new custom categories
- Restore previously removed defaults
- Save changes via `updatePreferences()` server action
- Categories defined in `src/lib/constants.ts` (`ITEM_CATEGORIES` array)

### Tax & Contribution Defaults
- Tax rate (%)
- Contributions rate (%)
- Other deductions (fixed amount)
- Saved in `UserPreferences.taxDefaults`
- Used as defaults when creating new salary configs

### Admin Settings (visible only to admin users)
- **Allow self-signup**: Toggle to enable/disable public registration
- **Manage Users**: Opens `UsersModal` for user CRUD (create, edit roles, deactivate)
- **Force Revalidate Caches**: Calls `revalidateAllCaches()` to clear all Next.js caches

### About Section
- App name and version (from `package.json`)
- Link to GitHub repository

## Server Actions Used

- `src/lib/actions/user-preferences.ts` — Read/update preferences
- `src/lib/actions/admin.ts` — User management, app settings (admin only)
- `src/lib/actions/app-info.ts` — App version
