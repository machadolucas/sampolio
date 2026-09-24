import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';
import { getProxySession } from '@/lib/auth/server';
import { clientIpFrom } from '@/lib/rate-limit';
import { safeCallbackPath } from '@/lib/safe-redirect';

// Next.js 16 proxy (runs on the Node.js runtime, before every matched route).
// For app pages it only checks for the PRESENCE of a Better Auth session
// cookie. The real session validation (DB row, isActive, deletedAt) happens
// server-side in auth() (src/lib/auth.ts), which the (dashboard) layout and
// src/app/page.tsx call before rendering. The one exception is a request for
// /auth/signin or /auth/signup that carries a session cookie: there the proxy
// looks the session up (see handleAuthPage below).

const SESSION_COOKIE_PREFIX = 'sampolio'; // = AUTH_COOKIE_PREFIX in src/lib/auth/server.ts

// Rate limiting store (in-memory, resets on server restart)
// For production with multiple instances, use Redis
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

// Rate limit configuration
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_AUTH_UNAUTHENTICATED = 20; // 20 requests per minute for unauthenticated auth endpoints (login/signup)
const RATE_LIMIT_MAX_GENERAL = 300; // 300 requests per minute for general endpoints

// Same precedence as Better Auth's `ipAddressHeaders`: Cf-Connecting-Ip (set by
// Cloudflare's edge on the tunnel path; Caddy strips any client-sent value on
// the LAN path), then the first X-Forwarded-For hop (Caddy overwrites it).
function getClientIp(request: NextRequest): string {
  return clientIpFrom(request.headers);
}

function checkRateLimit(key: string, maxRequests: number): { allowed: boolean; remaining: number; resetIn: number } {
  const now = Date.now();
  const record = rateLimitStore.get(key);

  if (!record || now > record.resetTime) {
    rateLimitStore.set(key, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return { allowed: true, remaining: maxRequests - 1, resetIn: RATE_LIMIT_WINDOW };
  }

  if (record.count >= maxRequests) {
    return { allowed: false, remaining: 0, resetIn: record.resetTime - now };
  }

  record.count++;
  return { allowed: true, remaining: maxRequests - record.count, resetIn: record.resetTime - now };
}

// Clean up old rate limit entries periodically
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, record] of rateLimitStore.entries()) {
      if (now > record.resetTime) {
        rateLimitStore.delete(key);
      }
    }
  }, 60 * 1000); // Clean up every minute
}

// Whether the request carries a Better Auth session cookie (either the
// `__Secure-` variant used over https or the plain one on http://localhost).
function hasAuthSession(request: NextRequest): boolean {
  return !!getSessionCookie(request, { cookiePrefix: SESSION_COOKIE_PREFIX });
}

// Cookies cleared when a browser whose session the proxy rejected lands on an
// auth page: the Better Auth session cookie plus the pre-4.0 Auth.js/NextAuth
// ones.
const STALE_SESSION_COOKIES = [
  `${SESSION_COOKIE_PREFIX}.session_token`,
  `__Secure-${SESSION_COOKIE_PREFIX}.session_token`,
  'authjs.session-token',
  '__Secure-authjs.session-token',
  'authjs.csrf-token',
  '__Host-authjs.csrf-token',
  'authjs.callback-url',
  '__Secure-authjs.callback-url',
  'next-auth.session-token',
  '__Secure-next-auth.session-token',
];

function expireCookie(response: NextResponse, name: string) {
  // __Secure-/__Host- cookies can only be overwritten with the Secure flag.
  const secure = name.startsWith('__Secure-') || name.startsWith('__Host-');
  response.cookies.set(name, '', { path: '/', maxAge: 0, secure, httpOnly: true, sameSite: 'lax' });
}

function hasAnyStaleCookie(request: NextRequest): boolean {
  return STALE_SESSION_COOKIES.some((name) => !!request.cookies.get(name)?.value);
}

// URL prefixes of the authenticated app pages (the (dashboard) route group
// does not appear in URLs — list the real paths). Add new pages here.
const PROTECTED_PREFIXES = [
  '/overview',
  '/cashflow',
  '/mortgage',
  '/budgets',
  '/trips',
  '/split',
  '/bank',
  '/goals',
  '/playground',
  '/settings',
];

const AUTH_PAGES = ['/auth/signin', '/auth/signup'];

function isAuthPage(pathname: string): boolean {
  return AUTH_PAGES.some((page) => pathname === page || pathname.startsWith(`${page}/`));
}

/** Where a signed-in visitor of an auth page goes: its ?callbackUrl= when that
 * is a same-origin app path, else Home. Never back to an auth page. */
function signedInDestination(request: NextRequest): string {
  const target = safeCallbackPath(request.nextUrl.searchParams.get('callbackUrl'), request.nextUrl.origin);
  return target === '/auth' || target.startsWith('/auth/') ? '/' : target;
}

function clearStaleCookies(request: NextRequest): NextResponse {
  const response = NextResponse.next();
  for (const name of STALE_SESSION_COOKIES) {
    if (request.cookies.get(name)) expireCookie(response, name);
  }
  return response;
}

/**
 * /auth/signin and /auth/signup. A browser with a VALID session is sent on to
 * the app (visiting the sign-in page must not sign you out). A session cookie
 * that the shared validity rule rejects (expired/revoked session, deactivated
 * user, failed bootstrap) is cleared and the page renders.
 *
 * Why the clearing matters: a protected page whose auth() rejects the cookie
 * redirects here, while the cookie-presence check above would send a browser
 * with that cookie back to the protected page — a loop. getProxySession and
 * auth() share `toAppSession`, so they agree: "valid" leaves the auth page,
 * "invalid" loses the cookie and stays. A failed lookup (DB unavailable)
 * renders the page without touching cookies — no redirect, so no loop.
 * The pre-4.0 Auth.js cookies are swept whenever present.
 */
async function handleAuthPage(request: NextRequest): Promise<NextResponse> {
  if (hasAuthSession(request)) {
    let session;
    try {
      session = await getProxySession(request.headers);
    } catch (error) {
      console.error('[proxy] session lookup on an auth page failed:', error);
      return NextResponse.next();
    }
    if (session) {
      // Only page loads move on; a POST (server action) keeps its cookie and runs.
      const isPageLoad = request.method === 'GET' || request.method === 'HEAD';
      return isPageLoad ? NextResponse.redirect(new URL(signedInDestination(request), request.url)) : NextResponse.next();
    }
  }
  return hasAnyStaleCookie(request) ? clearStaleCookies(request) : NextResponse.next();
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const clientIp = getClientIp(request);

  // Apply strict rate limiting to auth endpoints only for unauthenticated users
  // Authenticated users making session polling requests (e.g., /api/auth/session)
  // should not be rate-limited under the strict auth limit — use general limit instead
  if (pathname.startsWith('/api/auth') || pathname.startsWith('/auth/')) {
    const isAuthenticated = hasAuthSession(request);

    if (!isAuthenticated) {
      const rateLimitKey = `auth:${clientIp}`;
      const { allowed, remaining, resetIn } = checkRateLimit(rateLimitKey, RATE_LIMIT_MAX_AUTH_UNAUTHENTICATED);

      if (!allowed) {
        return new NextResponse(
          JSON.stringify({
            success: false,
            error: 'Too many requests. Please try again later.',
            retryAfter: Math.ceil(resetIn / 1000),
          }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': Math.ceil(resetIn / 1000).toString(),
              'X-RateLimit-Limit': RATE_LIMIT_MAX_AUTH_UNAUTHENTICATED.toString(),
              'X-RateLimit-Remaining': remaining.toString(),
              'X-RateLimit-Reset': Math.ceil(resetIn / 1000).toString(),
            },
          }
        );
      }
    }
    // Authenticated users' auth requests fall through to general rate limiting below
  }

  // General rate limiting applies only to unauthenticated requests.
  // Authenticated users are exempt — this is a self-hosted app where server actions
  // (POST requests to page URLs) can easily generate hundreds of requests per minute
  // during normal page loads with parallel data fetching.
  const isAuthenticated = hasAuthSession(request);

  if (!isAuthenticated) {
    const generalRateLimitKey = `general:${clientIp}`;
    const generalLimit = checkRateLimit(generalRateLimitKey, RATE_LIMIT_MAX_GENERAL);

    if (!generalLimit.allowed) {
      return new NextResponse(
        JSON.stringify({
          success: false,
          error: 'Too many requests. Please slow down.',
          retryAfter: Math.ceil(generalLimit.resetIn / 1000),
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': Math.ceil(generalLimit.resetIn / 1000).toString(),
          },
        }
      );
    }
  }

  // Dev-only auth bypass: route unauthenticated users straight to /dev-login
  // (which signs them in as DEV_AUTH_BYPASS) instead of the sign-in form, so the
  // Preview browser reaches an authenticated page in one hop. Inert in production
  // and when the flag is unset.
  if (
    process.env.NODE_ENV !== 'production' &&
    process.env.DEV_AUTH_BYPASS &&
    !hasAuthSession(request) &&
    !pathname.startsWith('/dev-login') &&
    !pathname.startsWith('/api/auth') &&
    (pathname === '/' || pathname.startsWith('/auth/signin') || pathname.startsWith('/auth/signup'))
  ) {
    return NextResponse.redirect(new URL('/dev-login', request.url));
  }

  // Protect app pages - require authentication
  // Note: This is a lightweight check based on cookie presence; the actual
  // session validation happens server-side in auth() (the (dashboard) layout
  // and src/app/page.tsx redirect on an invalid session). This check just
  // avoids rendering page shells for obviously unauthenticated visitors.
  const isProtectedPath =
    pathname === '/' ||
    PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  if (isProtectedPath && !hasAuthSession(request)) {
    const signInUrl = new URL('/auth/signin', request.url);
    signInUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(signInUrl);
  }

  if (isAuthPage(pathname)) {
    return handleAuthPage(request);
  }

  // Add security headers to the response
  const response = NextResponse.next();

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - manifest.webmanifest / sw.js / offline.html / icons (PWA assets — must be
     *   fetchable without an auth redirect; the install screen requests the
     *   manifest without credentials)
     * - public folder files
     */
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|offline.html|icons|themes|.*\\.png$|.*\\.jpg$|.*\\.svg$).*)',
  ],
};
