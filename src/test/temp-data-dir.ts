import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Point the app at a throwaway DATA_DIR with a fresh random ENCRYPTION_KEY /
 * AUTH_SECRET (never real secrets). Call from `beforeAll`; the returned
 * cleanup removes the directory. Modules read these env vars lazily, so this
 * works even after they are imported.
 */
export function useTempDataDir(prefix = 'sampolio-test-'): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  process.env.DATA_DIR = dir;
  process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
  process.env.AUTH_SECRET = crypto.randomBytes(32).toString('base64');
  process.env.AUTH_URL = 'http://localhost:4998';
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
