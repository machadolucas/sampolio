'use server';

import { auth } from '@/lib/auth';
import {
  getUserPreferences as dbGetUserPreferences,
  updateUserPreferences as dbUpdateUserPreferences,
} from '@/lib/db/user-preferences';
import type { ApiResponse, UserPreferences, TaxDefaults } from '@/types';

export async function getUserPreferences(): Promise<ApiResponse<UserPreferences>> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: 'Unauthorized' };
    }
    const prefs = await dbGetUserPreferences(session.user.id);
    return { success: true, data: prefs };
  } catch (error) {
    console.error('Get user preferences error:', error);
    return { success: false, error: 'Failed to fetch preferences' };
  }
}

export async function completeOnboarding(): Promise<ApiResponse<UserPreferences>> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: 'Unauthorized' };
    }
    const prefs = await dbUpdateUserPreferences(session.user.id, {
      hasCompletedOnboarding: true,
    });
    return { success: true, data: prefs };
  } catch (error) {
    console.error('Complete onboarding error:', error);
    return { success: false, error: 'Failed to update preferences' };
  }
}

export async function updateCategories(
  customCategories: string[],
  removedDefaultCategories: string[]
): Promise<ApiResponse<UserPreferences>> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: 'Unauthorized' };
    }
    const prefs = await dbUpdateUserPreferences(session.user.id, {
      customCategories,
      removedDefaultCategories,
    });
    return { success: true, data: prefs };
  } catch (error) {
    console.error('Update categories error:', error);
    return { success: false, error: 'Failed to update categories' };
  }
}

export async function updateTaxDefaults(
  taxDefaults: TaxDefaults
): Promise<ApiResponse<UserPreferences>> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: 'Unauthorized' };
    }
    const prefs = await dbUpdateUserPreferences(session.user.id, {
      taxDefaults,
    });
    return { success: true, data: prefs };
  } catch (error) {
    console.error('Update tax defaults error:', error);
    return { success: false, error: 'Failed to update tax defaults' };
  }
}
