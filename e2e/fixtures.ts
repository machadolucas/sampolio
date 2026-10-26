import { createHash } from "node:crypto";
import { test as base } from "@playwright/test";

/** Each isolated browser context models a distinct synthetic client through
 * the same trusted-proxy header the LAN deployment supports. RFC3849 addresses
 * never leave headers: all network connections still target localhost4999.
 * This preserves production rate limits while keeping unrelated tests from
 * sharing the fallback UNKNOWN_CLIENT_IP bucket. */
export const test = base.extend({
  extraHTTPHeaders: async ({ extraHTTPHeaders }, provideHeaders, info) => {
    const hash = createHash("sha256")
      .update(`${info.project.name}:${info.testId}:${info.retry}`)
      .digest("hex");
    const address = `2001:db8:${hash.slice(0, 4)}:${hash.slice(4, 8)}:${hash.slice(8, 12)}::1`;
    await provideHeaders({ ...extraHTTPHeaders, "x-forwarded-for": address });
  },
});
export { expect, type Page } from "@playwright/test";
