/**
 * Post-sign-in redirect target from an untrusted `?callbackUrl=`. Resolved
 * with the WHATWG URL parser against the app's own origin (so tricks like
 * `/%09/evil.com`, `/\evil.com` or `//evil.com` that browsers normalize to a
 * foreign host are caught) and accepted only when the result stays on that
 * origin. Returns a same-origin path (`pathname + search + hash`), else `/`.
 */
export function safeCallbackPath(raw: string | null | undefined, origin: string): string {
  if (!raw) return '/';
  let url: URL;
  try {
    url = new URL(raw, origin);
  } catch {
    return '/';
  }
  if (url.origin !== new URL(origin).origin) return '/';
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '/';
  const path = `${url.pathname}${url.search}${url.hash}`;
  // A path that itself starts with `//` or `/\` (e.g. from `/.//evil.com`) is
  // protocol-relative again when handed to the router, and a consumer that
  // decodes once more could turn `/%09/evil.com` into one — refuse both.
  let decoded = path;
  try {
    decoded = decodeURIComponent(url.pathname);
  } catch {
    return '/';
  }
  if (/^[/\\]{2}/.test(path) || /^[/\\]{2}/.test(decoded.replace(/[\u0000-\u001f\s]/g, ''))) return '/';
  return path;
}
