import { proxy, ref } from 'valtio';

import type { Project } from './project';

export interface ThemeInstallationResult {
  packageName: string;
  bundledCss: string;
}

export class Theme {
  static create(project: Project) {
    return proxy(new Theme(project));
  }

  installPromise: Promise<ThemeInstallationResult | undefined> | undefined;
  installFailure: Error | undefined;
  installingPackageName: string | undefined;
  customCss = '';

  protected project: Project;

  protected constructor(project: Project) {
    this.project = ref(project);
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
