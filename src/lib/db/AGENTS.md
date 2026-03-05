# Database Layer (`src/lib/db/`)

File-based encrypted storage layer. No external database — all data is stored as individually encrypted JSON files on disk.

## Encryption (`encryption.ts`)

- **Algorithm**: AES-256-GCM
- **Key derivation**: PBKDF2 with 100,000 iterations
- **Per-file security**: Each file gets a random 16-byte salt and 12-byte IV
- **Storage format**: Base64-encoded string containing `salt + iv + authTag + ciphertext`
- **Key source**: `ENCRYPTION_KEY` environment variable (64-char hex string)
- **Performance**: LRU cache (max 500 entries) for derived keys to avoid repeated PBKDF2

### Core Functions

```typescript
readEncryptedFile<T>(filePath: string): Promise<T>
writeEncryptedFile<T>(filePath: string, data: T): Promise<void>
getDataDir(): string              // ~/.sampolio/data/ or custom
getUserDir(userId: string): string // ~/.sampolio/data/users/{userId}
ensureDir(dir: string): Promise<void>
listFiles(dir: string): Promise<string[]>
deleteFile(filePath: string): Promise<void>
```

## Data Directory Structure

```
{dataDir}/
├── users-index.enc           # { users: [{ id, email }] }
├── app-settings.enc          # { selfSignupEnabled, updatedAt, updatedBy }
└── users/{userId}/
    ├── user.enc              # User profile with passwordHash
    ├── preferences.enc       # Onboarding, categories, tax defaults
    ├── accounts/{id}.enc     # One file per cash account
    ├── recurring-items/{id}.enc
    ├── planned-items/{id}.enc
    ├── salary-configs/{id}.enc
    ├── investments/{id}.enc
    ├── debts/{id}.enc
    ├── receivables/{id}.enc
    ├── taxed-income/{id}.enc
    └── reconciliation/
        ├── snapshots/{id}.enc
        └── sessions/{id}.enc
```

## DB File Pattern

Each entity type has its own file in this directory. They all follow the same pattern:

```typescript
// List all entities
export async function getItems(userId: string): Promise<Item[]> {
  const dir = path.join(getUserDir(userId), 'items');
  await ensureDir(dir);
  const files = await listFiles(dir);
  const encFiles = files.filter(f => f.endsWith('.enc'));
  return Promise.all(encFiles.map(f => readEncryptedFile<Item>(path.join(dir, f))));
}

// Get single entity
export async function getItemById(userId: string, itemId: string): Promise<Item | null> {
  const filePath = path.join(getUserDir(userId), 'items', `${itemId}.enc`);
  try { return await readEncryptedFile<Item>(filePath); }
  catch { return null; }
}

// Create entity
export async function createItem(userId: string, data: CreateItemRequest): Promise<Item> {
  const item: Item = { id: uuidv4(), ...data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  const filePath = path.join(getUserDir(userId), 'items', `${item.id}.enc`);
  await ensureDir(path.dirname(filePath));
  await writeEncryptedFile(filePath, item);
  return item;
}

// Update entity (read-modify-write)
export async function updateItem(userId: string, itemId: string, updates: Partial<Item>): Promise<Item> {
  const existing = await getItemById(userId, itemId);
  if (!existing) throw new Error('Not found');
  const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
  await writeEncryptedFile(path.join(getUserDir(userId), 'items', `${itemId}.enc`), updated);
  return updated;
}

// Delete entity
export async function deleteItem(userId: string, itemId: string): Promise<void> {
  await deleteFile(path.join(getUserDir(userId), 'items', `${itemId}.enc`));
}
```

## Cached Queries (`cached.ts`)

Wraps DB read functions with Next.js `cacheLife('indefinite')` and `cacheTag()`:

```typescript
export async function cachedGetAccounts(userId: string) {
  'use cache';
  cacheLife('indefinite');
  cacheTag(`user:${userId}:accounts`);
  return getAccounts(userId);
}
```

After mutations, server actions call `updateTag(tagName)` to invalidate.

## Known Limitations

- **No file locking**: Concurrent read-modify-write operations can cause data loss. Acceptable for single-user scenarios.
- **No transactions**: Operations are not atomic — a crash mid-write could corrupt a file.
