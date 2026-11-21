import { invariant } from 'outvariant';
import { proxy, ref } from 'valtio';

import { type Coalesced, coalesce } from '../../libs/coalesce';
import { SandboxFile } from '../../libs/sandbox/file';
import {
  bundleUserStylesheets,
  createStylesheetBundleCache,
  needsStylesheetBundle,
  resetInlinedImports,
  type StylesheetBundleError,
} from '../../libs/user-stylesheet-bundle';
import { resolveUserStylesheetPaths } from '../../libs/user-stylesheets';
import type { Project } from './project';
import type { Sandbox } from './sandbox';

// Spares the editor from flashing half-typed values
const STYLESHEET_INPUT_DEBOUNCE_MS = 300;
// Every write reloads the whole preview, so a burst of edits is written as one
const STYLESHEET_WRITE_WAIT_MS = 200;
const STYLESHEET_WRITE_MAX_WAIT_MS = 1000;

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
    sandbox: undefined as Sandbox | undefined,
    cache: createStylesheetBundleCache(),
  });
  protected stylesheetEditState = ref({
    input: new Map<string, string>(),
    inputTimer: undefined as ReturnType<typeof setTimeout> | undefined,
    written: new Map<string, { css: string; file: SandboxFile | undefined }>(),
    requestWrite: undefined as Coalesced | undefined,
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
    const { written } = this.stylesheetEditState;
    for (const { path, css } of this.stylesheets) {
      written.set(path, { css, file: sandbox.files[path] });
    }
    this.stylesheetBundleState.sandbox = sandbox;
    this.refreshStylesheetBundle();
  }

  refreshStylesheetBundle() {
    const state = this.stylesheetBundleState;
    const seq = ++state.seq;
    const files = state.sandbox?.files ?? {};
    const isProjectFile = (path: string) => path in files;
    const sheets = this.stylesheets.map(({ path, css }) => ({ path, css }));
    if (!needsStylesheetBundle(sheets, isProjectFile)) {
      this.applyStylesheetBundle(undefined, undefined);
      return;
    }
    (async () => {
      try {
        // The theme package itself may be imported by a stylesheet and is still being fetched
        await this.installPromise;
        const result = await bundleUserStylesheets(sheets, {
          isProjectFile,
          readProjectFile: (path) => files[path]?.text(),
          cache: state.cache,
          isStale: () => seq !== state.seq,
        });
        if (result && seq === state.seq) {
          this.applyStylesheetBundle(result.css, result.error);
        }
      } catch (error) {
        if (seq === state.seq) {
          this.applyStylesheetBundle(this.bundledStylesheetCss, {
            kind: 'syntax',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();
  }

  // Unchanged values are not assigned, since every assignment notifies all theme subscribers
  protected applyStylesheetBundle(
    css: string | undefined,
    error: StylesheetBundleError | undefined,
  ) {
    if (this.bundledStylesheetCss !== css) {
      this.bundledStylesheetCss = css;
    }
    const current = this.stylesheetBundleError;
    if (
      current?.kind !== error?.kind ||
      current?.target !== error?.target ||
      current?.message !== error?.message
    ) {
      this.stylesheetBundleError = error;
    }
  }

  /**
   * Applies the edit to the editor styles at once, or after a pause in typing
   * with `debounce`, and writes it to the project file soon after.
   */
  updateStylesheet(
    path: string,
    css: string,
    { debounce = false }: { debounce?: boolean } = {},
  ) {
    invariant(
      this.stylesheets.some((it) => it.path === path),
      `Unknown stylesheet: ${path}`,
    );
    invariant(this.project.sandbox, 'Sandbox is not ready');
    const state = this.stylesheetEditState;
    state.input.set(path, css);
    if (debounce) {
      clearTimeout(state.inputTimer);
      state.inputTimer = setTimeout(
        () => this.applyStylesheetInput(),
        STYLESHEET_INPUT_DEBOUNCE_MS,
      );
    } else {
      this.applyStylesheetInput();
    }
  }

  /** Applies and writes out every edit that is still waiting. */
  flushStylesheetEdits() {
    this.applyStylesheetInput();
    this.stylesheetEditState.requestWrite?.flush();
  }

  protected applyStylesheetInput() {
    const state = this.stylesheetEditState;
    clearTimeout(state.inputTimer);
    let changed = false;
    for (const [path, css] of state.input) {
      const stylesheet = this.stylesheets.find((it) => it.path === path);
      if (stylesheet && stylesheet.css !== css) {
        stylesheet.css = css;
        changed = true;
      }
    }
    state.input.clear();
    if (!changed) {
      return;
    }
    this.refreshStylesheetBundle();
    state.requestWrite ??= coalesce(() => this.writeStylesheets(), {
      wait: STYLESHEET_WRITE_WAIT_MS,
      maxWait: STYLESHEET_WRITE_MAX_WAIT_MS,
    });
    state.requestWrite();
  }

  protected writeStylesheets() {
    const { sandbox } = this.project;
    if (!sandbox) {
      return;
    }
    const { written } = this.stylesheetEditState;
    for (const { path, css } of this.stylesheets) {
      const last = written.get(path);
      if (last?.css === css && last.file === sandbox.files[path]) {
        continue;
      }
      const file = new SandboxFile('text/css', css);
      sandbox.files[path] = ref(file);
      written.set(path, { css, file });
    }
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
    this.installPromise.then(() => {
      resetInlinedImports(this.stylesheetBundleState.cache);
      this.refreshStylesheetBundle();
    });
  }
}
