// Sizes an extension's cross-origin view iframe to its content height.
//
// Browsers are gaining a native path for this — CSS Sizing Level 4 "Responsive
// iframes": `frame-sizing: content-height` on the parent <iframe> paired with a
// `<meta name="responsive-embedded-sizing">` opt-in in the embedded document
// (Chromium "Intent to Prototype", 2025). Until that is broadly available (and
// past its current one-shot-at-load limitation), we measure the content with a
// ResizeObserver in the iframe realm and report it to the host over postMessage.
const NATIVE_FRAME_SIZING =
  typeof CSS !== 'undefined' && CSS.supports('frame-sizing', 'content-height');

const RESIZE_COMMAND = 'extension-resize';

interface ExtensionResizeMessage {
  command: typeof RESIZE_COMMAND;
  height: number;
}

function hostOrigin(): string {
  return `https://${import.meta.env.VITE_APP_HOSTNAME}${location.port ? `:${location.port}` : ''}`;
}

/**
 * Host realm: keep `iframe`'s height matched to the content rendered inside it
 * (whose document is served from `origin`). Returns a teardown function.
 */
export function attachExtensionAutoSize(
  iframe: HTMLIFrameElement,
  origin: string,
): () => void {
  if (NATIVE_FRAME_SIZING) {
    iframe.style.setProperty('frame-sizing', 'content-height');
    return () => iframe.style.removeProperty('frame-sizing');
  }
  let appliedHeight = 0;
  const onMessage = (event: MessageEvent) => {
    if (event.origin !== origin) return;
    if (event.source !== iframe.contentWindow) return;
    const data = event.data as Partial<ExtensionResizeMessage> | undefined;
    if (data?.command !== RESIZE_COMMAND || typeof data.height !== 'number') {
      return;
    }
    // Grow-only on purpose: never shrink the pane, so content that briefly
    // collapses (re-layout, async loads) doesn't make the frame jump around.
    if (data.height <= appliedHeight) return;
    appliedHeight = data.height;
    iframe.style.height = `${data.height}px`;
  };
  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
}

/**
 * Iframe realm: report this document's content height to the host so it can
 * size the embedding <iframe>. Returns a teardown function.
 */
export function reportExtensionContentSize(): () => void {
  if (NATIVE_FRAME_SIZING) {
    const meta = document.createElement('meta');
    meta.name = 'responsive-embedded-sizing';
    document.head.appendChild(meta);
    return () => meta.remove();
  }
  const target = hostOrigin();
  const post = () => {
    window.parent.postMessage(
      {
        command: RESIZE_COMMAND,
        height: document.body.scrollHeight,
      } satisfies ExtensionResizeMessage,
      target,
    );
  };
  const observer = new ResizeObserver(post);
  observer.observe(document.body);
  return () => observer.disconnect();
}
