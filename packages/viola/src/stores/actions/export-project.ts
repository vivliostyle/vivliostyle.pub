import { $sandbox } from '../sandbox';

function downloadFile({
  name,
  mimeType,
  content,
}: { name: string; mimeType: string; content: Uint8Array }) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export async function exportEpub() {
  const cli = await $sandbox.cli;
  const content = await cli.buildEpub();
  downloadFile({
    name: 'publication.epub',
    mimeType: 'application/epub+zip',
    content,
  });
}

export async function exportWebPub() {
  const cli = await $sandbox.cli;
  const content = await cli.buildWebPub();
  downloadFile({
    name: 'publication.zip',
    mimeType: 'application/zip',
    content,
  });
}

export async function exportProjectZip() {
  const cli = await $sandbox.cli;
  const content = await cli.exportProjectZip();
  downloadFile({
    name: 'project.zip',
    mimeType: 'application/zip',
    content,
  });
}
