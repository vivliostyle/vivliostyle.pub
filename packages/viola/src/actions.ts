import { ref, snapshot } from 'valtio';
import {
  buildTreeFromRegistry,
  bundleCss,
  fetchPackageContent,
} from '#theme-registry';
import { setupEditor } from './libs/editor';
import { type ContentId, content } from './stores/content';
import { sandbox } from './stores/sandbox';
import { theme } from './stores/theme';

const contentId = 'h23HaDuA5MG2bSLW' as ContentId;

export async function setupFirstContent() {
  content.files[contentId] = {
    path: 'manuscript.html',
    json: {},
  };
  content.readingOrder = [contentId];
  const editor = await setupEditor({ contentId });
  content.editor[contentId] = ref(editor);
}

export async function setupCli() {
  const { worker } = snapshot(sandbox);
  if (!worker) {
    return;
  }
  await worker.write(
    '/workdir/vivliostyle.config.json',
    JSON.stringify({
      title: 'title',
      entry: ['./manuscript.html'],
      entryContext: 'contents',
      theme: '@vivliostyle/theme-base',
    }),
  );
  sandbox.files = { 'manuscript.html': '' };
  await worker.setupServer();
}

export async function installTheme(specifier: string) {
  const { worker } = snapshot(sandbox);
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
    await worker?.write(
      '/workdir/vivliostyle.config.json',
      JSON.stringify({
        title: 'title',
        entry: ['./manuscript.html'],
        entryContext: 'contents',
        theme: specifier,
      }),
    );
  } catch (error) {
    theme.installingError = error as Error;
  } finally {
    clearTimeout(timer);
    theme.installingPackageName = null;
  }
}
