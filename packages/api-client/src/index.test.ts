import { describe, expect, it } from 'vitest';

import { ApiClient, ApiError } from './index';

function mockFetch(
  handler: (req: Request) => Response | Promise<Response>,
): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const req =
      input instanceof Request
        ? input
        : new Request(
            typeof input === 'string' ? input : input.toString(),
            init,
          );
    return Promise.resolve(handler(req));
  }) as typeof fetch;
}

const BASE = 'https://sync.example';

describe('ApiClient', () => {
  it('injects the bearer token on binary requests', async () => {
    let seen: string | null = null;
    const api = new ApiClient({
      baseUrl: BASE,
      getAccessToken: () => 'tok-123',
      fetch: mockFetch((req) => {
        seen = req.headers.get('Authorization');
        return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      }),
    });
    const bytes = await api.readFile('p1', 'chapter.md');
    expect(seen).toBe('Bearer tok-123');
    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('returns null for a missing file', async () => {
    const api = new ApiClient({
      baseUrl: BASE,
      fetch: mockFetch(() => new Response(null, { status: 404 })),
    });
    expect(await api.readFile('p1', 'missing.md')).toBeNull();
  });

  it('encodes nested file paths and sends content type on write', async () => {
    let url = '';
    let contentType: string | null = null;
    const api = new ApiClient({
      baseUrl: BASE,
      fetch: mockFetch((req) => {
        url = req.url;
        contentType = req.headers.get('Content-Type');
        return new Response(null, { status: 204 });
      }),
    });
    await api.writeFile(
      'p 1',
      'images/a b.png',
      new Uint8Array([0]),
      'image/png',
    );
    expect(url).toBe(`${BASE}/projects/p%201/files/images/a%20b.png`);
    expect(contentType).toBe('image/png');
  });

  it('reads a typed JSON list through openapi-fetch', async () => {
    const api = new ApiClient({
      baseUrl: BASE,
      fetch: mockFetch(
        () =>
          new Response(
            JSON.stringify({
              files: [
                {
                  path: 'a.md',
                  size: 3,
                  contentType: 'text/markdown',
                  updatedAt: 1,
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
      ),
    });
    const files = await api.listFiles('p1');
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe('a.md');
  });

  it('round-trips binary sync payloads', async () => {
    let seenUrl = '';
    const api = new ApiClient({
      baseUrl: BASE,
      fetch: mockFetch(async (req) => {
        seenUrl = req.url;
        const body = new Uint8Array(await req.arrayBuffer());
        return new Response(body, { status: 200 });
      }),
    });
    const update = new Uint8Array([9, 8, 7]);
    expect(await api.syncPush('p1', 'chapter.md', update)).toEqual(update);
    expect(seenUrl).toBe(`${BASE}/projects/p1/sync/chapter.md`);
  });

  it('passes the state vector as a base64url query parameter', async () => {
    let url = '';
    const api = new ApiClient({
      baseUrl: BASE,
      fetch: mockFetch((req) => {
        url = req.url;
        return new Response(new Uint8Array(), { status: 200 });
      }),
    });
    await api.syncPull('p1', 'images/a b.md', new Uint8Array([255, 254]));
    expect(url).toBe(`${BASE}/projects/p1/sync/images/a%20b.md?sv=__4`);
  });

  it('throws ApiError on a failed request', async () => {
    const api = new ApiClient({
      baseUrl: BASE,
      fetch: mockFetch(() => new Response(null, { status: 500 })),
    });
    await expect(api.readFile('p1', 'a.md')).rejects.toBeInstanceOf(ApiError);
  });

  it('builds a websocket url with the access token', () => {
    const api = new ApiClient({ baseUrl: BASE });
    expect(api.syncWebSocketUrl('p1', 'chapter.md', 'tok')).toBe(
      'wss://sync.example/projects/p1/sync-ws/chapter.md?access_token=tok',
    );
  });

  it('builds a websocket url when baseUrl is a relative path', () => {
    // Browsers running against an in-process dev API see `baseUrl = '/api'`;
    // the WS URL must resolve against the document origin instead of failing
    // with `Invalid URL`.
    const originalLocation = globalThis.location;
    Object.defineProperty(globalThis, 'location', {
      value: { origin: 'https://app.example' },
      configurable: true,
    });
    try {
      const api = new ApiClient({ baseUrl: '/api' });
      expect(api.syncWebSocketUrl('p1', 'chapter.md', 'tok')).toBe(
        'wss://app.example/api/projects/p1/sync-ws/chapter.md?access_token=tok',
      );
    } finally {
      if (originalLocation === undefined) {
        Reflect.deleteProperty(globalThis, 'location');
      } else {
        Object.defineProperty(globalThis, 'location', {
          value: originalLocation,
          configurable: true,
        });
      }
    }
  });
});
