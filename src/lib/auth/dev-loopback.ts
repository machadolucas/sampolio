// Guard for the dev auth bypass (`/dev-login`). The preview serves a copy of
// real data, so the bypass must only answer the machine itself. The primary
// control is binding `next dev` to 127.0.0.1 (package.json / .claude/launch.json);
// this header check is defence in depth: it refuses anything addressed to a
// non-loopback host name or that arrived through a proxy or tunnel. Next itself
// fills `x-forwarded-for` (socket address) and `x-forwarded-host` (Host) on every
// request, so those are accepted only when every value is loopback; headers only
// a proxy sets are refused outright. (Host alone is client-chosen, so it cannot
// replace the bind.)
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const PROXY_ONLY_HEADERS = ['forwarded', 'x-real-ip', 'cf-connecting-ip'];

function isLoopbackHost(host: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(`http://${host.trim()}`).hostname.toLowerCase());
  } catch {
    return false;
  }
}

function isLoopbackAddress(address: string): boolean {
  const ip = address.trim().toLowerCase().replace(/^\[|\]$/g, '');
  return ip === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip) || /^::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip);
}

export function isLoopbackDevRequest(headers: Headers): boolean {
  if (PROXY_ONLY_HEADERS.some((h) => headers.has(h))) return false;
  const host = headers.get('host');
  if (!host || !isLoopbackHost(host)) return false;
  const forwardedHost = headers.get('x-forwarded-host');
  if (forwardedHost !== null && !forwardedHost.split(',').every(isLoopbackHost)) return false;
  const forwardedFor = headers.get('x-forwarded-for');
  if (forwardedFor !== null && !forwardedFor.split(',').every(isLoopbackAddress)) return false;
  return true;
}
