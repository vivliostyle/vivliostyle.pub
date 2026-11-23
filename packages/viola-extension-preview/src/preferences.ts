import {
  clampZoomScale,
  defaultViewMode,
  defaultZoom,
  isViewMode,
  isZoom,
  type ViewMode,
  type Zoom,
} from '@v/viewer/protocol';

export interface PreviewPreferences {
  viewMode: ViewMode;
  zoom: Zoom;
}

// Kept by this view rather than the stage: the view's origin is the same for
// every project, while each project's stage runs on an origin of its own.
const storageKey = 'preview-preferences';

const defaults: PreviewPreferences = {
  viewMode: defaultViewMode,
  zoom: defaultZoom,
};

// Storage access throws where the browser blocks storage for this frame
// (a sandboxed or partitioned third-party context).
export function loadPreferences(): PreviewPreferences {
  try {
    const stored: unknown = JSON.parse(
      localStorage.getItem(storageKey) ?? 'null',
    );
    if (typeof stored !== 'object' || stored === null) {
      return defaults;
    }
    const { viewMode, zoom } = stored as Record<string, unknown>;
    return {
      viewMode: isViewMode(viewMode) ? viewMode : defaults.viewMode,
      zoom: !isZoom(zoom)
        ? defaults.zoom
        : typeof zoom === 'number'
          ? clampZoomScale(zoom)
          : zoom,
    };
  } catch {
    return defaults;
  }
}

export function savePreferences(preferences: PreviewPreferences) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(preferences));
  } catch {
    // Preferences then last for this session only.
  }
}
