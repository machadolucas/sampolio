/**
 * Enable Banking — OAuth/SCA callback (the only new HTTP route).
 *
 * The bank redirects the browser here after SCA: `?code=&state=` (or `?error=`).
 * We require an authenticated Sampolio session (the same hostname is used
 * throughout so the session cookie is present), match the single-use `state`
 * for this user as CSRF protection, exchange the code for a session, map
 * accounts, and run the initial ~60-day backfill — then redirect to settings.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { completeConnection } from '@/lib/bank/connect';
import { redactBankError } from '@/lib/bank/client';

function redirect(request: NextRequest, path: string): NextResponse {
  return NextResponse.redirect(new URL(path, request.url));
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    // Not authenticated on this device — bounce to sign-in, then they can retry.
    return redirect(request, '/auth/signin?callbackUrl=/settings');
  }

  const params = request.nextUrl.searchParams;
  const bankError = params.get('error');
  if (bankError) {
    return redirect(request, '/settings?bankError=sca_declined');
  }

  const code = params.get('code');
  const state = params.get('state');
  if (!code || !state) {
    return redirect(request, '/settings?bankError=missing_params');
  }

  const psuIp =
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    request.headers.get('x-real-ip') ??
    undefined;

  try {
    const result = await completeConnection(session.user.id, code, state, psuIp);
    if (!result) {
      // No pending connection matched this state (replay / wrong user).
      return redirect(request, '/settings?bankError=invalid_state');
    }
    return redirect(
      request,
      `/settings?bankConnected=${encodeURIComponent(result.connection.aspspName)}`
    );
  } catch (err) {
    console.error('[bank] callback failed:', redactBankError(err));
    return redirect(request, '/settings?bankError=connect_failed');
  }
}
