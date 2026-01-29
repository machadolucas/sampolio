import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

export function GET(request: NextRequest) {
  return handleRequest(request);
}

export function POST(request: NextRequest) {
  return handleRequest(request);
}

export function PUT(request: NextRequest) {
  return handleRequest(request);
}

export function DELETE(request: NextRequest) {
  return handleRequest(request);
}

export function PATCH(request: NextRequest) {
  return handleRequest(request);
}

function handleRequest(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow API auth routes
  if (pathname.startsWith('/api/auth')) {
    return NextResponse.next();
  }

  // Allow static files and public assets
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.match(/\.(svg|png|jpg|jpeg|gif|webp|ico)$/)
  ) {
    return NextResponse.next();
  }

  // Check for auth session via cookie
  const authCookie = request.cookies.get('authjs.session-token') || 
                     request.cookies.get('__Secure-authjs.session-token');
  const isLoggedIn = !!authCookie;

  const isAuthPage = pathname.startsWith('/auth');
  const isPublicRoute = pathname === '/';

  // Redirect logged-in users away from auth pages
  if (isAuthPage && isLoggedIn) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  // Allow auth pages for non-logged-in users
  if (isAuthPage) {
    return NextResponse.next();
  }

  // Allow public route
  if (isPublicRoute) {
    return NextResponse.next();
  }

  // Protect all other routes
  if (!isLoggedIn) {
    const callbackUrl = encodeURIComponent(pathname + request.nextUrl.search);
    return NextResponse.redirect(
      new URL(`/auth/signin?callbackUrl=${callbackUrl}`, request.url)
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
