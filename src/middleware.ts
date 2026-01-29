import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// This middleware runs on the Edge runtime, so it cannot import Node.js modules
// For auth checks, we rely on the auth token being present
// The actual auth validation happens in the auth library when accessed

// Rate limiting store (in-memory, resets on server restart)
// For production with multiple instances, use Redis
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

// Rate limit configuration
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 10; // 10 requests per minute for auth endpoints
const RATE_LIMIT_MAX_GENERAL = 100; // 100 requests per minute for general endpoints

function getClientIp(request: NextRequest): string {
  // Check various headers that proxies might set
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }
  
  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp;
  }
  
  // Fallback to a generic identifier
  return 'unknown';
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

// Check if user has a valid auth session cookie
function hasAuthSession(request: NextRequest): boolean {
  // NextAuth session cookies - check for both secure and non-secure variants
  const sessionCookies = [
    'authjs.session-token',
    '__Secure-authjs.session-token',
    'next-auth.session-token',
    '__Secure-next-auth.session-token',
  ];
  
  for (const cookieName of sessionCookies) {
    const cookie = request.cookies.get(cookieName);
    if (cookie?.value) {
      return true;
    }
  }
  
  return false;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const clientIp = getClientIp(request);
  
  // Apply strict rate limiting to auth endpoints
  if (pathname.startsWith('/api/auth') || pathname.startsWith('/auth/')) {
    const rateLimitKey = `auth:${clientIp}`;
    const { allowed, remaining, resetIn } = checkRateLimit(rateLimitKey, RATE_LIMIT_MAX_REQUESTS);
    
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
            'X-RateLimit-Limit': RATE_LIMIT_MAX_REQUESTS.toString(),
            'X-RateLimit-Remaining': remaining.toString(),
            'X-RateLimit-Reset': Math.ceil(resetIn / 1000).toString(),
          },
        }
      );
    }
  }
  
  // General rate limiting for all other endpoints
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

  // Protect dashboard routes - require authentication
  // Note: This is a lightweight check based on cookie presence
  // The actual session validation happens server-side in auth()
  if (pathname === '/' || pathname.startsWith('/dashboard')) {
    if (!hasAuthSession(request)) {
      const signInUrl = new URL('/auth/signin', request.url);
      signInUrl.searchParams.set('callbackUrl', pathname);
      return NextResponse.redirect(signInUrl);
    }
  }

  // Prevent authenticated users from accessing auth pages (signin/signup)
  if (pathname.startsWith('/auth/signin') || pathname.startsWith('/auth/signup')) {
    if (hasAuthSession(request)) {
      return NextResponse.redirect(new URL('/', request.url));
    }
  }

  // Add security headers to the response
  const response = NextResponse.next();
  
  // Add rate limit headers
  response.headers.set('X-RateLimit-Remaining', generalLimit.remaining.toString());
  
  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder files
     */
    '/((?!_next/static|_next/image|favicon.ico|themes|.*\\.png$|.*\\.jpg$|.*\\.svg$).*)',
  ],
};
