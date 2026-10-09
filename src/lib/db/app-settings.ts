import * as path from 'path';
import type { AppSettings } from '@/types';
import {
  getDataDir,
  ensureDir,
  readEncryptedFile,
  writeEncryptedFile,
} from './encryption';
import { isFirstUserSetup } from './sqlite/user-store';

const APP_SETTINGS_FILE = 'app-settings.enc';

async function getAppSettingsPath(): Promise<string> {
  const dataDir = getDataDir();
  await ensureDir(dataDir);
  return path.join(dataDir, APP_SETTINGS_FILE);
}

// Fails closed: a missing `app-settings.enc` (restore mistake, manual cleanup)
// must not silently reopen public sign-up. Before the first account exists the
// default is "enabled" so the owner can register (the first-user rule in the
// sign-up hooks admits them regardless); once any user exists it is "disabled"
// until an admin turns it on.
function defaultSettings(): AppSettings {
  return {
    selfSignupEnabled: isFirstUserSetup(),
    updatedAt: new Date().toISOString(),
    updatedBy: 'system',
  };
}

export async function getAppSettings(): Promise<AppSettings> {
  const settingsPath = await getAppSettingsPath();
  const settings = await readEncryptedFile<AppSettings>(settingsPath);
  return settings || defaultSettings();
}

export async function updateAppSettings(
  updates: Partial<Pick<AppSettings, 'selfSignupEnabled'>>,
  updatedBy: string
): Promise<AppSettings> {
  const currentSettings = await getAppSettings();
  
  const updatedSettings: AppSettings = {
    ...currentSettings,
    ...updates,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
  
  const settingsPath = await getAppSettingsPath();
  await writeEncryptedFile(settingsPath, updatedSettings);
  
  return updatedSettings;
}

export async function isSelfSignupEnabled(): Promise<boolean> {
  const settings = await getAppSettings();
  return settings.selfSignupEnabled;
}
