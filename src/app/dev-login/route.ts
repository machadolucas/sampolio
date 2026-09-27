import { NextResponse } from 'next/server';
import { devBypassSignIn, isDevBypassEnabled } from '@/lib/auth/server';
import { isLoopbackDevRequest } from '@/lib/auth/dev-loopback';

/**
 * Dev-only convenience route: signs in as the DEV_AUTH_BYPASS user without a
 * password so the Preview browser lands on an authenticated page in one hop.
 *
 * Double-guarded so it is inert (404) in production or when the flag is unset;
 * the Better Auth endpoint behind it is server-only and only registered under
 * the same condition. It also answers only loopback requests with no
 * forwarding headers (`isLoopbackDevRequest`); the dev server itself binds to
 * 127.0.0.1.
 */
export async function GET(request: Request) {
  if (!isDevBypassEnabled() || !isLoopbackDevRequest(request.headers)) {
    return new NextResponse('Not found', { status: 404 });
  }

  try {
    const setCookieHeaders = await devBypassSignIn(request.headers);
    const response = NextResponse.redirect(new URL('/', request.url));
    for (const cookie of setCookieHeaders.getSetCookie()) {
      response.headers.append('Set-Cookie', cookie);
    }
    return response;
  } catch (error) {
    console.error('[auth] dev bypass failed:', error);
    return NextResponse.redirect(new URL('/auth/signin', request.url));
  }
}
