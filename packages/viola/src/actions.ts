import { ref } from 'valtio';
import {
  buildTreeFromRegistry,
  bundleCss,
  fetchPackageContent,
} from '#theme-registry';
import { setupEditor } from './libs/editor';
import { type ContentId, content } from './stores/content';
import { sandbox } from './stores/sandbox';
import { theme } from './stores/theme';

const contentId = 'manuscript' as ContentId;

export const setupProjectPromise = (async () => {
  content.files[contentId] = {
    path: 'manuscript.html',
    json: {},
  };
  content.readingOrder = [contentId];
  const editor = await setupEditor({ contentId });
  content.editor[contentId] = ref(editor);
  sandbox.files['manuscript.html'] = '';
})();

export async function installTheme(specifier: string) {
  const packageName = specifier.split(/(?!^)@/)[0];
  theme.installingError = null;
  const timer = setTimeout(() => {
    theme.installingPackageName = packageName;
  }, 100);
  try {
    const tree = await buildTreeFromRegistry(specifier);
    await fetchPackageContent(tree);

    const { code } = await bundleCss(`@import "${packageName}"`);
    theme.bundledCss = new TextDecoder().decode(code);

    theme.packageName = packageName;
    sandbox.vivliostyleConfig.theme = specifier;
  } catch (error) {
    theme.installingError = error as Error;
  } finally {
    clearTimeout(timer);
    theme.installingPackageName = null;
  }
}
