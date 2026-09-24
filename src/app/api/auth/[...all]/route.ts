import { getAuth } from '@/lib/auth/server';

// Better Auth HTTP surface (/api/auth/*): email+password sign-in/up,
// get-session, sign-out, change-password, and the passkey plugin endpoints.
// The instance is resolved per request so importing this module (e.g. during
// `next build`) never opens the database. (Equivalent to toNextJsHandler.)
const handler = (request: Request) => getAuth().handler(request);

export const GET = handler;
export const POST = handler;
