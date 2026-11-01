'use server';

import { z } from 'zod';
import { updateTag } from 'next/cache';
import { after } from 'next/server';
import { auth } from '@/lib/auth';
import { getDataChangeScopes } from '@/lib/db/data-changes';
import { acknowledgeDataChanges, readDataChangeState } from '@/lib/data-changes';
import type { ApiResponse, DataChangeState } from '@/types';

/** No caller-supplied ids/tags. Expire queued scheduler writes before views read. */
export async function synchronizeDataChanges(...args: unknown[]): Promise<ApiResponse<DataChangeState>> {
  try {
    const session = await auth();
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };
    if (!z.tuple([]).safeParse(args).success) return { success: false, error: 'Invalid arguments' };
    const scopes = getDataChangeScopes(session.user.id);
    if (scopes.size === 0) return { success: false, error: 'Unauthorized' };
    const state = readDataChangeState(scopes);
    // Deliberately use Next directly: this is cache maintenance, not a new edit.
    for (const tag of state.pending.keys()) updateTag(tag);
    // Next commits queued tag expiration before finishing the request. Another
    // client synchronizing meanwhile must still see those pending tags.
    after(() => acknowledgeDataChanges(state.pending));
    return { success: true, data: { revision: state.revision } };
  } catch {
    return { success: false, error: 'Could not synchronize changes' };
  }
}
