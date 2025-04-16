import { snapshot } from 'valtio';
import { setupEditor } from './libs/editor';
import { generateId } from './libs/generate-id';
import { type ContentId, content } from './stores/content';
import { sandbox } from './stores/sandbox';
import { ui } from './stores/ui';

const contentId = 'h23HaDuA5MG2bSLW' as ContentId;

export async function setupFirstContent() {
  content.files[contentId] = {
    path: 'manuscript.html',
    json: {},
  };
  content.readingOrder = [contentId];
  ui.tabs = [
    {
      id: generateId(),
      type: 'editor',
      contentId,
    },
  ];
  const editor = await setupEditor({ contentId });
  content.editor[contentId] = editor;
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
      theme: '@vivliostyle/theme-techbook',
    }),
  );
  sandbox.files = { 'manuscript.html': '' };
  await worker.setupServer();
}
