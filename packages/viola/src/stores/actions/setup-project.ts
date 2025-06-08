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
      config.entryContext = 'contents';
      config.entry = [];
      config.title = 'title';
      config.theme = ['@vivliostyle/theme-base', './style.css'];
    });
    $sandbox.files['style.css'] = ref(
      new Blob([defaultCss], { type: 'text/css' }),
    );
  }
  const contentIdMap: Record<string, ContentId> = {};
  for (const [rootFilename, docFile] of Object.entries($sandbox.files)) {
    const matched = rootFilename.match(/^contents\/(?<name>.+)$/);
    if (!matched?.groups) {
      continue;
    }
    const { name } = matched.groups;
    const contentId = generateId<ContentId>();
    contentIdMap[name] = contentId;
    $content.files.set(contentId, {
      format: 'html',
      filename: name,
      editor: ref(await setupEditor({ contentId })),
    });
  }
  $content.readingOrder = [$sandbox.vivliostyleConfig.entry]
    .flat()
    .flatMap((e) => {
      const p = e && typeof e === 'object' ? e.path : e;
      return p ? [contentIdMap[p]] : [];
    });
  $theme.customCss = await $sandbox.files['style.css'].text();
}
