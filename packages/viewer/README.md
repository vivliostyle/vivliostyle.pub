# @v/viewer

The stage document that renders a publication's pages in Vivliostyle Pub. It is a static page built on `@vivliostyle/core` alone, without the stock `@vivliostyle/viewer`. `@v/viola` serves the build at `/_viewer/` on both the host and the sandbox origin. The page references its assets relatively, so stage URLs must keep that trailing slash.

The stage takes its input from search parameters:

```
/_viewer/?src=<publication>&viewMode=scroll&paperSize=a4&colorScheme=dark
/_viewer/?src=<publication>&paperSize=a4&print=true&locale=ja
```

`src` must be on the stage's own origin, since the publication's scripts run in the stage window. The other parameters are initial values, and the paper size applies only to documents without an `@page` size.

In the preview, the stage lays the publication out once per load, then presents the pages in its own view modes, scale and paging without making core lay out again. It reloads in place on every `full-reload` that the in-worker Vite posts to the `worker:vite-hmr` BroadcastChannel. The embedder drives it through Comlink: once the frame has loaded, it posts `{ command: 'viewer-stage-bind' }` to the frame window with a `MessagePort`, on which the stage exposes a `StageController`. That contract is the package's only export, `@v/viewer/protocol`.

With `print=true` the stage is a top-level tab instead: it lays the publication out, opens the print dialog once every page is laid out, then closes itself. All of the stage's own CSS sits under `@media screen`, so in print only core's rules apply to the pages.

`pnpm --filter @v/viewer dev` rebuilds `dist/` on every change, and the viola dev server serves the result.
