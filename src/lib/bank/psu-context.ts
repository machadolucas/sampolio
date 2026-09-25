import { clientIpFrom, UNKNOWN_CLIENT_IP } from '@/lib/rate-limit';

/**
 * The attended-PSU context of a request (Enable Banking `Psu-Ip-Address` /
 * `Psu-User-Agent`): the client IP from `clientIpFrom` (`cf-connecting-ip`
 * first; a client can prepend anything to `x-forwarded-for` through the
 * tunnel) and the user agent. Without an identifiable IP, `psuIp` is left out
 * rather than sent as "unknown"; the run is then treated as unattended, and
 * client.ts never sends the user agent on its own.
 */
export function psuContextFrom(headers: Headers): { psuIp?: string; psuUserAgent?: string } {
  const ip = clientIpFrom(headers);
  return {
    psuIp: ip === UNKNOWN_CLIENT_IP ? undefined : ip,
    psuUserAgent: headers.get('user-agent') ?? undefined,
  };
}
