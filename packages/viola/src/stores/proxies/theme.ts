import { proxy, ref } from 'valtio';

import type { Project } from './project';

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

  packageName = '@vivliostyle/theme-base';
  installingPackageName: string | undefined;
  installingError: Error | undefined;
  bundledCss: string | undefined;
  customCss = '';

  protected project: Project;

  protected constructor(project: Project) {
    this.project = ref(project);
  }
}
