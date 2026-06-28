// Host page origin (`https://<VITE_APP_HOSTNAME>`, plus the dev server port).
export function appOrigin(): string {
  let origin = `https://${import.meta.env.VITE_APP_HOSTNAME}`;
  if (import.meta.env.DEV && location.port) {
    origin += `:${location.port}`;
  }
  return origin;
}

// Base origin that per-sandbox subdomains are derived from. Defaults to the app
// origin; `VITE_SANDBOX_HOSTNAME` overrides it to host sandboxes on a separate
// base domain (the wildcard `sandbox-*` cert/DNS must cover whichever is used).
export function sandboxBaseOrigin(): string {
  return import.meta.env.VITE_SANDBOX_HOSTNAME
    ? `https://${import.meta.env.VITE_SANDBOX_HOSTNAME}`
    : appOrigin();
}

// Optional identifier for the sandbox subdomain
function sandboxSubdomainIdentifier(): string {
  return import.meta.env.VITE_SANDBOX_SUBDOMAIN_IDENTIFIER
    ? `--${import.meta.env.VITE_SANDBOX_SUBDOMAIN_IDENTIFIER}`
    : '';
}

// Origin for a sandbox subdomain with the given hostname-label prefix, e.g.
// `sandbox-<projectId>` or `sandbox-ext-<extensionId>`.
export function sandboxOrigin(label: string): string {
  const url = new URL(sandboxBaseOrigin());
  url.hostname = `${label}${sandboxSubdomainIdentifier()}.${url.hostname}`;
  return url.origin;
}
