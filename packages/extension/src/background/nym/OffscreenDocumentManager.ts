/**
 * chrome.offscreen lifecycle for the Nym mix-fetch host document.
 * Creating the document ≠ Mixnet connected.
 */

const OFFSCREEN_PATH = 'nym-offscreen.html';
const OFFSCREEN_REASON = 'WORKERS' as chrome.offscreen.Reason;
const OFFSCREEN_JUSTIFICATION =
  'Host Nym mix-fetch WASM web worker for Mixnet HTTP egress (DOM window required)';

export type OffscreenDocumentApi = {
  hasDocument?: () => Promise<boolean>;
  createDocument: (params: chrome.offscreen.CreateParameters) => Promise<void>;
  closeDocument: () => Promise<void>;
};

function getOffscreenApi(): OffscreenDocumentApi | null {
  if (typeof chrome === 'undefined' || !chrome) return null;
  const api = (chrome as typeof chrome & { offscreen?: OffscreenDocumentApi }).offscreen;
  return api ?? null;
}

export class OffscreenDocumentManager {
  private _creating: Promise<void> | null = null;

  constructor(
    private readonly _api: OffscreenDocumentApi | null = getOffscreenApi(),
    private readonly _getUrl: (path: string) => string = (p) => chrome.runtime.getURL(p),
  ) {}

  isApiAvailable(): boolean {
    return this._api != null && typeof this._api.createDocument === 'function';
  }

  getDocumentUrl(): string {
    return this._getUrl(OFFSCREEN_PATH);
  }

  async hasOpenDocument(): Promise<boolean> {
    if (!this._api) return false;
    if (typeof this._api.hasDocument === 'function') {
      return this._api.hasDocument();
    }
    // Older typings — best-effort: try create and catch "already exists"
    return false;
  }

  /**
   * Ensure the offscreen document exists. Does not call createMixFetch.
   */
  async ensureDocument(): Promise<void> {
    if (!this._api) {
      throw new Error('chrome.offscreen API unavailable');
    }
    if (await this.hasOpenDocument()) return;
    if (this._creating) {
      await this._creating;
      return;
    }

    this._creating = (async () => {
      try {
        await this._api!.createDocument({
          url: this.getDocumentUrl(),
          reasons: [OFFSCREEN_REASON],
          justification: OFFSCREEN_JUSTIFICATION,
        });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        // Chrome throws if a document already exists.
        if (/already exists|only one offscreen/i.test(message)) {
          return;
        }
        throw cause instanceof Error ? cause : new Error(message);
      }
    })();

    try {
      await this._creating;
    } finally {
      this._creating = null;
    }
  }

  async closeDocument(): Promise<void> {
    if (!this._api) return;
    try {
      await this._api.closeDocument();
    } catch {
      /* already closed */
    }
  }

  async closeDocumentStrict(): Promise<void> {
    if (!this._api) {
      throw new Error('chrome.offscreen API unavailable; cannot verify document closure');
    }

    let closeError: unknown;
    let closeFailed = false;
    try {
      await this._api.closeDocument();
    } catch (cause) {
      closeError = cause;
      closeFailed = true;
    }

    if (typeof this._api.hasDocument === 'function') {
      if (await this._api.hasDocument()) {
        throw new Error(
          closeFailed
            ? `Failed to close offscreen document: ${closeError instanceof Error ? closeError.message : String(closeError)}`
            : 'Offscreen document remains open after close request',
        );
      }
      return;
    }

    if (closeFailed) {
      throw closeError instanceof Error
        ? closeError
        : new Error(`Failed to close offscreen document: ${String(closeError)}`);
    }
  }
}

export function createOffscreenDocumentManager(
  api?: OffscreenDocumentApi | null,
): OffscreenDocumentManager {
  return new OffscreenDocumentManager(api === undefined ? getOffscreenApi() : api);
}
