import type { AppSettings } from '@/types';
import { getDoc, inTx, putDoc } from './sqlite/docs';
import { appSettings } from './sqlite/schema';
import { isFirstUserSetup } from './sqlite/user-store';

const APP_SETTINGS_ID = 'app';

// Fails closed: a missing settings row (restore mistake, manual cleanup) must
// not silently reopen public sign-up. Before the first account exists the
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

function readSettings(): AppSettings {
  return getDoc<AppSettings>(appSettings, { id: APP_SETTINGS_ID }) || defaultSettings();
}

export async function getAppSettings(): Promise<AppSettings> {
  return readSettings();
}

export async function updateAppSettings(
  updates: Partial<Pick<AppSettings, 'selfSignupEnabled'>>,
  updatedBy: string
): Promise<AppSettings> {
  return inTx(() => {
    const updatedSettings: AppSettings = {
      ...readSettings(),
      ...updates,
      updatedAt: new Date().toISOString(),
      updatedBy,
    };
    putDoc(appSettings, { id: APP_SETTINGS_ID }, updatedSettings);
    return updatedSettings;
  });
}

export async function isSelfSignupEnabled(): Promise<boolean> {
  const settings = await getAppSettings();
  return settings.selfSignupEnabled;
}
