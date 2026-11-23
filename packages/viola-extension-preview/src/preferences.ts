import { defaultViewMode, isViewMode, type ViewMode } from '@v/viewer/protocol';

export interface PreviewPreferences {
  viewMode: ViewMode;
}

// Kept by this view rather than the stage: the view's origin is the same for
// every project, while each project's stage runs on an origin of its own.
const storageKey = 'preview-preferences';

const defaults: PreviewPreferences = {
  viewMode: defaultViewMode,
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
    const { viewMode } = stored as Record<string, unknown>;
    return { viewMode: isViewMode(viewMode) ? viewMode : defaults.viewMode };
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
