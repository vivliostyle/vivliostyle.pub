# @v/viewer

The stage document that renders a publication's pages in Vivliostyle Pub. It is a static page built on `@vivliostyle/core` alone, without the stock `@vivliostyle/viewer`. `@v/viola` serves the build at `/_viewer/` on both the host and the sandbox origin. The page references its assets relatively, so stage URLs must keep that trailing slash.

The stage takes its input from search parameters:

```
/_viewer/?src=<publication>&viewMode=scroll&colorScheme=dark
/_viewer/?src=<publication>&print=true&locale=ja
```

`src` must be on the stage's own origin, since the publication's scripts run in the stage window. The other parameters are initial values. Documents without an `@page` size are laid out on A4.

In the preview, the stage lays the publication out once per load, then presents the pages in its own view modes, scale and paging without making core lay out again. It reloads in place on every `full-reload` that the in-worker Vite posts to the `worker:vite-hmr` BroadcastChannel. The embedder drives it through Comlink: once the frame has loaded, it posts `{ command: 'viewer-stage-bind' }` to the frame window with a `MessagePort`, on which the stage exposes a `StageController`. That contract is the package's only export, `@v/viewer/protocol`.

With `print=true` the stage is a top-level tab instead: it lays the publication out, opens the print dialog once every page is laid out, then closes itself. All of the stage's own CSS sits under `@media screen`, so in print only core's rules apply to the pages.

## Source layout

- `src/main.ts` reads the search parameters and starts either the preview or the print tab.
- `src/protocol.ts` is the contract with the embedder, exported as `@v/viewer/protocol`. Both sides import it, so it must not pull in the stage's runtime.
- `src/core/` drives `@vivliostyle/core`: the options the stage creates it with, the order of the commands sent to it, and what the stage reads from or resets in its internals.
- `src/preview/` is the preview. Its stage ties core to the reload policy and the presentation, and its entry binds the stage to the embedder and the HMR channel. `src/preview/presentation/` shows core's pages in the stage's own view modes, scale and paging, and turns keys, wheel gestures and link clicks into page moves.
- `src/print/` is the print tab.

Logic that can be tested without a browser sits in modules of its own, next to its tests.

`pnpm --filter @v/viewer dev` rebuilds `dist/` on every change, and the viola dev server serves the result.
