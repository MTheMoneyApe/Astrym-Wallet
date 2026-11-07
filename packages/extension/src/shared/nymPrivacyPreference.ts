/**
 * Persisted wallet privacy choice.
 *
 * One store: `chrome.storage.local` under {@link NYM_PRIVACY_PREFERENCE_STORAGE_KEY}.
 * The MV3 service worker reads it again after a worker restart. The webapp shim
 * writes that same area to localStorage (`astrym.chrome.storage.local.v1`), so a
 * page reload restores it. IndexedDB remains the session CryptoKey store and is
 * not a second copy of this choice.
 *
 * Only the strings `'direct'` and `'nym'` are valid. Anything else is corrupt
 * and must fail closed (no silent clearnet). The SPP broadcast gate is
 * process-local and is intentionally not stored here.
 *
 * A failed `setMode('nym')` does not update this record. The running controller
 * may show Nym in memory with `preferenceDurable: false` and
 * `PRIVACY_PREFERENCE_PERSIST_FAILED`. That selection was not saved. The next
 * controller reads this key and restores the last successful value, which can
 * be a previous explicit `direct`. Do not describe the failed Nym write as persisted.
 */

export const NYM_PRIVACY_PREFERENCE_STORAGE_KEY = 'astrym.nym.privacyMode.v1';

export type NymPrivacyChoice = 'direct' | 'nym';

export type NymPrivacyPreferenceStore = {
  get: (keys?: string | string[] | null) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
};

export type NymPrivacyPreferenceRecord =
  | { kind: 'unset' }
  | { kind: 'chosen'; choice: NymPrivacyChoice }
  | { kind: 'corrupt' };

/** Interpret a value that is present in storage. Missing keys are handled by {@link readNymPrivacyPreference}. */
export function parseStoredNymPrivacyPreference(value: unknown): NymPrivacyPreferenceRecord {
  if (value === 'direct' || value === 'nym') {
    return { kind: 'chosen', choice: value };
  }
  return { kind: 'corrupt' };
}

export async function readNymPrivacyPreference(
  store: NymPrivacyPreferenceStore,
): Promise<NymPrivacyPreferenceRecord> {
  const raw = await store.get(NYM_PRIVACY_PREFERENCE_STORAGE_KEY);
  if (!Object.prototype.hasOwnProperty.call(raw, NYM_PRIVACY_PREFERENCE_STORAGE_KEY)) {
    return { kind: 'unset' };
  }
  return parseStoredNymPrivacyPreference(raw[NYM_PRIVACY_PREFERENCE_STORAGE_KEY]);
}

export async function writeNymPrivacyPreference(
  store: NymPrivacyPreferenceStore,
  choice: NymPrivacyChoice,
): Promise<void> {
  if (choice !== 'direct' && choice !== 'nym') {
    throw new Error(`Refusing to persist privacy mode ${String(choice)}`);
  }
  await store.set({ [NYM_PRIVACY_PREFERENCE_STORAGE_KEY]: choice });
}
