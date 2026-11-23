/**
 * Persists the transport actually used when sending a Stellar transaction
 * (`'nym'` vs `'direct'`) in `chrome.storage.local` keyed by txHash.
 */

export const TX_TRANSPORT_HISTORY_STORAGE_KEY = 'astrym.txTransportHistory';

export type TxTransportKind = 'nym' | 'direct';
export type TxTransportHistoryMap = Record<string, TxTransportKind>;

const MAX_STORED_TX_ENTRIES = 200;

export function parseTxTransportHistory(raw: unknown): TxTransportHistoryMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: TxTransportHistoryMap = {};
  for (const [hash, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof hash === 'string' && hash.length > 0 && (value === 'nym' || value === 'direct')) {
      out[hash] = value;
    }
  }
  return out;
}

export async function readTxTransportHistory(): Promise<TxTransportHistoryMap> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local?.get) return {};
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(TX_TRANSPORT_HISTORY_STORAGE_KEY, (res) => {
        const record = res as Record<string, unknown> | undefined;
        resolve(parseTxTransportHistory(record?.[TX_TRANSPORT_HISTORY_STORAGE_KEY]));
      });
    } catch {
      resolve({});
    }
  });
}

export async function recordTxTransport(
  txHash: string,
  transport: TxTransportKind,
): Promise<TxTransportHistoryMap> {
  const normalizedHash = txHash.trim();
  if (!normalizedHash || (transport !== 'nym' && transport !== 'direct')) {
    return readTxTransportHistory();
  }
  const existing = await readTxTransportHistory();
  const entries = Object.entries(existing).filter(([hash]) => hash !== normalizedHash);
  entries.push([normalizedHash, transport]);
  const trimmed = entries.slice(-MAX_STORED_TX_ENTRIES);
  const next: TxTransportHistoryMap = Object.fromEntries(trimmed);
  if (typeof chrome !== 'undefined' && chrome.storage?.local?.set) {
    await new Promise<void>((resolve) => {
      try {
        chrome.storage.local.set({ [TX_TRANSPORT_HISTORY_STORAGE_KEY]: next }, () => resolve());
      } catch {
        resolve();
      }
    });
  }
  return next;
}

export function stellarExpertTxUrl(txHash: string): string {
  return `https://stellar.expert/explorer/testnet/tx/${encodeURIComponent(txHash)}`;
}
