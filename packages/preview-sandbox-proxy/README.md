# @v/preview-sandbox-proxy

A Cloudflare Worker that serves PR-preview sandbox hosts on `vspub.dev`.

PR previews are Worker versions (`wrangler versions upload --preview-alias pr-preview-<n>`). Version URLs exist only on workers.dev, and a zone route can't reach them. This Worker holds the one route for all PR sandbox hosts and proxies each request to the PR's preview:

```
sandbox-<label>--<n>-pr-preview-vspub.vspub.dev/<path>
  → pr-preview-<n>-vivliostyle-pub-app.vivliostyle.workers.dev/<path>
```

It also adds `Cross-Origin-Resource-Policy: cross-origin` and maps upstream redirects back onto the sandbox host. Hosts that don't match get a 404.

The identifier and alias names must match `.github/workflows/build-deploy.yml`. The sandbox label has to stay within 63 characters, which holds for PR numbers up to 11 digits.
