import { proxy, ref } from 'valtio';

import {
  buildTreeFromRegistry,
  bundleCss,
  fetchPackageContent,
} from '@v/theme-registry';
import type { Project } from './project';

export interface ThemeInstallationResult {
  packageName: string;
  bundledCss: string;
}

export class Theme {
  static officialThemes = {
    '@vivliostyle/theme-base': { title: 'Base Theme' },
    '@vivliostyle/theme-techbook': { title: 'Techbook' },
    '@vivliostyle/theme-academic': { title: 'Academic' },
    '@vivliostyle/theme-bunko': { title: 'Bunko' },
    '@vivliostyle/theme-gutenberg': { title: 'Gutenberg' },
    '@vivliostyle/theme-slide': { title: 'Slide' },
  } as const;

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
