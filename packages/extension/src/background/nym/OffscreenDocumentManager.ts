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
          url: this._getUrl(OFFSCREEN_PATH),
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
}

export function createOffscreenDocumentManager(
  api?: OffscreenDocumentApi | null,
): OffscreenDocumentManager {
  return new OffscreenDocumentManager(api === undefined ? getOffscreenApi() : api);
}
