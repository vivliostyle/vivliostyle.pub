import { join } from 'pathe';
import { ref } from 'valtio';

import { setupEditor } from '../../libs/editor';
import { generateId } from '../../libs/generate-id';
import { $content, $sandbox, $theme } from '../accessors';
import type { ContentId } from '../proxies/content';

export async function setupProject() {
  const $$content = $content.valueOrThrow;
  const $$sandbox = $sandbox.valueOrThrow;
  const $$theme = $theme.valueOrThrow;
  const entryContext = $$sandbox.vivliostyleConfig.entryContext || '';
  const entryFiles = [$$sandbox.vivliostyleConfig.entry]
    .flat()
    .flatMap((it) => {
      const entry = typeof it === 'string' ? { path: it } : it;
      if (!entry.path) {
        return [];
      }
      const filename = join(entryContext, entry.path);
      const format = entry.path.endsWith('.md')
        ? ('markdown' as const)
        : undefined;
      const content = $$sandbox.files[filename];
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
    $$content.files.set(contentId, {
      format,
      filename,
      summary,
      editor: ref(editor),
    });
  }
  $$content.readingOrder = readingOrder;
  $$theme.customCss = await $$sandbox.files['style.css'].text();
}
