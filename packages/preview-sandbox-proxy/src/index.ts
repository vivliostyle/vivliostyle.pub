// The sandbox identifier and preview alias naming must match
// `.github/workflows/build-deploy.yml`.
const sandboxLabelPattern = /^sandbox-.+--([1-9]\d*)-pr-preview-vspub$/;

function previewOrigin(prNumber: string): string {
  return `https://pr-preview-${prNumber}-vivliostyle-pub-app.vivliostyle.workers.dev`;
}

function rewriteLocation(
  location: string,
  upstreamOrigin: string,
  sandboxOrigin: string,
): string {
  let target: URL;
  try {
    target = new URL(location, upstreamOrigin);
  } catch {
    return location;
  }
  return target.origin === upstreamOrigin
    ? `${sandboxOrigin}${target.pathname}${target.search}${target.hash}`
    : location;
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
      headers.set(
        'Location',
        rewriteLocation(location, upstreamOrigin, url.origin),
      );
    }
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  },
};
