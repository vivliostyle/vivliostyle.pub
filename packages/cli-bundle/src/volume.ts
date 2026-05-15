import { vol } from 'memfs';

// Restores the bundle's prepopulated `/workdir/node_modules/*` files (vite,
// @vivliostyle/cli, @vivliostyle/viewer). `setupTemplate` wipes `/workdir`
// before calling `vivliostyleCreate`, so it must call this afterwards to put
// the viewer's `lib/` back — otherwise the next `setupServer()` initializes
// `vsViewerPlugin`, which `readdirSync`s `viewer/lib` and crashes with ENOENT
// until the worker restarts.
export const restoreBundledNodeModules = () => {
  vol.fromJSON(__volume__);
};

restoreBundledNodeModules();

vol.fromNestedJSON({
  tmp: {},
  out: {},
  workdir: {
    'package.json': JSON.stringify({
      name: 'project',
    }),
  },
});
