/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NYM_LIVE_SMOKE_AUTHORIZED?: string;
  /** Optional HTTPS echo URL for MixFetch HTTP round-trip smoke. */
  readonly VITE_NYM_HTTP_SMOKE_URL?: string;
  /** Optional HTTPS GET URL for public-data transport integration. */
  readonly VITE_NYM_PUBLIC_DATA_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
