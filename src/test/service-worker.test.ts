import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

// Runs public/sw.js in a sandbox with fake Cache Storage / fetch, to pin the
// cache-first branch's rules: only ok same-origin responses are stored, and
// /_next/static/ entries are capped (oldest evicted first).

const ORIGIN = 'https://sampolio.example.com';
const SW_SOURCE = fs.readFileSync(path.join(process.cwd(), 'public/sw.js'), 'utf8');

type FakeRequest = { url: string; method: string; mode: string; headers: Headers };
type FakeResponse = { ok: boolean; type: string; status: number; clone: () => FakeResponse };

function makeResponse(status: number, type = 'basic'): FakeResponse {
  const res: FakeResponse = { ok: status >= 200 && status < 300, type, status, clone: () => res };
  return res;
}

function setup(fetchImpl: (req: FakeRequest) => Promise<FakeResponse>) {
  const stores = new Map<string, Map<string, FakeResponse>>();
  const openStore = (name: string) => {
    let store = stores.get(name);
    if (!store) {
      store = new Map();
      stores.set(name, store);
    }
    const s = store;
    return {
      put: async (req: FakeRequest | string, res: FakeResponse) => {
        const url = typeof req === 'string' ? new URL(req, ORIGIN).href : req.url;
        s.delete(url);
        s.set(url, res);
      },
      match: async (req: FakeRequest) => s.get(req.url),
      keys: async () => [...s.keys()].map((url) => ({ url })),
      delete: async (req: { url: string }) => s.delete(req.url),
      addAll: async (urls: string[]) => {
        for (const u of urls) s.set(new URL(u, ORIGIN).href, makeResponse(200));
      },
    };
  };
  const caches = {
    open: async (name: string) => openStore(name),
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (req: FakeRequest | string) => {
      const url = typeof req === 'string' ? new URL(req, ORIGIN).href : req.url;
      for (const s of stores.values()) if (s.has(url)) return s.get(url);
      return undefined;
    },
  };
  const listeners = new Map<string, (event: unknown) => void>();
  const self = {
    location: new URL(ORIGIN),
    addEventListener: (type: string, fn: (event: unknown) => void) => listeners.set(type, fn),
    skipWaiting: () => {},
    clients: { claim: async () => {} },
  };
  vm.runInNewContext(SW_SOURCE, { self, caches, fetch: fetchImpl, URL, Response, Promise, console });

  async function dispatchFetch(pathname: string) {
    const pending: Promise<unknown>[] = [];
    let response: Promise<FakeResponse> | undefined;
    const request: FakeRequest = { url: `${ORIGIN}${pathname}`, method: 'GET', mode: 'no-cors', headers: new Headers() };
    listeners.get('fetch')!({
      request,
      respondWith: (p: Promise<FakeResponse>) => { response = p; },
      waitUntil: (p: Promise<unknown>) => { pending.push(p); },
    });
    const res = await response;
    // waitUntil may be registered while the response resolves.
    while (pending.length) await pending.shift();
    return res;
  }
  async function activate() {
    const pending: Promise<unknown>[] = [];
    listeners.get('activate')!({ waitUntil: (p: Promise<unknown>) => pending.push(p) });
    await Promise.all(pending);
  }
  const staticUrls = () =>
    [...stores.values()].flatMap((s) => [...s.keys()]).filter((u) => u.includes('/_next/static/'));
  return { dispatchFetch, activate, staticUrls, stores };
}

describe('service worker cache-first branch', () => {
  let status: number;
  let type: string;
  let env: ReturnType<typeof setup>;

  beforeEach(() => {
    status = 200;
    type = 'basic';
    env = setup(async () => makeResponse(status, type));
  });

  it('caches a successful hashed chunk and serves it from cache afterwards', async () => {
    await env.dispatchFetch('/_next/static/chunks/a.js');
    expect(env.staticUrls()).toEqual([`${ORIGIN}/_next/static/chunks/a.js`]);
    status = 502;
    expect((await env.dispatchFetch('/_next/static/chunks/a.js'))?.status).toBe(200);
  });

  it('never stores a 404/5xx or a non-basic response', async () => {
    status = 502;
    expect((await env.dispatchFetch('/_next/static/chunks/b.js'))?.status).toBe(502);
    status = 404;
    await env.dispatchFetch('/_next/static/chunks/c.js');
    status = 200;
    type = 'opaqueredirect';
    await env.dispatchFetch('/_next/static/chunks/d.js');
    expect(env.staticUrls()).toEqual([]);
    // A later successful fetch of the same URL is then cached normally.
    type = 'basic';
    await env.dispatchFetch('/_next/static/chunks/b.js');
    expect(env.staticUrls()).toEqual([`${ORIGIN}/_next/static/chunks/b.js`]);
  });

  it('caps /_next/static/ entries, evicting the oldest first', async () => {
    for (let i = 0; i < 305; i++) await env.dispatchFetch(`/_next/static/chunks/${i}.js`);
    const urls = env.staticUrls();
    expect(urls).toHaveLength(300);
    expect(urls[0]).toBe(`${ORIGIN}/_next/static/chunks/5.js`);
    expect(urls.at(-1)).toBe(`${ORIGIN}/_next/static/chunks/304.js`);
  });

  it('activate drops old cache versions and trims the current one', async () => {
    const fresh = setup(async () => makeResponse(200));
    for (let i = 0; i < 3; i++) await fresh.dispatchFetch(`/_next/static/chunks/${i}.js`);
    fresh.stores.set('sampolio-v1', new Map([[`${ORIGIN}/_next/static/old.js`, makeResponse(200)]]));
    await fresh.activate();
    expect(fresh.stores.has('sampolio-v1')).toBe(false);
    expect(fresh.staticUrls()).toHaveLength(3);
  });
});
