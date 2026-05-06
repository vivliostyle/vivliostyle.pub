import type React from 'react';
import { useState } from 'react';

import { cn } from '@v/ui/lib/utils';
import { $sandbox } from '../../../stores/accessors';

export interface ImageDropZoneProps {
  label: string;
}

export function ImageDropZone({
  label,
  children,
}: React.PropsWithChildren<ImageDropZoneProps>) {
  const [isDragOver, setIsDragOver] = useState(false);

  const hasFiles = (e: React.DragEvent) =>
    Array.from(e.dataTransfer.types).includes('Files');

  const handleDragOver = (e: React.DragEvent) => {
    if (!hasFiles(e)) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) {
      return;
    }
    setIsDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    if (!hasFiles(e)) {
      return;
    }
    e.preventDefault();
    setIsDragOver(false);
    const droppedImages = Array.from(e.dataTransfer.files).filter((f) =>
      f.type.startsWith('image/'),
    );
    if (droppedImages.length === 0) {
      return;
    }
    const $$sandbox = $sandbox.valueOrThrow();
    for (const file of droppedImages) {
      await $$sandbox.saveMediaAsset(file);
    }
  };

  return (
    <section
      aria-label={label}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        'size-full transition-shadow',
        isDragOver && 'ring-2 ring-inset ring-primary bg-primary/5',
      )}
    >
      {children}
    </section>
  );
}
