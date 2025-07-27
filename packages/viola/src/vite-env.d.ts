/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_IFRAME_HTML: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
