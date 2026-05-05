import { join, relative } from 'pathe';
import type React from 'react';
import { use, useMemo } from 'react';
import { useSnapshot } from 'valtio';

import {
  CUSTOM_DRAG_MIME_NAME,
  serializeCustomDragPayload,
} from '@v/tiptap-extensions';
import { Button } from '@v/ui/button';
import { Upload } from '@v/ui/icon';
import { openFilePicker } from '../../libs/open-file-picker';
import { $project, $sandbox } from '../../stores/accessors';
import { type MediaAsset, Sandbox } from '../../stores/proxies/sandbox';
import { createPane, PaneContainer, ScrollOverflow } from './util';

type MediaPaneProperty = object;

declare global {
  interface PanePropertyMap {
    media: MediaPaneProperty;
  }
}

export const Pane = createPane<MediaPaneProperty>({
  title: () => 'Media',
  content: (props) => (
    <ScrollOverflow>
      <PaneContainer>
        <Content {...props} />
      </PaneContainer>
    </ScrollOverflow>
  ),
});

function Content(_: MediaPaneProperty) {
  const projectSnap = useSnapshot($project).valueOrThrow();
  const sandbox = use(projectSnap.sandboxPromise);
  const files = useSnapshot(sandbox.files);

  const images = useMemo(
    () => sandbox.mediaAssets.filter((a) => a.category === 'image'),
    [files],
  );

  const handleUpload = async () => {
    const $$sandbox = $sandbox.valueOrThrow();
    const files = await openFilePicker({
      accept: Sandbox.getMediaAccept('image'),
    });
    for (const file of files) {
      await $$sandbox.saveMediaAsset(file);
    }
  };

  return (
    <div className="grid gap-4">
      <div className="flex justify-between items-center">
        <h3 className="text-l font-bold">Images</h3>
        <Button type="button" onClick={handleUpload}>
          <Upload />
          Upload image
        </Button>
      </div>
      {images.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          No images yet. Upload from the button above or drag images into the
          editor.
        </p>
      ) : (
        <ul className="grid grid-cols-3 gap-3">
          {images.map((asset) => (
            <MediaCard key={asset.path} asset={asset} />
          ))}
        </ul>
      )}
    </div>
  );
}

function MediaCard({ asset }: { asset: MediaAsset }) {
  const sandboxSnap = useSnapshot($sandbox).valueOrThrow();
  const entryContext = sandboxSnap.vivliostyleConfig.entryContext || '';

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData(
      CUSTOM_DRAG_MIME_NAME,
      serializeCustomDragPayload({
        type: 'asset',
        path: asset.path,
        category: asset.category,
      }),
    );
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <li
      draggable
      onDragStart={handleDragStart}
      className="cursor-grab rounded-md border bg-card p-2 hover:bg-accent hover:text-accent-foreground active:cursor-grabbing"
    >
      <div className="aspect-square w-full overflow-hidden rounded-sm bg-muted grid place-items-center">
        <img
          src={join('/vivliostyle', relative(entryContext, asset.path))}
          alt=""
          className="h-full w-full object-contain"
          draggable={false}
        />
      </div>
      <p
        className="mt-2 truncate text-xs text-muted-foreground"
        title={asset.filename}
      >
        {asset.filename}
      </p>
    </li>
  );
}
