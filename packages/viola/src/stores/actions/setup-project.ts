import { join } from 'pathe';
import { ref } from 'valtio';

import { setupEditor } from '../../libs/editor';
import { generateId } from '../../libs/generate-id';
import { $content, type ContentId } from '../content';
import { $sandbox, loadProjectFromCache } from '../sandbox';
import { $theme } from '../theme';

const defaultCss = /* css */ `:root {
  /* Edit this CSS to customize the theme */
}`;

export async function setupProject(projectId: string) {
  const root = await navigator.storage.getDirectory();
  $sandbox.projectDirectoryHandle = ref(
    await root.getDirectoryHandle(projectId, { create: true }),
  );
  try {
    await loadProjectFromCache();
  } catch (error) {
    console.warn(error);
    // Not exist or invalid project file
    await root.removeEntry(projectId, { recursive: true });
    $sandbox.projectDirectoryHandle = ref(
      await root.getDirectoryHandle(projectId, { create: true }),
    );
    $sandbox.updateVivliostyleConfig((config) => {
      config.entry = [];
      config.theme = ['@vivliostyle/theme-base', './style.css'];
    });
    $sandbox.files['style.css'] = ref(
      new Blob([defaultCss], { type: 'text/css' }),
    );
  }
  const url = new URL(location.href);
  url.hostname = `sandbox-${projectId}.${url.hostname}`;
  $sandbox.sandboxOrigin = url.origin;

  const entryContext = $sandbox.vivliostyleConfig.entryContext || '';
  const entryFiles = [$sandbox.vivliostyleConfig.entry].flat().flatMap((it) => {
    const entry = typeof it === 'string' ? { path: it } : it;
    if (!entry.path) {
      return [];
    }
    const filename = join(entryContext, entry.path);
    const format = entry.path.endsWith('.md')
      ? ('markdown' as const)
      : undefined;
    const content = $sandbox.files[filename];
    if (!content) {
      return [];
    }
    return { filename, format, content };
  });

  const readingOrder: ContentId[] = [];
  for (const { filename, format, content } of entryFiles) {
    if (!format) {
      // TODO: handle other formats
      continue;
    }
    const contentId = generateId<ContentId>();
    const editor = await setupEditor({ contentId, initialFile: content });
    const summary =
      editor
        .getText({ blockSeparator: '\n' })
        .split('\n')
        .find((s) => s.trim())
        ?.trim() || '';

    readingOrder.push(contentId);
    $content.files.set(contentId, {
      format,
      filename,
      summary,
      editor: ref(editor),
    });
  }
  $content.readingOrder = readingOrder;
  $theme.customCss = await $sandbox.files['style.css'].text();
}
