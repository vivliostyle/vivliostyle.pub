import { type RefObject, useEffect, useState } from 'react';

export interface ContainerRelativeRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export type RectSource =
  | HTMLElement
  | { top: number; left: number; width?: number; height?: number }
  | null;

/**
 * Convert a viewport-coordinate rect (or a DOM element's bounding rect) into
 * a coordinate space relative to the container element. When the source is a
 * DOM element, the rect re-measures via ResizeObserver so the result tracks
 * size changes (e.g. async image load).
 */
export function useContainerRelativeRect(
  containerRef: RefObject<HTMLElement | null>,
  source: RectSource,
): ContainerRelativeRect | null {
  const [rect, setRect] = useState<ContainerRelativeRect | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !source) {
      setRect(null);
      return;
    }
    const measure = () => {
      const cRect = container.getBoundingClientRect();
      if (source instanceof HTMLElement) {
        const r = source.getBoundingClientRect();
        setRect({
          top: r.top - cRect.top,
          left: r.left - cRect.left,
          width: r.width,
          height: r.height,
        });
        return;
      }
      setRect({
        top: source.top - cRect.top,
        left: source.left - cRect.left,
        width: source.width ?? 0,
        height: source.height ?? 0,
      });
    };
    measure();

    if (source instanceof HTMLElement) {
      const observer = new ResizeObserver(measure);
      observer.observe(source);
      return () => observer.disconnect();
    }
  }, [containerRef, source]);

  return rect;
}
