import type { EntryConfig } from '@vivliostyle/cli/schema';
import { invariant } from 'outvariant';
import { dirname, join, sep } from 'pathe';
import { ref } from 'valtio';

import { setupEditor } from '../../libs/editor';
import { generateId, generateRandomName } from '../../libs/generate-id';
import { $content, $sandbox, $ui } from '../accessors';
import type { ContentId } from '../content';
import { defaultDraftDir } from '../sandbox';

export async function createContentFile({
  format,
  insertAfter,
}: {
  format: 'markdown';
  insertAfter?: ContentId;
}): Promise<ContentId> {
  const $$content = $content.valueOrThrow;
  const $$sandbox = $sandbox.valueOrThrow;
  const prevFile = insertAfter && $$content.files.get(insertAfter);
  const prevFileDir = prevFile && dirname(prevFile.filename);
  const contentId = generateId<ContentId>();
  const extname = '.md';
  const basename = `${generateRandomName()}${extname}`;
  const entryPath = join(prevFileDir || defaultDraftDir, basename);
  const filename = join(
    $$sandbox.vivliostyleConfig.entryContext || '',
    entryPath,
  );
  const index =
    ((insertAfter && $$content.readingOrder.indexOf(insertAfter)) ?? -1) + 1;

  // update sandbox
  $$sandbox.files[filename] = ref(new Blob([], { type: 'text/markdown' }));
  $$sandbox.updateVivliostyleConfig((config) => {
    config.entry = [$$sandbox.vivliostyleConfig.entry]
      .flat()
      .toSpliced(index, 0, entryPath);
  });

  // update content
  $$content.files.set(contentId, {
    format,
    filename,
    summary: '',
    editor: ref(await setupEditor({ contentId })),
  });
  $$content.readingOrder.splice(index, 0, contentId);
  return contentId;
}

export async function deleteContentFile({
  contentId,
}: {
  contentId: ContentId;
}): Promise<ContentId> {
  const $$content = $content.valueOrThrow;
  const $$sandbox = $sandbox.valueOrThrow;
  const file = $$content.files.get(contentId);
  invariant(file, `File does not exist: ${contentId}`);
  const index = $$content.readingOrder.indexOf(contentId);

  // update ui
  if (
    $ui.tabs.some((tab) => tab.type === 'edit' && tab.contentId === contentId)
  ) {
    $ui.tabs = [];
  }

  // update content
  $$content.readingOrder.splice(index, 1);
  $$content.files.delete(contentId);

  // update sandbox
  $$sandbox.updateVivliostyleConfig((config) => {
    config.entry = [config.entry].flat().toSpliced(index, 1);
  });
  delete $$sandbox.files[
    join($$sandbox.vivliostyleConfig.entryContext || '', file.filename)
  ];
  return contentId;
}

export function moveContentFileInReadingOrder({
  fromContentId,
  toContentId,
  fromDepth,
  toDepth,
}: {
  fromContentId: ContentId[];
  toContentId: ContentId;
  fromDepth: number;
  toDepth: number;
}) {
  const $$content = $content.valueOrThrow;
  const $$sandbox = $sandbox.valueOrThrow;
  const fromItems = fromContentId.map((id) => {
    const item = $$content.files.get(id);
    invariant(item, `File does not exist: ${id}`);
    return item;
  });
  const toItem = $$content.files.get(toContentId);
  invariant(toItem, `File does not exist: ${toContentId}`);
  const fromIndexes = fromContentId.map((id) => {
    const index = $$content.readingOrder.indexOf(id);
    invariant(index !== -1, `File not in reading order: ${id}`);
    return index;
  });
  const toIndex = $$content.readingOrder.indexOf(toContentId);
  invariant(toIndex !== -1, `File not in reading order: ${toContentId}`);

  const renamedFiles: [string, string][] = [];
  const entryContext = $$sandbox.vivliostyleConfig.entryContext || '';

  // update content
  const toFolder = toItem.filename.split(sep).slice(0, toDepth);
  for (const item of fromItems) {
    const newFilename = [
      ...toFolder,
      ...item.filename.split(sep).slice(fromDepth),
    ].join(sep);
    if (newFilename === item.filename) {
      continue;
    }
    renamedFiles.push([
      join(entryContext, item.filename),
      join(entryContext, newFilename),
    ]);
    item.filename = newFilename;
  }
  const arr = $$content.readingOrder.filter(
    (id) => !fromContentId.includes(id),
  );
  const insertIndex =
    arr.indexOf(toContentId) + (toIndex > Math.min(...fromIndexes) ? 1 : 0);
  $$content.readingOrder = [
    ...arr.slice(0, insertIndex),
    ...fromContentId,
    ...arr.slice(insertIndex),
  ];

  // update sandbox
  for (const [oldFilename, newFilename] of renamedFiles) {
    $$sandbox.files[newFilename] = $$sandbox.files[oldFilename];
    delete $$sandbox.files[oldFilename];
  }
  $$sandbox.updateVivliostyleConfig((config) => {
    const getPath = (it: EntryConfig | string) =>
      typeof it === 'string' ? it : it.path;
    const entries = [config.entry].flat();
    const arr = entries.filter((_, index) => !fromIndexes.includes(index));
    const insertIndex =
      arr.findIndex((it) => getPath(it) === getPath(entries[toIndex])) +
      (toIndex > Math.min(...fromIndexes) ? 1 : 0);
    config.entry = [
      ...arr.slice(0, insertIndex),
      ...entries
        .filter((_, index) => fromIndexes.includes(index))
        .map((it) => {
          const filename = getPath(it);
          const renamed = renamedFiles.find(
            ([oldFilename]) => oldFilename === filename,
          );
          if (renamed) {
            return typeof it === 'string'
              ? renamed[1]
              : { ...it, path: renamed[1] };
          }
          return it;
        }),
      ...arr.slice(insertIndex),
    ];
  });
}
