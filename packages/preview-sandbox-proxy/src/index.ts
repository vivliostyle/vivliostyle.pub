// PR builds are Worker versions whose preview URLs exist only on workers.dev,
// and a zone route always reaches the active deployment, so each PR's sandbox
// hosts are proxied to its preview alias. The sandbox identifier and alias
// naming here must match `.github/workflows/build-deploy.yml`.
const sandboxLabelPattern = /--(\d+)-pr-preview-vspub$/;

function previewOrigin(prNumber: string): string {
  return `https://pr-preview-${prNumber}-vivliostyle-pub-app.vivliostyle.workers.dev`;
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const prNumber = url.hostname.split('.')[0].match(sandboxLabelPattern)?.[1];
    if (!prNumber) {
      return new Response('Not Found', { status: 404 });
    }

    const upstreamOrigin = previewOrigin(prNumber);
    // Resolving the path against the origin would let a `//host/...` path
    // replace the host; the setters keep it.
    const upstreamUrl = new URL(upstreamOrigin);
    upstreamUrl.pathname = url.pathname;
    upstreamUrl.search = url.search;
    const upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: 'manual',
    });

    const headers = new Headers(upstream.headers);
    // `_headers` grants CORP to sandbox hosts by hostname, which the upstream
    // request no longer has.
    headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
    const location = headers.get('Location');
    if (location) {
      const target = new URL(location, upstreamOrigin);
      if (target.origin === upstreamOrigin) {
        headers.set(
          'Location',
          `${url.origin}${target.pathname}${target.search}${target.hash}`,
        );
      }
    }
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  },
};
