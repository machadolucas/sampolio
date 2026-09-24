import { getAuth } from '@/lib/auth/server';
import { getSetupFailure, SETUP_INCOMPLETE_CODE, SETUP_INCOMPLETE_MESSAGE } from '@/lib/db/sqlite/setup-state';

// Better Auth HTTP surface (/api/auth/*): email+password sign-in/up,
// get-session, sign-out, change-password, and the passkey plugin endpoints.
// The instance is resolved per request so importing this module (e.g. during
// `next build`) never opens the database. (Equivalent to toNextJsHandler.)
// Fails closed with 503 while the boot-time DB setup is broken (bootstrap.ts).
const handler = (request: Request) => {
  if (getSetupFailure()) {
    return Response.json({ code: SETUP_INCOMPLETE_CODE, message: SETUP_INCOMPLETE_MESSAGE }, { status: 503 });
  }
  return getAuth().handler(request);
};

export const GET = handler;
export const POST = handler;
