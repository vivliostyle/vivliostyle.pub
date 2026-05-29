/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_IFRAME_HTML: string;
  readonly VITE_APP_HOSTNAME: string;
  readonly VITE_SANDBOX_HOSTNAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Compile-time constants injected by `vite.config.ts`. Using a literal global
// (rather than `import.meta.env`) lets rolldown constant-fold the value and
// dead-strip the disabled branches when `__CLOUD_ENABLED__` is `false`.
declare const __CLOUD_ENABLED__: boolean;
declare const __API_BASE_URL__: string;
