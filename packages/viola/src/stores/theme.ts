import { proxy } from 'valtio';

export const theme = proxy({
  packageName: '@vivliostyle/theme-base',
  installingPackageName: null as string | null,
  installingError: null as Error | null,
  bundledCss: null as string | null,
});
