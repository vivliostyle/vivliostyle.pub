import {
  buildTreeFromRegistry,
  bundleCss,
  fetchPackageContent,
} from '@v/theme-registry';
import { $sandbox, $theme } from '../accessors';

export async function installTheme(specifier: string) {
  const $$sandbox = $sandbox.valueOrThrow;
  const $$theme = $theme.valueOrThrow;
  const packageName = specifier.split(/(?!^)@/)[0];
  $$theme.installingError = undefined;
  const timer = setTimeout(() => {
    $$theme.installingPackageName = packageName;
  }, 100);
  try {
    const tree = await buildTreeFromRegistry(specifier);
    await fetchPackageContent(tree);

    const { code } = await bundleCss(`@import "${packageName}"`);
    $$theme.bundledCss = new TextDecoder().decode(code);

    $$theme.packageName = packageName;
    $$sandbox.updateVivliostyleConfig((config) => {
      config.theme = [specifier, './style.css'];
    });
  } catch (error) {
    $$theme.installingError = error as Error;
  } finally {
    clearTimeout(timer);
    $$theme.installingPackageName = undefined;
  }
}
