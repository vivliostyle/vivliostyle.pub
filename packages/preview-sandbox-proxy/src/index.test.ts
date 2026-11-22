import { afterEach, describe, expect, it, vi } from 'vitest';

import worker from './index';

const sandboxHost =
  'sandbox-0123456789abcdefghijklmno--83-pr-preview-vspub.vspub.dev';
const upstreamOrigin =
  'https://pr-preview-83-vivliostyle-pub-app.vivliostyle.workers.dev';

function stubUpstream(response: Response) {
  const fetchMock = vi.fn(async () => response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('preview sandbox proxy', () => {
  it("forwards the request to the PR's preview alias", async () => {
    const fetchMock = stubUpstream(new Response('ok'));

    await worker.fetch(
      new Request(`https://${sandboxHost}/_cli/index.js?v=1`, {
        headers: { 'If-None-Match': '"etag"' },
      }),
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [target, init] = fetchMock.mock.calls[0] as unknown as [
      URL,
      RequestInit,
    ];
    expect(target.href).toBe(`${upstreamOrigin}/_cli/index.js?v=1`);
    expect(init.redirect).toBe('manual');
    expect(new Headers(init.headers).get('If-None-Match')).toBe('"etag"');
  });

  it('never lets the path change the upstream host', async () => {
    const fetchMock = stubUpstream(new Response('ok'));

    await worker.fetch(
      new Request(`https://${sandboxHost}//evil.example/steal?x=1`),
    );

    const [target] = fetchMock.mock.calls[0] as unknown as [URL];
    expect(target.origin).toBe(upstreamOrigin);
    expect(target.pathname).toBe('//evil.example/steal');
  });

  it('keeps upstream headers and adds CORP', async () => {
    stubUpstream(
      new Response('<!doctype html>', {
        headers: { 'Cross-Origin-Embedder-Policy': 'require-corp' },
      }),
    );

    const response = await worker.fetch(new Request(`https://${sandboxHost}/`));

    expect(await response.text()).toBe('<!doctype html>');
    expect(response.headers.get('Cross-Origin-Embedder-Policy')).toBe(
      'require-corp',
    );
    expect(response.headers.get('Cross-Origin-Resource-Policy')).toBe(
      'cross-origin',
    );
  });

  it('rewrites redirects to the upstream origin onto the sandbox host', async () => {
    stubUpstream(
      new Response(null, {
        status: 307,
        headers: { Location: `${upstreamOrigin}/sandbox?x=1` },
      }),
    );

    const response = await worker.fetch(
      new Request(`https://${sandboxHost}/sandbox/index.html`),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('Location')).toBe(
      `https://${sandboxHost}/sandbox?x=1`,
    );
  });

  it('leaves redirects to other origins untouched', async () => {
    stubUpstream(
      new Response(null, {
        status: 302,
        headers: { Location: 'https://example.com/elsewhere' },
      }),
    );

    const response = await worker.fetch(new Request(`https://${sandboxHost}/`));

    expect(response.headers.get('Location')).toBe(
      'https://example.com/elsewhere',
    );
  });

  it('rejects hosts without a PR number', async () => {
    const fetchMock = stubUpstream(new Response('ok'));

    const response = await worker.fetch(
      new Request('https://sandbox-draft--pr-preview-vspub.vspub.dev/'),
    );

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
