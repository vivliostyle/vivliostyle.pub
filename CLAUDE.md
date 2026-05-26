# Agent guide

This file provides guidance to AI coding agents (Claude Code, GitHub Copilot, Cursor, Codex, etc.) when working with code in this repository. It is the canonical source — `AGENTS.md` and `CLAUDE.md` point to the same content.

## Execution policy

**All operations performed by AI agents in this repository must be executed inside the agent harness's sandbox.** This applies to every shell command, build, test, lint, formatter, codegen, file write, network call, and any other side-effectful action — without exception.

- Do not disable, bypass, or escalate out of the sandbox to "make a command work." If a command genuinely cannot run inside the sandbox (e.g. an installer that fundamentally requires unrestricted network or filesystem access), stop and ask the human operator before proceeding.
- Read-only inspection (e.g. reading files via the agent's Read tool, searching the codebase) is also expected to go through the sandboxed tooling rather than ad-hoc shell escapes.
- Sandbox-denied paths (such as `secrets/`) must not be accessed by trying to widen permissions; treat the denial as a signal that the file is intentionally off-limits.

If you encounter a sandbox restriction that blocks legitimate work, surface it to the user and let them decide — don't silently retry with the sandbox disabled.

> **Note on pnpm:** the repo's `.npmrc` is tuned so that `pnpm install` (and every other pnpm command) completes inside the sandbox:
>
> - `store-dir` / `cache-dir` / `state-dir` are pinned to `./.pnpm-store`, `./.pnpm-cache`, `./.pnpm-state` (in-repo, sandbox-writable). Don't relocate them back to the home directory.
> - `virtual-store-dir` is `${PNPM_VIRTUAL_STORE_DIR:-node_modules/.pnpm}`. Some npm packages (e.g. `iconv-lite`) ship a `.idea/codeStyles/...` directory in their tarball; some agent sandboxes block writes anywhere under `.idea/**` to protect IDE config. Setting `PNPM_VIRTUAL_STORE_DIR` to a sandbox-writable temp path (e.g. `/tmp/claude/vsp-vstore` or `$TMPDIR/vsp-vstore`) moves the package extraction (including those `.idea` paths) outside `node_modules` and the sandbox's protected scope.
>
> Claude Code agents auto-inherit `PNPM_VIRTUAL_STORE_DIR=/tmp/claude/vsp-vstore` via this repo's `.claude/settings.json`. Other agent harnesses must export it manually before running `pnpm install`. CI and human shells leave it unset and fall back to the default in-`node_modules` virtual store.

## Repository overview

Vivliostyle Pub is a browser-based book authoring/editing/publishing app built on the [Vivliostyle](https://vivliostyle.org/) CSS typesetting engine. The entire Vivliostyle CLI toolchain (including a Vite dev server) runs **inside a Web Worker in the browser**, with no backend — the project is deployed as static assets to Cloudflare Workers.

This is a pnpm + Turbo monorepo. Node 24 + pnpm 11.

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

### Before starting the dev server

Before running `pnpm dev` (or any other long-running server like `vite`/`wrangler dev`), always check whether the user already has one running. Examples of cheap checks:

- `lsof -iTCP:5173 -sTCP:LISTEN` (or whichever port the server uses)
- `ps -A | grep -E 'vite|wrangler'`
- Ask the user if unsure.

Spawning a second dev server on top of an existing one wastes the user's time, can cause port collisions, and may interfere with their in-progress browser session.

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
  - `scripts/build-viewer-resource.ts` — copies the `@vivliostyle/viewer` static assets into `dist/viewer/` for the iframe SW to proxy. Invoked via `node --import tsx` (not the `tsx` CLI) because the tsx CLI binds a Unix domain socket at `/tmp/tsx-<uid>/` for IPC, which some sandboxes block. `@vivliostyle/viewer` is declared as a direct dep of `@v/cli-bundle` so this script can `require.resolve` it under pnpm's isolated layout.
  - **Filesystem API** — beyond the build/serve lifecycle, the bundle also exports direct memfs operations so the host can sync project state across the Comlink boundary: `read` / `write` / `rm` (file ops), `fromJSON` / `toJSON` (memfs JSON-snapshot format), `fromBinarySnapshot` / `toBinarySnapshot` (CBOR binary snapshots via `@jsonjoy.com/fs-snapshot`), and `printTree` (debug tree via `@jsonjoy.com/fs-print`).

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

Tests (`src/index.test.ts`) validate the build artifact, not behavior: they parse `dist/index.js` with `rolldown/parseAst` and check that all expected exports exist (`setupServer`, `teardownServer`, `serve`, `setupTemplate`, `buildEpub`, `buildWebPub`, `exportProjectZip`, `fromJSON`, `toJSON`, `read`, `write`, `rm`, `fromBinarySnapshot`, `toBinarySnapshot`, `printTree`, `webSocketConnect`). Booting the bundle in jsdom/happy-dom doesn't work (see comment in the file).

## Conventions

- **Comments explain *why*, not *what*.** Don't write comments that paraphrase the code below them — well-named identifiers already convey the *what*. Reserve comments for behaviour that is counter-intuitive from the code alone: a hidden invariant, a workaround for a specific upstream bug, a non-obvious ordering constraint, a deliberate departure from a sibling code path. If removing a comment would not leave a future reader confused, don't write it. Avoid restating the surrounding diff or task ("added for X flow", "used by Y caller") — that context belongs in the commit message / PR description and rots quickly. Look at `packages/cli-bundle/rolldown.config.ts` for the intended density.
- **Biome** (`biome.json`) is the only formatter/linter. Single quotes, semicolons, 2-space indent. Import order is enforced: URLs → protocol packages → third-party packages → blank line → `@v/*` and relative imports.
- **pnpm catalog**: dependency versions are pinned in `pnpm-workspace.yaml`'s `catalog:` section, and packages reference them with `"catalog:"`. When upgrading a dep, edit the catalog (not the individual `package.json`).
- **Patches**: `patches/buffer@6.0.3.patch` is applied via `patchedDependencies` in `pnpm-workspace.yaml` (moved there from `package.json#pnpm.patchedDependencies` in pnpm 11). The `allowBuilds` key in the same file controls which packages may run install scripts.
- **Husky pre-commit** runs `lint-staged` (Biome format) and `pnpm check`.
- **Agent guidance lives only in this file.** No `.cursor/rules`, `.cursorrules`, or `.github/copilot-instructions.md` exist — `AGENTS.md` is a symlink to `CLAUDE.md` so every agent reads the same source. If you need to extend the guide, edit `CLAUDE.md`.

## Internationalization (i18n)

The host React UI (`@v/viola`) is localized with **[inlang Paraglide JS](https://inlang.com/m/gerre34r/library-inlang-paraglideJs)** (compiler-based, tree-shakeable). The CLI worker / iframe (`@v/cli-bundle`, the Vivliostyle CLI itself) is out of scope.

All i18n data, config, and scripts live inside the **`@v/viola` package** (`packages/viola/`), not the repo root — viola is the only consumer.

- **Source of truth**: `packages/viola/messages/{locale}.json` (inlang message format). Base locale is `en`; target locales `ja`, `zh`, `ko`. Config lives in `packages/viola/project.inlang/settings.json`.
- **Generated code**: `paraglideVitePlugin` (in `packages/viola/vite.config.ts`) compiles messages into `packages/viola/src/generated/paraglide/` (the whole `src/generated/` tree is git-ignored and ignored by Biome; paraglide also self-emits its own `.gitignore`). `tsc` reads the emitted `.d.ts` files (the project does not set `allowJs`), so the compile must run before typecheck — the viola `build`/`typecheck` scripts chain `pnpm paraglide` first.
- **Vendored plugins**: the inlang message-format + m-function-matcher plugins are vendored under `packages/viola/inlang-plugins/*.js` and referenced by relative path in `settings.json` (NOT jsdelivr URLs). This keeps compilation fully offline/reproducible inside the agent sandbox (jsdelivr is not in the network allowlist) and lets web tools read them straight from the repo. To bump a plugin: `npm pack <plugin>@<version>`, replace the vendored bundle, and update the path.

### Message key naming (flat snake_case)

- Flat, underscore-separated keys with a feature-area prefix: **`{area}_{element}[_{descriptor}]`** — e.g. `side_menu_open_project`, `bibliography_book_title_label`. No nesting. Call as `m.side_menu_open_project()`.
- area prefixes mirror the source location: `side_menu_`, `bibliography_`, `theme_`, `media_`, `start_`/`new_project_`, `preview_`/`edit_`, `image_menu_`. Use `common_` only for genuinely shared words (`common_cancel`, `common_untitled`).
- **Don't reuse** keys across contexts (unique key per instance) except the governed `common_` namespace — identical English can translate differently by context.
- Accessibility strings take a `_aria` suffix (`side_menu_open_workspace_aria`). Interpolation uses ICU `{name}` placeholders; pluralization/gender uses ICU `plural`/`select`.
- Name keys semantically by hand — do **not** derive them from the English text (so editing copy never churns keys).

### Adding / editing messages

Three equivalent paths, all land as normal PRs that maintainers review:
1. **Source (humans & AI agents)**: add the key to `packages/viola/messages/en.json`, use `m.<key>()` in code, then run `pnpm --filter @v/viola i18n:translate` to fill the other locales. `pnpm --filter @v/viola paraglide` regenerates types.
2. **Web UI (non-developers)**: [Fink](https://fink.inlang.com) — connect the GitHub repo, edit in the browser, opens a PR.
3. **VS Code**: the [Sherlock](https://inlang.com/m/r7kp499g/app-inlang-ideExtension) extension for inline extraction/editing.

- **Machine translation**: `pnpm --filter @v/viola i18n:translate` (inlang CLI, Google Cloud Translation v2). It only fills empty/missing messages, so human edits are preserved. Needs `INLANG_GOOGLE_TRANSLATE_API_KEY`. CI runs it via `.github/workflows/i18n-translate.yml` whenever `packages/viola/messages/en.json` changes and commits the result back.
- **Validation**: `pnpm --filter @v/viola i18n:validate` (runs in the `i18n` CI job).

## Deployment

Cloudflare Workers via Wrangler. `wrangler.toml` serves `packages/viola/dist/` as a SPA. The GitHub Actions workflow `build-deploy.yml` deploys `main` to `alpha.vivliostyle.pub` and PR previews to `pr-preview-<n>-vivliostyle-pub-app.vivliostyle.workers.dev`.
