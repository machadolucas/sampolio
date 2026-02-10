import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const ITERATIONS = 100000;

// Get encryption key from environment or generate a default one
function getEncryptionKey(): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    // In production, this should be set via environment variable
    // For development, use a default key derived from a passphrase
    console.warn('ENCRYPTION_KEY not set, using default key. Set ENCRYPTION_KEY in production!');
    return 'sampolio-default-encryption-key-change-in-prod';
  }
  return key;
}

// LRU cache for derived keys — avoids re-running PBKDF2 for the same salt
const DERIVED_KEY_CACHE_MAX = 500;
const derivedKeyCache = new Map<string, Buffer>();

function deriveKey(password: string, salt: Buffer): Buffer {
  const cacheKey = salt.toString('hex');
  const cached = derivedKeyCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const key = crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, 'sha512');
  // Simple LRU: evict oldest entry when cache is full
  if (derivedKeyCache.size >= DERIVED_KEY_CACHE_MAX) {
    const oldestKey = derivedKeyCache.keys().next().value;
    if (oldestKey) derivedKeyCache.delete(oldestKey);
  }
  derivedKeyCache.set(cacheKey, key);
  return key;
}

export function encrypt(data: string): string {
  const password = getEncryptionKey();
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(password, salt);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Combine salt + iv + tag + encrypted data
  const combined = Buffer.concat([salt, iv, tag, encrypted]);
  return combined.toString('base64');
}

export function decrypt(encryptedData: string): string {
  const password = getEncryptionKey();
  const combined = Buffer.from(encryptedData, 'base64');

  // Extract components
  const salt = combined.subarray(0, SALT_LENGTH);
  const iv = combined.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const tag = combined.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
  const encrypted = combined.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);

  const key = deriveKey(password, salt);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

// Get the data directory path
export function getDataDir(): string {
  const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
  return dataDir;
}

// Get user-specific directory
export function getUserDir(userId: string): string {
  return path.join(getDataDir(), 'users', userId);
}

// Ensure directory exists
export async function ensureDir(dirPath: string): Promise<void> {
  try {
    await fs.access(dirPath);
  } catch {
    await fs.mkdir(dirPath, { recursive: true });
  }
}

// Read encrypted file
export async function readEncryptedFile<T>(filePath: string): Promise<T | null> {
  try {
    const encryptedContent = await fs.readFile(filePath, 'utf8');
    const decrypted = decrypt(encryptedContent);
    return JSON.parse(decrypted) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

// Write encrypted file
export async function writeEncryptedFile<T>(filePath: string, data: T): Promise<void> {
  const dirPath = path.dirname(filePath);
  await ensureDir(dirPath);

  const jsonData = JSON.stringify(data, null, 2);
  const encrypted = encrypt(jsonData);
  await fs.writeFile(filePath, encrypted, 'utf8');
}

// Delete file
export async function deleteFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

// List files in directory
export async function listFiles(dirPath: string): Promise<string[]> {
  try {
    const files = await fs.readdir(dirPath);
    return files;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

// Check if file exists
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
