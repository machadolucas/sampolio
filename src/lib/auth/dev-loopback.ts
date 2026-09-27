// Guard for the dev auth bypass (`/dev-login`). The preview serves a copy of
// real data, so the bypass must only answer the machine itself. The primary
// control is binding `next dev` to 127.0.0.1 (package.json / .claude/launch.json);
// this header check is defence in depth: it refuses anything that arrived
// through a proxy or tunnel (any forwarding header) or was addressed to a
// non-loopback host name. (Host alone is client-chosen, so it cannot replace
// the bind.)
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const FORWARDING_HEADERS = ['x-forwarded-for', 'x-forwarded-host', 'forwarded', 'x-real-ip', 'cf-connecting-ip'];

export function isLoopbackDevRequest(headers: Headers): boolean {
  if (FORWARDING_HEADERS.some((h) => headers.has(h))) return false;
  const host = headers.get('host');
  if (!host) return false;
  let hostname: string;
  try {
    hostname = new URL(`http://${host}`).hostname;
  } catch {
    return false;
  }
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}
