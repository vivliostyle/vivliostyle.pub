import { useEffect, useRef, useState } from 'react';

import type {
  ExtensionMountContext,
  ExtensionTranslate,
} from '@v/extension-kit';
import { stageSearchParams } from '@v/viewer/protocol';
import {
  loadPreferences,
  type PreviewPreferences,
  savePreferences,
} from '../preferences';
import { Toolbar } from '../toolbar';
import { useStage } from '../use-stage';

import '@v/extension-kit/styles.css';

export default function PreviewPane({ host, t }: ExtensionMountContext) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    void host.getViewerUrl().then((viewerUrl) => {
      if (!disposed) {
        setUrl(viewerUrl);
      }
    });
    return () => {
      disposed = true;
    };
  }, [host]);

  if (!url) {
    return null;
  }

  return <Preview key={url} url={url} t={t} />;
}

function Preview({ url, t }: { url: string; t: ExtensionTranslate }) {
  const [preferences, setPreferences] = useState(loadPreferences);
  // Only the first value goes into the URL, so a preference change does not
  // reload the frame; later changes go through the stage controller.
  const [frameUrl] = useState(() => {
    const stageUrl = new URL(url);
    stageUrl.searchParams.set(stageSearchParams.viewMode, preferences.viewMode);
    stageUrl.searchParams.set(
      stageSearchParams.paperSize,
      preferences.paperSize,
    );
    return stageUrl.href;
  });
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [frameLoadCount, setFrameLoadCount] = useState(0);
  const { stage, state } = useStage(frameRef, frameUrl, frameLoadCount);

  useEffect(() => {
    savePreferences(preferences);
  }, [preferences]);

  // The stage ignores values it already has, so this costs nothing on a fresh
  // bind and brings a reloaded frame up to date.
  useEffect(() => {
    stage?.setViewMode(preferences.viewMode);
  }, [stage, preferences.viewMode]);
  useEffect(() => {
    stage?.setDefaultPaperSize(preferences.paperSize);
  }, [stage, preferences.paperSize]);

  return (
    <div className="flex size-full flex-col">
      <Toolbar
        stage={stage}
        state={state}
        preferences={preferences}
        onPreferencesChange={(patch: Partial<PreviewPreferences>) =>
          setPreferences((current) => ({ ...current, ...patch }))
        }
        t={t}
      />
      <iframe
        ref={frameRef}
        title={t('preview_iframe_title')}
        src={frameUrl}
        onLoad={() => setFrameLoadCount((count) => count + 1)}
        className="block min-h-0 w-full flex-1"
        sandbox="allow-same-origin allow-scripts allow-modals"
        allow="cross-origin-isolated"
      />
    </div>
  );
}
