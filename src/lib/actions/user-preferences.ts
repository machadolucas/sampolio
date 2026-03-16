'use server';

import { auth } from '@/lib/auth';
import {
  updateUserPreferences as dbUpdateUserPreferences,
} from '@/lib/db/user-preferences';
import { cachedGetUserPreferences } from '@/lib/db/cached';
import { updateTag } from 'next/cache';
import { z } from 'zod';
import type { ApiResponse, UserPreferences, TaxDefaults, DisplayMode } from '@/types';

export async function getUserPreferences(): Promise<ApiResponse<UserPreferences>> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: 'Unauthorized' };
    }
    const prefs = await cachedGetUserPreferences(session.user.id);
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
    updateTag(`user:${session.user.id}:preferences`);
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
    updateTag(`user:${session.user.id}:preferences`);
    return { success: true, data: prefs };
  } catch (error) {
    console.error('Update categories error:', error);
    return { success: false, error: 'Failed to update categories' };
  }
}

const displayModeSchema = z.enum(['simple', 'advanced']);

export async function updateDisplayMode(
  mode: DisplayMode
): Promise<ApiResponse<UserPreferences>> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: 'Unauthorized' };
    }
    const parsed = displayModeSchema.safeParse(mode);
    if (!parsed.success) {
      return { success: false, error: 'Invalid display mode' };
    }
    const prefs = await dbUpdateUserPreferences(session.user.id, {
      displayMode: parsed.data,
    });
    updateTag(`user:${session.user.id}:preferences`);
    return { success: true, data: prefs };
  } catch (error) {
    console.error('Update display mode error:', error);
    return { success: false, error: 'Failed to update display mode' };
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
    updateTag(`user:${session.user.id}:preferences`);
    return { success: true, data: prefs };
  } catch (error) {
    console.error('Update tax defaults error:', error);
    return { success: false, error: 'Failed to update tax defaults' };
  }
}
