import type { UserPreferences } from '@/types';
import { assertSafeId } from './encryption';
import { getDoc, inTx, putDoc } from './sqlite/docs';
import { userPreferences } from './sqlite/schema';

const DEFAULT_PREFERENCES: UserPreferences = {
  hasCompletedOnboarding: false,
  updatedAt: new Date().toISOString(),
};

function readPreferences(userId: string): UserPreferences {
  const prefs = getDoc<UserPreferences>(userPreferences, { userId: assertSafeId(userId, 'userId') });
  return prefs ?? { ...DEFAULT_PREFERENCES, updatedAt: new Date().toISOString() };
}

export async function getUserPreferences(userId: string): Promise<UserPreferences> {
  return readPreferences(userId);
}

export async function updateUserPreferences(
  userId: string,
  updates: Partial<Omit<UserPreferences, 'updatedAt'>>
): Promise<UserPreferences> {
  return inTx(() => {
    const current = readPreferences(userId);
    const updated: UserPreferences = {
      ...current,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    putDoc(userPreferences, { userId }, updated);
    return updated;
  });
}
