import { invariant } from 'outvariant';
import { proxy, ref } from 'valtio';

import { SandboxFile } from '../../libs/sandbox/file';
import {
  bundleUserStylesheets,
  createStylesheetBundleCache,
  type StylesheetBundleError,
} from '../../libs/user-stylesheet-bundle';
import { resolveUserStylesheetPaths } from '../../libs/user-stylesheets';
import type { Project } from './project';
import type { Sandbox } from './sandbox';

export interface ThemeInstallationResult {
  packageName: string;
  bundledCss: string;
}

export interface UserStylesheet {
  path: string;
  css: string;
}

export class Theme {
  static create(project: Project) {
    return proxy(new Theme(project));
  }

  installPromise: Promise<ThemeInstallationResult | undefined> | undefined;
  installFailure: Error | undefined;
  installingPackageName: string | undefined;
  /** Project-local stylesheets applied after the theme package, in cascade order. */
  stylesheets: UserStylesheet[] = [];

  /** `stylesheets` with `@import`s inlined; `undefined` until computed or when there is nothing to inline. */
  bundledStylesheetCss: string | undefined;
  stylesheetBundleError: StylesheetBundleError | undefined;

  protected project: Project;
  // Behind `ref` so bookkeeping never notifies subscribers
  protected stylesheetBundleState = ref({
    seq: 0,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
    sandbox: undefined as Sandbox | undefined,
    cache: createStylesheetBundleCache(),
  });

  protected constructor(project: Project) {
    this.project = ref(project);
  }

  async loadStylesheets(sandbox: Sandbox) {
    const paths = resolveUserStylesheetPaths(
      sandbox.vivliostyleConfig.theme,
      (path) => path in sandbox.files,
    );
    this.stylesheets = await Promise.all(
      paths.map(async (path) => {
        const file = sandbox.files[path];
        if (file) {
          return { path, css: await file.text() };
        }
        sandbox.files[path] = ref(new SandboxFile('text/css', ''));
        return { path, css: '' };
      }),
    );
    this.stylesheetBundleState.sandbox = sandbox;
    this.refreshStylesheetBundle(0);
  }

  refreshStylesheetBundle(delay = 300) {
    const state = this.stylesheetBundleState;
    const seq = ++state.seq;
    clearTimeout(state.timer);
    state.timer = setTimeout(async () => {
      try {
        // The theme package itself may be imported by a stylesheet and is still being fetched
        await this.installPromise;
        const files = state.sandbox?.files ?? {};
        const result = await bundleUserStylesheets(
          this.stylesheets.map(({ path, css }) => ({ path, css })),
          {
            isProjectFile: (path) => path in files,
            readProjectFile: (path) => files[path]?.text(),
            cache: state.cache,
            isStale: () => seq !== state.seq,
          },
        );
        if (result && seq === state.seq) {
          this.bundledStylesheetCss = result.css;
          this.stylesheetBundleError = result.error;
        }
      } catch (error) {
        if (seq === state.seq) {
          this.stylesheetBundleError = {
            kind: 'syntax',
            message: error instanceof Error ? error.message : String(error),
          };
        }
      }
    }, delay);
  }

  updateStylesheet(path: string, css: string) {
    const stylesheet = this.stylesheets.find((it) => it.path === path);
    invariant(stylesheet, `Unknown stylesheet: ${path}`);
    const { sandbox } = this.project;
    invariant(sandbox, 'Sandbox is not ready');
    stylesheet.css = css;
    sandbox.files[path] = ref(new SandboxFile('text/css', css));
    this.refreshStylesheetBundle();
  }

  install(specifier: string) {
    const prevInstallPromise = this.installPromise;
    const packageName = specifier.split(/(?!^)@/)[0];
    this.installingPackageName = packageName;
    this.installFailure = undefined;
    this.installPromise = (async () => {
      try {
        const { buildTreeFromRegistry, bundleCss, fetchPackageContent } =
          await import('@v/theme-registry');
        const tree = await buildTreeFromRegistry(specifier);
        await fetchPackageContent(tree);

        const { code } = await bundleCss(`@import "${packageName}"`);
        const bundledCss = new TextDecoder().decode(code);
        return { packageName, bundledCss };
      } catch (error) {
        this.installFailure = error as Error;
        this.installPromise = prevInstallPromise;
      } finally {
        this.installingPackageName = undefined;
      }
    })();
  }
}
