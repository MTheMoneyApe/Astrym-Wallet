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
  /**
   * MixFetchOpts.preferredNetworkRequester — Nym address of this gateway's
   * own Network Requester (`self_described.network_requester.address`).
   *
   * Random NR selection among ~800 providers often hangs at SOCKS CONNECT
   * (createMixFetch Ready ≠ working HTTP). Pinning the entry gateway's NR
   * (uses_exit_policy=false as of verify date) keeps MixFetch HTTP egress
   * on the same node we already authenticated to.
   */
  networkRequesterAddress:
    '7Y9eyF1p1JmzHnd7TVZufnQHkh93ASc9sRBCFY57ZGr8.F8KPyVMVqFQ5yJC3LqeP2ZC7fukzj9a1T426rjo432yT@q2A2cbooyC16YJzvdYaSMH9X3cSiieZNtfBr8cE8Fi1',
  statusApiUrl:
    'https://mainnet-node-status-api.nymtech.cc/v2/gateways/q2A2cbooyC16YJzvdYaSMH9X3cSiieZNtfBr8cE8Fi1',
  docsUrl: 'https://nym.com/docs/developers/mix-fetch/migration',
  verifiedAt: '2026-11-04',
} as const;

export type NymVerifiedGateway = typeof NYM_VERIFIED_GATEWAY;
