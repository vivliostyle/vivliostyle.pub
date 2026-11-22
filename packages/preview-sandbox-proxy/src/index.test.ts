import { afterEach, describe, expect, it, vi } from 'vitest';

import worker from './index';

const sandboxHost =
  'sandbox-0123456789abcdefghijklmno--83-pr-preview-vspub.vspub.dev';
const upstreamOrigin =
  'https://pr-preview-83-vivliostyle-pub-app.vivliostyle.workers.dev';

function stubUpstream(response: Response) {
  const fetchMock = vi.fn<typeof fetch>(async () => response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function upstreamCall(fetchMock: ReturnType<typeof stubUpstream>) {
  const [input, init] = fetchMock.mock.calls[0];
  return { url: new URL(String(input)), init: init ?? {} };
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
    const { url, init } = upstreamCall(fetchMock);
    expect(url.href).toBe(`${upstreamOrigin}/_cli/index.js?v=1`);
    expect(init.redirect).toBe('manual');
    expect(new Headers(init.headers).get('If-None-Match')).toBe('"etag"');
  });

  it('forwards the method and body', async () => {
    const fetchMock = stubUpstream(new Response('ok'));

    await worker.fetch(
      new Request(`https://${sandboxHost}/upload`, {
        method: 'POST',
        body: 'payload',
      }),
    );

    const { init } = upstreamCall(fetchMock);
    expect(init.method).toBe('POST');
    expect(await new Response(init.body).text()).toBe('payload');
  });

  it('never lets the path change the upstream host', async () => {
    const fetchMock = stubUpstream(new Response('ok'));

    await worker.fetch(
      new Request(`https://${sandboxHost}//evil.example/steal?x=1`),
    );

    const { url } = upstreamCall(fetchMock);
    expect(url.origin).toBe(upstreamOrigin);
    expect(url.pathname).toBe('//evil.example/steal');
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

  it('passes a bodiless 304 through', async () => {
    stubUpstream(new Response(null, { status: 304 }));

    const response = await worker.fetch(new Request(`https://${sandboxHost}/`));

    expect(response.status).toBe(304);
    expect(response.body).toBeNull();
  });

  it.each([
    ['an absolute', `${upstreamOrigin}/sandbox?x=1`],
    ['a relative', '/sandbox?x=1'],
  ])('maps %s redirect onto the sandbox host', async (_, location) => {
    stubUpstream(
      new Response(null, { status: 307, headers: { Location: location } }),
    );

    const response = await worker.fetch(
      new Request(`https://${sandboxHost}/sandbox/index.html`),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('Location')).toBe(
      `https://${sandboxHost}/sandbox?x=1`,
    );
  });

  it.each([
    ['to another origin', 'https://example.com/elsewhere'],
    ['that does not parse', 'http://[bad'],
  ])('leaves a redirect %s untouched', async (_, location) => {
    stubUpstream(
      new Response(null, { status: 302, headers: { Location: location } }),
    );

    const response = await worker.fetch(new Request(`https://${sandboxHost}/`));

    expect(response.headers.get('Location')).toBe(location);
  });

  it.each([
    ['without a PR number', 'sandbox-draft--pr-preview-vspub'],
    ['with a leading-zero PR number', 'sandbox-draft--083-pr-preview-vspub'],
    ['without the sandbox prefix', 'app--83-pr-preview-vspub'],
  ])('rejects a host %s', async (_, label) => {
    const fetchMock = stubUpstream(new Response('ok'));

    const response = await worker.fetch(
      new Request(`https://${label}.vspub.dev/`),
    );

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
