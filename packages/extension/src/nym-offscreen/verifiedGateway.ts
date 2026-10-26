/**
 * Operator reference for a Nym mainnet entry gateway verified against
 * official sources. Not injected into the runtime allowlist by default.
 *
 * Re-check Node Status API before any live session — host/port can change.
 *
 * Sources (2026-10-26):
 * - https://nym.com/docs/developers/mix-fetch/migration (MixFetchOpts identity example)
 * - https://mainnet-node-status-api.nymtech.cc/v2/gateways/q2A2cbooyC16YJzvdYaSMH9X3cSiieZNtfBr8cE8Fi1
 */

export const NYM_VERIFIED_GATEWAY = {
  /** MixFetchOpts.preferredGateway — base58 identity key. */
  identityKey: 'q2A2cbooyC16YJzvdYaSMH9X3cSiieZNtfBr8cE8Fi1',
  hostname: 'nym-node-cli.devrel.nymte.ch',
  wssPort: 9001,
  /** Solanym allowlist / WSS origin for MV3 host permission derivation. */
  wssOrigin: 'wss://nym-node-cli.devrel.nymte.ch:9001',
  /** Exact chrome.permissions / optional_host_permissions pattern. */
  hostPermissionPattern: 'https://nym-node-cli.devrel.nymte.ch:9001/*',
  statusApiUrl:
    'https://mainnet-node-status-api.nymtech.cc/v2/gateways/q2A2cbooyC16YJzvdYaSMH9X3cSiieZNtfBr8cE8Fi1',
  docsUrl: 'https://nym.com/docs/developers/mix-fetch/migration',
  verifiedAt: '2026-10-26',
} as const;

export type NymVerifiedGateway = typeof NYM_VERIFIED_GATEWAY;
