import { z } from 'zod';
import { SAFE_ID_PATTERN, YEAR_MONTH_PATTERN, CHUNK_MONTH_PATTERN } from '@/lib/safe-id';

// Shared boundary schemas for identifiers that become filesystem path
// segments. The DB layer enforces the same patterns (`assertSafeId` /
// `assertChunkMonth` in `src/lib/db/encryption.ts`); validating at the action
// boundary turns a traversal attempt into a clean validation error.
export const idSchema = z.string().regex(SAFE_ID_PATTERN, 'Invalid id');

/** A real calendar month, `YYYY-MM` with month 01–12. */
export const yearMonthSchema = z.string().regex(YEAR_MONTH_PATTERN, 'Invalid month (YYYY-MM)');

/** A split-group expense chunk month (`YYYY-MM` shape). */
export const chunkMonthSchema = z.string().regex(CHUNK_MONTH_PATTERN, 'Invalid month (YYYY-MM)');
