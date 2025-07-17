import { invariant } from 'outvariant';
import { dirname, join } from 'pathe';
import { ref } from 'valtio';

import { setupEditor } from '../../libs/editor';
import { generateId, generateRandomName } from '../../libs/generate-id';
import { $content, type ContentId } from '../content';
import { $sandbox } from '../sandbox';
import { $ui } from '../ui';

export async function createContentFile({
  format,
  insertAfter,
}: {
  format: 'markdown';
  insertAfter?: ContentId;
}): Promise<ContentId> {
  const prevFile = insertAfter && $content.files.get(insertAfter);
  const prevFileDir = prevFile && dirname(prevFile.filename);
  const contentId = generateId<ContentId>();
  const extname = '.md';
  const basename = `${generateRandomName()}${extname}`;
  const filename = join(prevFileDir || '', basename);
  const index =
    ((insertAfter && $content.readingOrder.indexOf(insertAfter)) ?? -1) + 1;

  // update sandbox
  $sandbox.files[
    join($sandbox.vivliostyleConfig.entryContext || '', filename)
  ] = ref(new Blob([], { type: 'text/markdown' }));
  $sandbox.updateVivliostyleConfig((config) => {
    config.entry = [$sandbox.vivliostyleConfig.entry]
      .flat()
      .toSpliced(index, 0, filename);
  });

  // update content
  $content.files.set(contentId, {
    format,
    filename,
    summary: '',
    editor: ref(await setupEditor({ contentId })),
  });
  $content.readingOrder.splice(index, 0, contentId);
  return contentId;
}

export async function deleteContentFile({
  contentId,
}: {
  contentId: ContentId;
}): Promise<ContentId> {
  const file = $content.files.get(contentId);
  invariant(file, `File does not exist: ${contentId}`);
  const index = $content.readingOrder.indexOf(contentId);

  // update ui
  if (
    $ui.tabs.some((tab) => tab.type === 'edit' && tab.contentId === contentId)
  ) {
    $ui.tabs = [];
  }

  // update content
  $content.readingOrder.splice(index, 1);
  $content.files.delete(contentId);

  // update sandbox
  $sandbox.updateVivliostyleConfig((config) => {
    config.entry = [config.entry].flat().toSpliced(index, 1);
  });
  delete $sandbox.files[
    join($sandbox.vivliostyleConfig.entryContext || '', file.filename)
  ];
  return contentId;
}
