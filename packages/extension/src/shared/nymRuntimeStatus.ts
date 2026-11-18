/**
 * Push channel for Nym runtime snapshots.
 * Views listen here so a MixFetch drop updates the indicator without a storage
 * write or a view change. The payload is the same non-secret snapshot as NYM_STATUS.
 */

export const NYM_RUNTIME_STATUS_CHANNEL = 'astrym-nym-runtime-status' as const;

export type NymRuntimeStatusSnapshot = {
  state: 'disconnected' | 'connecting' | 'connected' | 'error' | 'closed';
  lastError: string | null;
  connected: boolean;
  implementation: string;
  mode: 'direct' | 'nym';
  preferenceHydrated: boolean;
  egressBlocked: boolean;
  privacyPreference: 'direct' | 'nym' | null;
  /**
   * True only when privacyPreference was read from storage or written successfully.
   * A failed setMode('nym') leaves this false. Reload then restores the last
   * successful value; that is not evidence the failed Nym choice was saved.
   */
  preferenceDurable: boolean;
  documentReady: boolean;
  diagnosticCode?: string;
  diagnosticStage?: string | null;
  selfAddress?: string | null;
};

export type NymRuntimeStatusMessage = {
  channel: typeof NYM_RUNTIME_STATUS_CHANNEL;
  snapshot: NymRuntimeStatusSnapshot;
};

export function isNymRuntimeStatusMessage(message: unknown): message is NymRuntimeStatusMessage {
  if (!message || typeof message !== 'object') return false;
  const record = message as { channel?: unknown; snapshot?: unknown };
  if (record.channel !== NYM_RUNTIME_STATUS_CHANNEL) return false;
  const snapshot = record.snapshot;
  if (!snapshot || typeof snapshot !== 'object') return false;
  const snap = snapshot as { connected?: unknown; egressBlocked?: unknown; mode?: unknown };
  return (
    typeof snap.connected === 'boolean' &&
    typeof snap.egressBlocked === 'boolean' &&
    (snap.mode === 'direct' || snap.mode === 'nym')
  );
}

type RuntimeMessageEvent = {
  addListener: (listener: (message: unknown, ...rest: unknown[]) => void) => void;
  removeListener: (listener: (message: unknown, ...rest: unknown[]) => void) => void;
};

/** Subscribe for the life of a view. Does not read storage and does not change route. */
export function bindNymRuntimeStatus(
  onMessage: RuntimeMessageEvent | null | undefined,
  onStatus: (snapshot: NymRuntimeStatusSnapshot) => void,
): () => void {
  if (!onMessage) return () => {};
  const listener = (message: unknown) => {
    if (!isNymRuntimeStatusMessage(message)) return;
    onStatus(message.snapshot);
  };
  onMessage.addListener(listener);
  return () => {
    onMessage.removeListener(listener);
  };
}
