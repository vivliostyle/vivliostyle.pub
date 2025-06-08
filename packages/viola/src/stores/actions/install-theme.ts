import {
  buildTreeFromRegistry,
  bundleCss,
  fetchPackageContent,
} from '#theme-registry';
import { $sandbox } from '../sandbox';
import { $theme } from '../theme';

export async function installTheme(specifier: string) {
  const packageName = specifier.split(/(?!^)@/)[0];
  $theme.installingError = null;
  const timer = setTimeout(() => {
    $theme.installingPackageName = packageName;
  }, 100);
  try {
    const tree = await buildTreeFromRegistry(specifier);
    await fetchPackageContent(tree);

    const { code } = await bundleCss(`@import "${packageName}"`);
    $theme.bundledCss = new TextDecoder().decode(code);

    $theme.packageName = packageName;
    $sandbox.updateVivliostyleConfig((config) => {
      config.theme = [specifier, './style.css'];
    });
  } catch (error) {
    $theme.installingError = error as Error;
  } finally {
    clearTimeout(timer);
    $theme.installingPackageName = null;
  }
}
