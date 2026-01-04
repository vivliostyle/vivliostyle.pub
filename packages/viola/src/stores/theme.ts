import { proxy, ref } from 'valtio';

import type { Project } from './project';

export class Theme {
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
