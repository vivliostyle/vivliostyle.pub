import { proxy, ref } from 'valtio';

import { extractTemplateFiles } from '../../libs/theme-site';
import type { Project } from './project';

export interface ThemeTemplate {
  id: string;
  name?: string;
  description?: string;
  source: string;
}

export interface ThemeInstallationResult {
  packageName: string;
  version: string;
  templates: ThemeTemplate[];
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
  /** A template of the theme chosen together with it, e.g. in the browser. */
  requestedTemplateId: string | undefined;
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
        const root = tree[packageName];
        const templates = Object.entries(root?.vivliostyle?.template ?? {})
          .filter(([, template]) => typeof template.source === 'string')
          .map(([id, template]) => ({
            id,
            name: template.name,
            description: template.description,
            source: template.source as string,
          }));
        return {
          packageName,
          version: root?.version ?? '',
          templates,
          bundledCss,
        };
      } catch (error) {
        this.installFailure = error as Error;
        this.installPromise = prevInstallPromise;
      } finally {
        this.installingPackageName = undefined;
      }
    })();
  }

  /**
   * Files of a template whose `source` is a directory inside the theme
   * package, from the same version as the installed theme. Returns undefined
   * for other sources, which the CLI downloads itself.
   */
  async loadTemplateFiles(
    template: ThemeTemplate,
  ): Promise<Record<string, Uint8Array> | undefined> {
    const installed = await this.installPromise;
    if (!installed) {
      return undefined;
    }
    const { buildTreeFromRegistry, fetchPackageContent } = await import(
      '@v/theme-registry'
    );
    const tree = await buildTreeFromRegistry(
      `${installed.packageName}@${installed.version}`,
    );
    return extractTemplateFiles(
      await fetchPackageContent(tree),
      installed.packageName,
      template.source,
    );
  }
}
