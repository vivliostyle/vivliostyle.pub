# Agent guide

This file provides guidance to AI coding agents (Claude Code, GitHub Copilot, Cursor, Codex, etc.) when working with code in this repository. It is the canonical source — `AGENTS.md` and `CLAUDE.md` point to the same content.

## Generative AI policy

This project is funded by NLnet and discloses its generative AI usage in [`AI_POLICY.md`](AI_POLICY.md). Agents must follow that policy:

- Add an `Assisted-by:` trailer naming the agent and the exact model version to every commit that contains AI-generated changes, in the Linux-kernel format `Assisted-by: AGENT_NAME:MODEL_VERSION`, e.g. `Assisted-by: Claude Code:claude-fable-5`. Do not add a `Co-authored-by:` trailer for the AI.
- When drafting a pull request description, include the same `Assisted-by:` line in the body, and describe the human/AI division of labor (what was delegated to the AI, and what the human contributor designed, decided, reviewed, and verified) inside a `<details>` block, following the example in `AI_POLICY.md`.
- Never emit code that reproduces third-party copyrighted material.

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
| `pnpm dev` | Dev server (Turbo: builds `@v/cli-bundle` and `@v/viewer` first, then `vite` for `@v/viola`; `server.host` is forced on in `vite.config.ts`). Requires `VITE_APP_HOSTNAME` — see *Local dev prerequisites*. |
| `pnpm build` | Full production build via Turbo. |
| `pnpm test` | Runs Vitest across packages (packages without tests use `--passWithNoTests`). |
| `pnpm typecheck` | `tsc --noEmit` across all packages. |
| `pnpm check` | Biome lint + format check. Also enforced by the husky pre-commit hook. |
| `pnpm fix` | Biome auto-fix with `--unsafe`. |

Single-package and single-test invocations:

- `pnpm --filter @v/cli-bundle build` — bundle just `cli-bundle` (Rolldown).
- `pnpm --filter @v/cli-bundle dev` — Rolldown watch mode for `cli-bundle`.
- `pnpm --filter @v/cli-bundle exec vitest run src/index.test.ts` — single test file.
- `pnpm --filter @v/viola dev` — Vite dev server for the app alone (assumes `cli-bundle` and `viewer` are already built).

**Do not precede builds with `rm -rf dist`** while iterating — run the build script directly. All build, test, and verification commands must run inside the sandbox (see *Execution policy* above).

### Local dev prerequisites

`packages/viola/vite.config.ts` reads its env from `<repo>/secrets/` (`envDir`), with the `VITE_`/`API_` prefixes:

- `secrets/.env` — must define `VITE_APP_HOSTNAME` (the host page origin). The sandbox iframe origin defaults to `sandbox-*.${VITE_APP_HOSTNAME}`; set `VITE_SANDBOX_HOSTNAME` to host the sandbox subdomain on a different base domain. Either way the iframe needs a wildcard cert + DNS for the `sandbox-*` subdomain.
- HTTPS in dev is opt-in via `VITE_DEV_SERVER_HTTPS` — when set, Vite reads `secrets/certs/privkey.pem` + `secrets/certs/fullchain.pem`. The app needs `Cross-Origin-Embedder-Policy: require-corp` for `SharedArrayBuffer` (used by Rolldown's WASI worker), so a secure context is required; serve over HTTPS, or front the dev server with an HTTPS-terminating proxy (then leave `VITE_DEV_SERVER_HTTPS` unset).

The `secrets/` directory is gitignored, and agent sandboxes are configured to deny reads from it. Agents must not attempt to bypass that restriction.

### Before starting the dev server

Before running `pnpm dev` (or any other long-running server like `vite`/`wrangler dev`), always check whether the user already has one running. Examples of cheap checks:

- `lsof -iTCP:5173 -sTCP:LISTEN` (or whichever port the server uses)
- `ps -A | grep -E 'vite|wrangler'`
- Ask the user if unsure.

Spawning a second dev server on top of an existing one wastes the user's time, can cause port collisions, and may interfere with their in-progress browser session.

## Architecture

### Why this is unusual

`@v/cli-bundle` packages the **entire `@vivliostyle/cli` toolchain — Vite 8, Rolldown, jsdom, EPUB packing, etc. — to run inside a browser Web Worker**. The user's project files live in an in-memory `memfs` volume at `/workdir`, and Vite's dev server runs against that virtual FS. Builds (EPUB, Web Publication, Vivliostyle project zip) all happen client-side.

Most of the complexity in this repo is in making Node-targeted code run in a browser worker. When making changes near the worker bundle, expect to deal with Node-builtin polyfills, alias maps, and `import.meta.url` rewriting.

### Runtime topology

Four coordinated browser contexts (cross-origin isolation matters):

1. **Host page** (`${VITE_APP_HOSTNAME}`) — the React/TanStack Router app (`@v/viola`). Owns project state, mounts a service worker (`sw-host.ts`).
2. **Sandbox iframe** (`sandbox-<id>.${VITE_APP_HOSTNAME}`) — loaded into the host via the `serveCli` plugin. Subdomain isolation is intentional: the iframe runs untrusted user content. Mounts its own service worker (`sw-iframe.ts`) and spawns the CLI worker.
3. **CLI Web Worker** (inside the iframe) — loads `@v/cli-bundle` dist via the `#cli-bundle` virtual import → `/_cli/index.js`. Runs Vite + Vivliostyle CLI on memfs.
4. **Viewer stage** (`@v/viewer`, served at `/_viewer/` by both origins) — the document that renders the publication's pages. The preview extension embeds it on the project's sandbox origin. Printing opens it as a top-level tab on the host origin instead: Firefox crashes printing the nested isolated iframe, and a top-level sandbox-origin tab would sit in a storage partition of its own, out of reach of the CLI worker.

Communication is layered:

- **Comlink over BroadcastChannel** (`worker:cli`, `host:project`, `worker:theme-registry`). The iframe relays Comlink messages between the host's BroadcastChannel and a MessageChannel that bridges to the worker (see `packages/viola/src/iframe.ts`).
- **The in-worker Vite's HMR payloads** go to a BroadcastChannel on the sandbox origin (`worker:vite-hmr`) instead of a WebSocket; the preview stage subscribes to it and reloads in place. No Vite client runs anywhere.
- **The preview stage is driven through Comlink over a `MessagePort`** that its embedder transfers to it; the stage and the extension view embedding it are on different origins, so everything goes through that controller.
- **Service workers** intercept `/vivliostyle/...` requests and leave the app's static assets (`/_cli/`, `/_viewer/`) to the network:
  - Host SW (`sw-host.ts`) relays them over the project channel to the host tab that owns the project (the print tab addresses it as `/vivliostyle/p/<projectId>/...`), which serves them through `cli.serve()`.
  - Iframe SW (`sw-iframe.ts`) forwards them to the CLI worker's `serve()`.

All responses set COEP `require-corp` + COOP `same-origin` + CORP `cross-origin`. Don't drop these headers — they're load-bearing for `SharedArrayBuffer` access. Because `require-corp` (unlike `credentialless`) requires every cross-origin subresource to carry an explicit CORP header, the cross-origin assets the iframe pulls from the host origin must be served with CORP — see the `_headers` rules (prod) and the headers of the plugins that serve the CLI bundle and the stage (dev). The headers are mirrored in several places that must stay in sync: `packages/viola/public/_headers` (Cloudflare prod), `vite.config.ts` `server.headers` + those static-asset plugins (dev), the two service workers (`sw-utils.ts`, `sw-iframe.ts`), `@v/cli-bundle`'s `commonHeaders` in `src/index.ts`, and the CORP header that `@v/preview-sandbox-proxy` adds for PR-preview sandbox hosts.

### Package layout

- **`packages/viola/`** (`@v/viola`) — the React + Vite 8 app. Stack: React 19, TanStack Router (file-based, `routeTree.gen.ts` is generated), Tailwind v4, TipTap (markdown editing) + `@v/tiptap-extensions`, CodeMirror (raw source editing), valtio (`stores/proxies/*` are valtio proxies; `stores/actions/*` are commands that span stores; `stores/accessors.ts` exposes them).
  - `libs/` never imports `stores/` at runtime (type-only imports are fine). A helper in `libs/` that needs store state takes it from its caller as arguments or callbacks. I/O and pure logic that the proxies rely on belong in `libs/`. Static catalogs, such as the fixed lists of templates and themes, sit in their own module under `stores/`, not in a proxy class.
  - Store modules have no import-time side effects. Global wiring, such as enabling valtio op delivery or starting a channel relay, happens in a single init function that the app entry calls once. Tests that need the wiring call it themselves.
  - Components and routes may assign a single store field directly. A change that must keep one store's invariant is a method on that store's proxy, and callers use the method instead of writing those fields. Such changes include several fields that move together, or a check before the write. A store includes the objects it owns, so a method on an owning object may also write the objects under it.
  - A change that spans separate stores, or that needs the router or another action, is a function in `stores/actions/`. Proxies cannot import actions or the router, so anything that needs them is an action.
  - Call a method that writes on the proxy, never on a snapshot (`useSnapshot`/`snapshot()`). A snapshot keeps the methods and its type allows the call, but its fields are read-only, so a write through `this` throws. A method that only reads may be called on a snapshot. A plain-object proxy's method that writes is therefore an arrow function that writes through the variable holding the proxy, not through `this`. A class proxy's methods that write use `this` and must be called on the proxy. Work started in a class constructor runs on the unwrapped object, so its writes to the object's own fields notify no one; start it on the proxy after wrapping.
  - Where a valtio proxy lives:
    - State that several features or routes share, or that is persisted, goes in `stores/proxies/` (reached through `stores/accessors.ts`).
    - State that one feature owns for the page's lifetime stays in that feature's own module. A proxy under `libs/` still must not import `stores/`.
    - State tied to one mounted pane that must start fresh on every mount is a bunshi molecule scoped to the pane.
  - `templates/basic/`, `templates/minimal/` — project starter templates packed into `.tar.gz` on the fly by the `serveTemplates` Vite plugin and extracted into memfs via `setupTemplate`.
  - `src/client/` — service worker entry (`sw.ts` branches on hostname to call `setupSwHost` or `setupSwIframe`), the CLI worker entry (`cli-worker.ts`), and the host page's end of the `host:project` relay that the host SW forwards to.

- **`packages/cli-bundle/`** (`@v/cli-bundle`) — the browserified Vivliostyle CLI worker. Build is **Rolldown directly** (not Vite), config in `rolldown.config.ts`. Emits three outputs:
  1. `dist/index.js` — the worker bundle (ESM, ~5 MB).
  2. `dist/index.d.ts` — Comlink-typed remote interface.
  3. `dist/rolldown-wasi-worker.js` + `dist/rolldown-binding.wasm32-wasi.wasm` — WASI worker for `@rolldown/browser`.
  - `src/stubs/` — hand-written Node builtin shims layered on top of `unenv`. Look here first when fixing browser-incompat bugs.
  - `src/volume.ts` — pre-populates the memfs `node_modules` from `__volume__` (injected by Rolldown's `define`); `restoreBundledNodeModules()` re-installs them after `setupTemplate` wipes `/workdir`. Besides files of Vite and the CLI, it holds what the CLI looks up of the stock `@vivliostyle/viewer` at startup (its `package.json` and an empty `lib/`). Pub never serves the stock viewer; the package is only installed as the CLI's own dependency.
  - **Filesystem API** — beyond the build/serve lifecycle, the bundle also exports direct memfs operations so the host can sync project state across the Comlink boundary: `read` / `write` / `rm` (file ops), `fromJSON` / `toJSON` (memfs JSON-snapshot format), `fromBinarySnapshot` / `toBinarySnapshot` (CBOR binary snapshots via `@jsonjoy.com/fs-snapshot`), and `printTree` (debug tree via `@jsonjoy.com/fs-print`).

- **`packages/viewer/`** (`@v/viewer`) — Pub's own viewer, built with Vite into a static stage document on `@vivliostyle/core` (no stock `@vivliostyle/viewer`). The app copies the build to `/_viewer/`. In the preview it lays out once per load and presents pages in its own view modes, scale and paging without making core lay out again, and reloads in place on the HMR channel. With the print URL parameter it lays the publication out, opens the print dialog once every page is laid out, and closes the tab. Its only export is the protocol module (controller types and URL parameters) that embedders import.
  - Core puts the pages and its own CSS into the stage document, so the stage's CSS stays minimal, never styles page content, and keeps every presentation rule under `@media screen`: in print media only core's rules apply to the pages.
  - Logic that can be tested without a browser lives in pure modules with unit tests; the DOM wiring around them is not unit-tested. Those modules import `@vivliostyle/core` for types only, even indirectly: core touches `window` as soon as it is imported, and the tests run in Node.

- **`packages/theme-registry/`** (`@v/theme-registry`) — in-browser npm theme fetcher: hits `registry.npmjs.org`, untars `.tgz`s with `@andrewbranch/untar.js`, and bundles theme CSS using `lightningcss-wasm`.

- **`packages/tiptap-extensions/`** (`@v/tiptap-extensions`) — custom TipTap nodes/marks, and markdown ⇄ ProseMirror conversion on remark (unified + micromark), under `src/markdown/`. Manuscripts are typeset by VFM, whose current release reads markdown with the older remark-parse 8 rather than micromark, so the two disagree in places, e.g. on emphasis next to Japanese punctuation. Checking that saved markdown reads back with micromark is not checking what VFM reads; the package's tests run the installed VFM to pin down its reading of markdown the editor writes.
  - Syntax is described by **notation definitions**. One definition carries everything about one piece of syntax: the TipTap extensions for its schema, remark plugins (where micromark and mdast extensions plug in), handlers from mdast to ProseMirror, writers back to markdown, the writing styles it can vary between, and the characters that need escaping so text is not read as it. CommonMark and GFM are written as definitions too, and the editor's schema comes from the set it is given. Add syntax as a definition, not as a special case in the parser or writer. A definition can also be declared as plain data for syntax that needs no code.
  - Syntax no definition handles is kept as **raw markdown**: a raw block node or a raw inline mark holding the source as written, shown and edited as text, written back unchanged. So is a backslash escape of a character no definition gives meaning, since syntax that has no definition yet may still need it; a definition that escapes a character makes its escapes plain text.
  - Saving diffs the document against a **baseline**, the markdown it was last read from or written as. Unchanged blocks keep their source (top-level blocks, the children of edited lists and quotes, and moved blocks). Inside an edited textblock, the content that did not change keeps its source too, down to the character, and only what changed is written anew, in the styles the baseline uses most. Source that writes out a mark markdown would read into the text by itself, such as a link around its own URL, is written anew once what was next to it changed, since it may have been written out only to keep that out of it. Frontmatter, line endings and the trailing newline stay outside the document and come from the baseline. Nothing about the source is stored in the document, which is shared through Yjs.
  - Text is written without escapes first. Every save reads the whole file back, and every top-level block that reads differently is written again at once, more cautiously each time: first escaping only the characters that made the difference, then rewriting more of the block, then its neighbours. Giving up on the baseline is the last resort. When no markdown reads back as the document, the writer throws instead of returning it, and the app does not save but tells the user. A mark whose delimiters cannot open or close where it is, as next to Japanese brackets, is written as its HTML element, which its definition reads back as the mark.
  - "Reads back the same" ignores what markdown cannot hold, such as empty paragraphs and whitespace at the edges of emphasis, and links GFM makes of bare URLs, which no escape prevents, also where such a link joins a link to the same URL next to it; where a bare URL would take in what follows it, the writer ends it with an explicit link. Raw markdown has to read back as the same text; where raw markdown was edited into other syntax, the block means what it reads as once everything but the raw markdown is escaped. Keep that comparison and the writer in step. The property tests also judge read-back with a comparison of their own that shares no code with the writer's, so a mistake in one is not repeated in the other.
  - A document keeps the definitions it was made with: the Y.Doc records their names and versions, and the document is read and written with that set, so syntax added later does not change what existing text means. The record is read each time the document is written, through a callback the app gives the extension, so no caller can write without it. A definition keeps its earlier versions for documents made with them; when a recorded version is no longer there, the document is written without rewriting text that was not edited, and only blocks written anew are checked. Content the Y.Doc holds without the record is thrown away and read from the file anew. Bump a definition's version, and keep the old one, when it reads or writes something differently.
  - A definition can build on one registered before it: a parse handler can take the result of the earlier handlers for the same mdast node and adjust it, and a writer can decorate the earlier writer of a node or mark. Use that to add something to existing syntax, such as attributes after an element, instead of copying its handler.
  - VFM's syntax is a bundle of definitions on by default. Each piece of syntax is a micromark construct with an mdast extension, never a pass over parsed text, so escapes and code spans interact with it as markdown reads them. VFM's current release does not read the way micromark does: emphasis and links opened before a construct take precedence over it, ending where their delimiters next come whatever is between, and it reads no math in link text. The constructs follow that by looking at what is open before them, with VFM's rules for where it ends, and by resolving afterwards, not by trusting micromark's order. Check VFM's behaviour by running it, and keep where VFM versions differ as options of the bundle. Constructs that start at the same character are tried in reverse order of the extensions that add them.
  - A document whose recorded definitions lack a piece of syntax does not get it: input rules, paste rules and commands of a definition check the document's set, and menus show such commands disabled. What comes in anyway, as by pasting HTML, becomes what the set can write wherever this client changed the document: an inline node no definition of the set writes becomes its content or its text, and such a mark, or an attribute of a definition the set lacks, is taken off. A node or mark that is still there, as from another client, makes the save fail rather than disappear. The extension can read a document again with newer definitions, but nothing in the app offers that yet, so a document keeps the definitions it was made with.
  - Some states of VFM nodes have no markdown, e.g. a ruby without a base, or math in code or in a link. Commands and HTML parsing refuse them, and a plugin of each node takes off what markdown cannot put on it where a transaction of this client changed the document. What the parser makes is never such a state, so loading a file changes nothing. Where VFM would read a construct right after an element as its attributes, as ruby after a link, it is written after `{}`, which VFM and the editor read as none.
  - The editor's elements are the ones VFM renders, so a theme styles the editor (in its Shadow DOM) as it styles the book. A test of the package compares the HTML the schema's DOM output makes of markdown with what the installed VFM renders, and lists every difference with both sides and the reason. When a node's DOM changes or VFM is upgraded, update that list on purpose; do not loosen the comparison.
  - Text typed at the caret takes a mark only where the text on both sides of the caret has it, so none at the edges of a mark, the start and end of a line included: what it gets depends on where the caret is, never on how the caret got there. Every mark of the schema is made non-inclusive, and the marks the view keeps for the next text after the browser deletes text itself are dropped. The command of a mark still turns it on or off at the caret, and text typed right after text typed so goes on the same way; anything else, such as a deletion, leaves the marks to where the caret is.
  - A link whose text is its own URL, as a bare URL is, follows its text: editing the text edits the URL to the one markdown would link the text to, and once the text is no URL the link comes off.
  - The caret does not rest at the edges inside an inline node with content, which look the same as right outside it: put there by a click, an arrow or a deletion, it goes out of the node, so text typed there goes outside, as at the edge of a mark. Only an empty node holds the caret, and typing into it goes on in it. In the DOM, inside and right after such a node are one place, where the browser types into the node, so the view puts a widget that cannot be edited on each side of it to keep them apart. One press of an arrow steps into or out of such a node past the character beyond the edge. Commands that edit such a node, as its ruby text, also take one right next to the caret, since a node of one character never holds it; one that toggles such a node takes the caret there as outside, as for a mark. Backspace or Delete from outside such a node takes off the character of its content nearest the caret, as for text, and the whole node only with the last of its content; a node without content to edit, such as math, goes whole.
  - Math is typeset only in the view, by an engine the app gives the editor and loads once a document shows math; each source is typeset once and its result reused. The schema's DOM, and so what is copied and what that test compares, keeps the source as VFM writes it for MathJax, and it is what shows without an engine, as in Node, and while LaTeX has an error.

- **`packages/ui/`** (`@v/ui`) — Radix UI primitives wrapped in a shadcn-style component layer. Tailwind v4.

- **`packages/config/`** (`@v/config`) — shared `tsconfig` bases and `get-project-root.js` (used to locate `secrets/`).

- **`packages/preview-sandbox-proxy/`** (`@v/preview-sandbox-proxy`) — a standalone Cloudflare Worker, not part of the app bundle. It serves PR-preview sandbox subdomains on `vspub.dev` by proxying them to the PR's workers.dev preview (see *Deployment*).

### The cli-bundle build, in more detail

`rolldown.config.ts` is dense and load-bearing — the comments in it explain *why* each plugin / alias exists. Quick map for navigation:

- `aliasMap` — base alias set from `unenv`, overridden per builtin where unenv falls short (e.g. `crypto.createHash` is `notImplemented` in unenv; `memfs` replaces unenv's in-memory `fs`; `worker_threads` needs a real `globalThis.Worker`).
- `redirectRolldownToBrowserPlugin` — Vite 8 imports `rolldown` internally; this redirects to `@rolldown/browser/dist/*.browser.mjs`.
- `patchRolldownBindingPlugin` — rewrites the two `new URL(..., import.meta.url)` calls inside `rolldown-binding.wasi-browser.js` to absolute `/_cli/...` URLs **before** `resolveImportMetaPlugin` rewrites them.
- `resolveImportMetaPlugin` — replaces `import.meta.url|env|require` AST nodes with virtual `file:///workdir/node_modules/<pkg>/...` URLs so packages that read `import.meta.url` (e.g. for self-locating) get a stable, parse-safe value.
- `patchEmnapiEnvDetectionPlugin` — forces `ENVIRONMENT_IS_NODE = false` in `@emnapi/*` so the WASM binding doesn't take Node-only code paths.

Tests (`src/index.test.ts`) validate the build artifact, not behavior: they parse `dist/index.js` with `rolldown/parseAst` and check that all expected exports exist (`setupServer`, `teardownServer`, `serve`, `setupTemplate`, `buildEpub`, `buildWebPub`, `exportProjectZip`, `fromJSON`, `toJSON`, `read`, `write`, `rm`, `fromBinarySnapshot`, `toBinarySnapshot`, `printTree`) and that the volume holds what the CLI reads of the stock viewer. Booting the bundle in jsdom/happy-dom doesn't work (see comment in the file).

## Conventions

- **Comments explain *why*, not *what*.** Don't write comments that paraphrase the code below them — well-named identifiers already convey the *what*. Reserve comments for behaviour that is counter-intuitive from the code alone: a hidden invariant, a workaround for a specific upstream bug, a non-obvious ordering constraint, a deliberate departure from a sibling code path. A *why* comment is only warranted when the reasoning isn't already evident from the code — when the *why* is obvious from the construct itself (e.g. a `Suspense` boundary placed around a lazy component), drop the comment too. If removing a comment would not leave a future reader confused, don't write it. Avoid restating the surrounding diff or task ("added for X flow", "used by Y caller") — that context belongs in the commit message / PR description and rots quickly. Look at `packages/cli-bundle/rolldown.config.ts` for the intended density.
- **Biome** (`biome.json`) is the only formatter/linter. Single quotes, semicolons, 2-space indent. Import order is enforced: URLs → protocol packages → third-party packages → blank line → `@v/*` and relative imports.
- **pnpm catalog**: dependency versions are pinned in `pnpm-workspace.yaml`'s `catalog:` section, and packages reference them with `"catalog:"`. When upgrading a dep, edit the catalog (not the individual `package.json`).
- **Patches**: `patches/buffer@6.0.3.patch` is applied via `patchedDependencies` in `pnpm-workspace.yaml` (moved there from `package.json#pnpm.patchedDependencies` in pnpm 11). The `allowBuilds` key in the same file controls which packages may run install scripts.
- **Husky pre-commit** runs `lint-staged` (Biome format) and `pnpm check`.
- **Agent guidance lives only in this file.** No `.cursor/rules`, `.cursorrules`, or `.github/copilot-instructions.md` exist — `AGENTS.md` is a symlink to `CLAUDE.md` so every agent reads the same source. If you need to extend the guide, edit `CLAUDE.md`.
- **Write agent guidance that survives code changes.** In this file and in `.claude/rules/`, state a rule by the role and structure it governs, not by the code that follows it today. Don't cite specific variables, functions, classes or files as examples. After a rename or a refactor, such an example points at code that no longer exists, and nothing flags it. Directory names are fine when the rule is about that layout, and so are third-party library APIs. When a rule needs an example, describe the situation in words (e.g. "several fields that change together") instead of naming the symbol.

## Editor behaviour tests

`@v/tiptap-extensions` pins the editor's behaviour down as data, in `tests/cases/`. The framework that runs them is in `testing/`, outside `src/`.

- A case gives the markdown the document is loaded from, the steps applied to it (typed text, key presses, editor commands) and the markdown it is saved as. A caret mark in the markdown stands for the selection, so a case reads like what the user sees. Add a case there instead of a one-off test that builds an editor by hand.
- The cases run in `pnpm test` against a headless editor in Node. Its driver calls the hooks a view would call, so it covers keymaps and input rules. A case whose steps it cannot perform, such as paste, IME composition or caret movement the browser would do, is skipped. Paste rules can still be covered by a step that dispatches the text as a pasted transaction.
- Write a behaviour the editor lacks as the case it should be, with the reason it fails. Such a case is required to differ from what it expects, so once a change makes it pass, remove the reason. A mistake in the case itself fails it all the same. Never bend the expected markdown to match what the editor does now.
- The framework loads and saves markdown through a single module, so swapping the markdown conversion layer means changing that module, not the cases. A case's `given` is also the baseline it is saved against.
- Every case's markdown, and the template manuscripts in `@v/viola`, are also checked for the guarantees of saving: an unedited document saves byte for byte, editing or deleting one block changes only that block's lines, appending plain text to a block only adds to the file, and what is saved reads back as the same document. Random edits of such markdown are checked the same way. These property tests are slow and live in `tests/properties/`, a Vitest project of their own beside the unit tests, and `pnpm test` runs both.

## Internationalization (i18n)

The host React UI (`@v/viola`) is localized with **[inlang Paraglide JS](https://inlang.com/m/gerre34r/library-inlang-paraglideJs)** (compiler-based, tree-shakeable). The CLI worker / iframe (`@v/cli-bundle`, the Vivliostyle CLI itself) is out of scope.

All i18n data, config, and scripts live inside the **`@v/viola` package** (`packages/viola/`), not the repo root — viola is the only consumer.

- **Source of truth**: `packages/viola/messages/{locale}.json` (inlang message format). Base locale is `en`; the only target locale is `ja`. Config lives in `packages/viola/project.inlang/settings.json`.
- **Generated code**: `paraglideVitePlugin` (in `packages/viola/vite.config.ts`) compiles messages into `packages/viola/src/generated/paraglide/` (the whole `src/generated/` tree is git-ignored and ignored by Biome; paraglide also self-emits its own `.gitignore`). `tsc` reads the emitted `.d.ts` files (the project does not set `allowJs`), so the compile must run before typecheck — the viola `build`/`typecheck` scripts chain `pnpm paraglide` first.
- **Plugins**: the inlang message-format + m-function-matcher plugins are loaded from pinned jsdelivr URLs in `settings.json`. `cdn.jsdelivr.net` must be in the agent sandbox's network allowlist for the compile to run (it fetches the plugin modules). To bump a plugin, edit the version in the URL.

### Message key naming (flat snake_case)

- Flat, underscore-separated keys with a feature-area prefix: **`{area}_{element}[_{descriptor}]`** — e.g. `side_menu_open_project`, `bibliography_book_title_label`. No nesting. Call as `m.side_menu_open_project()`.
- area prefixes mirror the source location: `side_menu_`, `bibliography_`, `theme_`, `media_`, `start_`/`new_project_`, `preview_`/`edit_`, `image_toolbar_`, `selection_toolbar_`, `trigger_menu_`, and one per editor panel (`link_panel_`, `code_block_panel_`, `ruby_panel_`, `math_panel_`, `footnote_panel_`, `attributes_panel_`). Editor menu commands (`libs/editor/menu/commands/`) use `editor_command_<name>`, plus `editor_command_<name>_keywords` (space-separated search terms, including kana readings in `ja`) for commands shown in trigger menus. Use `common_` only for genuinely shared words (`common_cancel`, `common_untitled`).
- **Don't reuse** keys across contexts (unique key per instance) except the governed `common_` namespace — identical English can translate differently by context.
- Accessibility strings take a `_aria` suffix (`side_menu_open_workspace_aria`). Interpolation uses ICU `{name}` placeholders; pluralization/gender uses ICU `plural`/`select`.
- Name keys semantically by hand — do **not** derive them from the English text (so editing copy never churns keys).

### Wording / translation style

Per-locale wording rules (punctuation, spacing, casing, untranslatable terms) live in `.claude/rules/i18n-message-style.md`, scoped via `paths:` so it loads automatically when message JSON files are touched. When writing or machine-translating a message, follow that file's section for the target locale; add new conventions there rather than burying them in PR comments.

### Adding / editing messages

Three equivalent paths, all land as normal PRs that maintainers review:
1. **Source (humans & AI agents)**: add the key to `packages/viola/messages/en.json`, use `m.<key>()` in code, then run `pnpm --filter @v/viola i18n:translate` to fill the other locales. `pnpm --filter @v/viola paraglide` regenerates types.
2. **Web UI (non-developers)**: [Fink](https://fink.inlang.com) — connect the GitHub repo, edit in the browser, opens a PR.
3. **VS Code**: the [Sherlock](https://inlang.com/m/r7kp499g/app-inlang-ideExtension) extension for inline extraction/editing.

- **Machine translation**: `pnpm --filter @v/viola i18n:translate` (inlang CLI, Google Cloud Translation v2). It only fills empty/missing messages, so human edits are preserved. Needs `INLANG_GOOGLE_TRANSLATE_API_KEY`. CI runs it via `.github/workflows/i18n-translate.yml` whenever `packages/viola/messages/en.json` changes and commits the result back.
- **Validation**: `pnpm --filter @v/viola i18n:validate` (runs in the `i18n` CI job).

## Deployment

Cloudflare Workers via Wrangler. `wrangler.toml` serves `packages/viola/dist/` as a SPA. The GitHub Actions workflow `build-deploy.yml` deploys `main` to `alpha.vivliostyle.pub` and PR previews to `pr-preview-<n>-vivliostyle-pub-app.vivliostyle.workers.dev`.

A PR preview is a Worker version with a preview alias. Version URLs exist only on workers.dev, and a zone route always reaches the active deployment, so no route can send the `vspub.dev` sandbox subdomains to a PR build directly. Instead, a PR build's sandbox subdomains end in `-pr-preview-vspub`, and `packages/preview-sandbox-proxy` (deployed from `main`) proxies that route to the matching preview alias. The PR identifier must keep the sandbox label within the 63-character DNS limit.
