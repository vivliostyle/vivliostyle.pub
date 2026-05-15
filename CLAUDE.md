# Agent guide

This file provides guidance to AI coding agents (Claude Code, GitHub Copilot, Cursor, Codex, etc.) when working with code in this repository. It is the canonical source — `AGENTS.md` and `CLAUDE.md` point to the same content.

## Execution policy

**All operations performed by AI agents in this repository must be executed inside the agent harness's sandbox.** This applies to every shell command, build, test, lint, formatter, codegen, file write, network call, and any other side-effectful action — without exception.

- Do not disable, bypass, or escalate out of the sandbox to "make a command work." If a command genuinely cannot run inside the sandbox (e.g. an installer that fundamentally requires unrestricted network or filesystem access), stop and ask the human operator before proceeding.
- Read-only inspection (e.g. reading files via the agent's Read tool, searching the codebase) is also expected to go through the sandboxed tooling rather than ad-hoc shell escapes.
- Sandbox-denied paths (such as `secrets/`) must not be accessed by trying to widen permissions; treat the denial as a signal that the file is intentionally off-limits.

If you encounter a sandbox restriction that blocks legitimate work, surface it to the user and let them decide — don't silently retry with the sandbox disabled.

## Repository overview

Vivliostyle Pub is a browser-based book authoring/editing/publishing app built on the [Vivliostyle](https://vivliostyle.org/) CSS typesetting engine. The entire Vivliostyle CLI toolchain (including a Vite dev server) runs **inside a Web Worker in the browser**, with no backend — the project is deployed as static assets to Cloudflare Workers.

This is a pnpm + Turbo monorepo. Node 24 + pnpm 10.

## Common commands

Run from the repo root unless noted.

| Command | What it does |
| --- | --- |
| `pnpm dev` | Dev server (Turbo: builds `@v/cli-bundle` first, then `vite --host` for `@v/viola`). Requires HTTPS certs + `VITE_APP_HOSTNAME` — see *Local dev prerequisites*. |
| `pnpm build` | Full production build via Turbo. |
| `pnpm test` | Runs Vitest across packages (currently only `@v/cli-bundle` has real tests; others use `--passWithNoTests`). |
| `pnpm typecheck` | `tsc --noEmit` across all packages. |
| `pnpm check` | Biome lint + format check. Also enforced by the husky pre-commit hook. |
| `pnpm fix` | Biome auto-fix with `--unsafe`. |

Single-package and single-test invocations:

- `pnpm --filter @v/cli-bundle build` — bundle just `cli-bundle` (Rolldown).
- `pnpm --filter @v/cli-bundle dev` — Rolldown watch mode for `cli-bundle`.
- `pnpm --filter @v/cli-bundle exec vitest run src/index.test.ts` — single test file.
- `pnpm --filter @v/viola dev` — Vite dev server for the app alone (assumes `cli-bundle` is already built).

**Do not precede builds with `rm -rf dist`** while iterating — run the build script directly. All build, test, and verification commands must run inside the sandbox (see *Execution policy* above).

### Local dev prerequisites

`packages/viola/vite.config.ts` reads from `<repo>/secrets/`:

- `secrets/.env` — must define `VITE_APP_HOSTNAME` (the sandbox iframe origin is computed as `sandbox-*.${VITE_APP_HOSTNAME}`, so this must be a domain you have a wildcard cert + DNS for).
- `secrets/certs/privkey.pem`, `secrets/certs/fullchain.pem` — HTTPS is mandatory in dev because the app requires `Cross-Origin-Embedder-Policy: credentialless` (needed for `SharedArrayBuffer`, which Rolldown's WASI worker uses).

The `secrets/` directory is gitignored, and agent sandboxes are configured to deny reads from it. Agents must not attempt to bypass that restriction.

## Architecture

### Why this is unusual

`@v/cli-bundle` packages the **entire `@vivliostyle/cli` toolchain — Vite 8, Rolldown, `@vivliostyle/viewer`, jsdom, EPUB packing, etc. — to run inside a browser Web Worker**. The user's project files live in an in-memory `memfs` volume at `/workdir`, and Vite's dev server runs against that virtual FS. Builds (EPUB, Web Publication, Vivliostyle project zip) all happen client-side.

Most of the complexity in this repo is in making Node-targeted code run in a browser worker. When making changes near the worker bundle, expect to deal with Node-builtin polyfills, alias maps, and `import.meta.url` rewriting.

### Runtime topology

Three coordinated browser contexts (cross-origin isolation matters):

1. **Host page** (`${VITE_APP_HOSTNAME}`) — the React/TanStack Router app (`@v/viola`). Owns project state, mounts a service worker (`sw-host.ts`).
2. **Sandbox iframe** (`sandbox-<id>.${VITE_APP_HOSTNAME}`) — loaded into the host via the `serveCli` plugin. Subdomain isolation is intentional: the iframe runs untrusted user content. Mounts its own service worker (`sw-iframe.ts`) and spawns the CLI worker.
3. **CLI Web Worker** (inside the iframe) — loads `@v/cli-bundle` dist via the `#cli-bundle` virtual import → `/_cli/index.js`. Runs Vite + Vivliostyle CLI on memfs.

Communication is layered:

- **Comlink over BroadcastChannel** (`worker:cli`, `host:project`, `worker:theme-registry`). The iframe relays Comlink messages between the host's BroadcastChannel and a MessageChannel that bridges to the worker (see `packages/viola/src/iframe.ts`).
- **Service workers** intercept `/vivliostyle/...` and `/__vivliostyle-viewer/...` requests:
  - Host SW (`sw-host.ts`) forwards `/vivliostyle/...` to `cli.serve()` via the project channel.
  - Iframe SW (`sw-iframe.ts`) forwards `/vivliostyle/...` to the CLI worker's `serve()`, and proxies `/__vivliostyle-viewer/...` to the bundled Vivliostyle viewer assets served from `/_cli/viewer/`.

All responses set COEP `credentialless` + COOP `same-origin` + CORP `cross-origin`. Don't drop these headers — they're load-bearing for `SharedArrayBuffer` access.

### Package layout

- **`packages/viola/`** (`@v/viola`) — the React + Vite 8 app. Stack: React 19, TanStack Router (file-based, `routeTree.gen.ts` is generated), Tailwind v4, TipTap (markdown editing) + `@v/tiptap-extensions`, CodeMirror (raw source editing), valtio (`stores/proxies/*` are valtio proxies; `stores/actions/*` are command functions; `stores/accessors.ts` exposes them).
  - `templates/basic/`, `templates/minimal/` — project starter templates packed into `.tar.gz` on the fly by the `serveTemplates` Vite plugin and extracted into memfs via `setupTemplate`.
  - `src/client/` — service worker entry (`sw.ts` branches on hostname to call `setupSwHost` or `setupSwIframe`) and the CLI worker entry (`cli-worker.ts`).

- **`packages/cli-bundle/`** (`@v/cli-bundle`) — the browserified Vivliostyle CLI worker. Build is **Rolldown directly** (not Vite), config in `rolldown.config.ts`. Emits four outputs:
  1. `dist/index.js` — the worker bundle (ESM, ~5 MB).
  2. `dist/index.d.ts` — Comlink-typed remote interface.
  3. `dist/client/*.js` — `vite-client`, `custom-hmr`, `viewer-adapter` — injected into iframes served by the in-worker Vite.
  4. `dist/rolldown-wasi-worker.js` + `dist/rolldown-binding.wasm32-wasi.wasm` — WASI worker for `@rolldown/browser`.
  - `src/stubs/` — hand-written Node builtin shims layered on top of `unenv`. Look here first when fixing browser-incompat bugs.
  - `src/volume.ts` — pre-populates the memfs `node_modules` from `__volume__` (injected by Rolldown's `define`); `restoreBundledNodeModules()` re-installs them after `setupTemplate` wipes `/workdir`.
  - `scripts/build-viewer-resource.ts` — copies the `@vivliostyle/viewer` static assets into `dist/viewer/` for the iframe SW to proxy.

- **`packages/theme-registry/`** (`@v/theme-registry`) — in-browser npm theme fetcher: hits `registry.npmjs.org`, untars `.tgz`s with `@andrewbranch/untar.js`, and bundles theme CSS using `lightningcss-wasm`.

- **`packages/tiptap-extensions/`** (`@v/tiptap-extensions`) — custom TipTap nodes/marks. Owns markdown ⇄ prosemirror conversion via `@handlewithcare/remark-prosemirror`.

- **`packages/ui/`** (`@v/ui`) — Radix UI primitives wrapped in a shadcn-style component layer. Tailwind v4.

- **`packages/config/`** (`@v/config`) — shared `tsconfig` bases and `get-project-root.js` (used to locate `secrets/`).

### The cli-bundle build, in more detail

`rolldown.config.ts` is dense and load-bearing — the comments in it explain *why* each plugin / alias exists. Quick map for navigation:

- `aliasMap` — base alias set from `unenv`, overridden per builtin where unenv falls short (e.g. `crypto.createHash` is `notImplemented` in unenv; `memfs` replaces unenv's in-memory `fs`; `worker_threads` needs a real `globalThis.Worker`).
- `redirectRolldownToBrowserPlugin` — Vite 8 imports `rolldown` internally; this redirects to `@rolldown/browser/dist/*.browser.mjs`.
- `patchRolldownBindingPlugin` — rewrites the two `new URL(..., import.meta.url)` calls inside `rolldown-binding.wasi-browser.js` to absolute `/_cli/...` URLs **before** `resolveImportMetaPlugin` rewrites them.
- `resolveImportMetaPlugin` — replaces `import.meta.url|env|require` AST nodes with virtual `file:///workdir/node_modules/<pkg>/...` URLs so packages that read `import.meta.url` (e.g. for self-locating) get a stable, parse-safe value.
- `patchEmnapiEnvDetectionPlugin` — forces `ENVIRONMENT_IS_NODE = false` in `@emnapi/*` so the WASM binding doesn't take Node-only code paths.
- `resolveViteClientPlugin` — inlines Vite's `client.mjs` / `env.mjs` with all `__DEFINES__` / `__HMR_*__` placeholders filled in (since the in-worker Vite never goes through Vite's normal client-injection pipeline).

Tests (`src/index.test.ts`) validate the build artifact, not behavior: they parse `dist/index.js` with `rolldown/parseAst` and check that all expected exports exist. Booting the bundle in jsdom/happy-dom doesn't work (see comment in the file).

## Conventions

- **Biome** (`biome.json`) is the only formatter/linter. Single quotes, semicolons, 2-space indent. Import order is enforced: URLs → protocol packages → third-party packages → blank line → `@v/*` and relative imports.
- **pnpm catalog**: dependency versions are pinned in `pnpm-workspace.yaml`'s `catalog:` section, and packages reference them with `"catalog:"`. When upgrading a dep, edit the catalog (not the individual `package.json`).
- **Patches**: `patches/buffer@6.0.3.patch` is applied via `pnpm.patchedDependencies`.
- **Husky pre-commit** runs `lint-staged` (Biome format) and `pnpm check`.
- **Agent guidance lives only in this file.** No `.cursor/rules`, `.cursorrules`, or `.github/copilot-instructions.md` exist — `AGENTS.md` is a symlink to `CLAUDE.md` so every agent reads the same source. If you need to extend the guide, edit `CLAUDE.md`.

## Deployment

Cloudflare Workers via Wrangler. `wrangler.toml` serves `packages/viola/dist/` as a SPA. The GitHub Actions workflow `build-deploy.yml` deploys `main` to `alpha.vivliostyle.pub` and PR previews to `pr-preview-<n>-vivliostyle-pub-app.vivliostyle.workers.dev`.
