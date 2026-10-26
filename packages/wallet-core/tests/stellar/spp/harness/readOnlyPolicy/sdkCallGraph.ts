/**
 * Fase 2.25 — Call-graph evidence for RO-1 APIs against SPP 0.2.1 / b79107cd.
 *
 * COMPROBADO_EN_FUENTE = traced in local snapshot / npm JS.
 * INFERIDO = reasonable from types/docs but not line-traced here.
 * NO_DEMOSTRADO = cannot prove from harness without real WASM/extension.
 *
 * This module is documentation-as-data for tests — it does not invoke the SDK.
 */

export type EvidenceClass = 'COMPROBADO_EN_FUENTE' | 'INFERIDO' | 'NO_DEMOSTRADO';

export type CallGraphNode = {
  symbol: string;
  evidence: EvidenceClass;
  notes: string;
};

export type Ro1MethodAudit = {
  method: 'Storage.open' | 'Client.new' | 'Client.aspState' | 'Client.allContractsData';
  entrypoints: CallGraphNode[];
  rpcMethods: readonly string[];
  syncProverSignSend: {
    sync: boolean;
    prove: boolean;
    sign: boolean;
    send: boolean;
    evidence: EvidenceClass;
  };
  backgroundTasksAtInit: CallGraphNode[];
  escapeHatches: CallGraphNode[];
  limitations: string[];
};

/** Audited RO-1 surface (FASE-2.8–2.12 + 2.25 re-trace). */
export const RO1_SDK_CALL_GRAPHS: readonly Ro1MethodAudit[] = [
  {
    method: 'Storage.open',
    entrypoints: [
      {
        symbol: 'js/index.js openStorage → WasmStorage.open',
        evidence: 'COMPROBADO_EN_FUENTE',
        notes: 'storage-worker URL; OPFS-backed spp.db',
      },
    ],
    rpcMethods: [],
    syncProverSignSend: {
      sync: false,
      prove: false,
      sign: false,
      send: false,
      evidence: 'COMPROBADO_EN_FUENTE',
    },
    backgroundTasksAtInit: [
      {
        symbol: 'storage-worker DedicatedWorker',
        evidence: 'COMPROBADO_EN_FUENTE',
        notes: 'local worker; not chain sync',
      },
    ],
    escapeHatches: [
      {
        symbol: 'storage.call(request)',
        evidence: 'COMPROBADO_EN_FUENTE',
        notes: 'low-level worker RPC — NOT on RO-1 allowlist; default deny',
      },
    ],
    limitations: [
      'Worker message surface not exhaustively enumerated in partial snapshot',
      'Requires browser OPFS — not available in plain Node vitest',
    ],
  },
  {
    method: 'Client.new',
    entrypoints: [
      {
        symbol: 'js/index.js newClient',
        evidence: 'COMPROBADO_EN_FUENTE',
        notes: 'may open Storage; ProverBridge.spawn+configureCircuitsBase+ping',
      },
      {
        symbol: 'WasmClient.new → NativeClient::init',
        evidence: 'COMPROBADO_EN_FUENTE',
        notes: 'sdk/web/src/client/mod.rs; sdk/native/src/client.rs',
      },
      {
        symbol: 'RpcClient::new(rpc_url)',
        evidence: 'COMPROBADO_EN_FUENTE',
        notes: 'stores base URL; no RPC call at construct (traced)',
      },
      {
        symbol: 'SyncHandle::inline(bootnode_url)',
        evidence: 'COMPROBADO_EN_FUENTE',
        notes: 'mode Inline; does not spawn BackgroundSync::run',
      },
    ],
    rpcMethods: [],
    syncProverSignSend: {
      sync: false,
      prove: false,
      sign: false,
      send: false,
      evidence: 'COMPROBADO_EN_FUENTE',
    },
    backgroundTasksAtInit: [
      {
        symbol: 'ProverBridge worker ping',
        evidence: 'COMPROBADO_EN_FUENTE',
        notes: 'loads circuits; NOT prove_transact / prove_next',
      },
      {
        symbol: 'registerTelemetrySinks',
        evidence: 'COMPROBADO_EN_FUENTE',
        notes: 'local sinks; not asserted to be network-free in all builds',
      },
    ],
    escapeHatches: [
      {
        symbol: 'options.bootnodeUrl',
        evidence: 'COMPROBADO_EN_FUENTE',
        notes: 'stored on SyncHandle; used by later sync/catch_up — RO-1 forbids key',
      },
      {
        symbol: 'client.backgroundSync() / client.sync()',
        evidence: 'COMPROBADO_EN_FUENTE',
        notes: 'explicit APIs; RO-1 deny — init does not call them',
      },
      {
        symbol: 'NativeClient::init_readonly',
        evidence: 'COMPROBADO_EN_FUENTE',
        notes: 'exists in native; NOT exported on WASM JS Client.new surface',
      },
    ],
    limitations: [
      'Cannot prove zero network from telemetry without browser guard',
      'prover.ping() may touch local worker only — NO_DEMOSTRADO vs remote',
    ],
  },
  {
    method: 'Client.aspState',
    entrypoints: [
      {
        symbol: 'Client.asp_state → state_fetcher → StateFetcher::asp_state',
        evidence: 'COMPROBADO_EN_FUENTE',
        notes: 'web client/mod.rs; contract_state.rs',
      },
      {
        symbol: 'contracts_data([], asp_mem, asp_non) → get_contract_data_bulk',
        evidence: 'COMPROBADO_EN_FUENTE',
        notes: 'enum keys Admin/NextIndex + Admin',
      },
      {
        symbol: 'RpcClient::get_ledger_entries',
        evidence: 'COMPROBADO_EN_FUENTE',
        notes: 'sole RPC method on this path',
      },
    ],
    rpcMethods: ['getLedgerEntries'],
    syncProverSignSend: {
      sync: false,
      prove: false,
      sign: false,
      send: false,
      evidence: 'COMPROBADO_EN_FUENTE',
    },
    backgroundTasksAtInit: [],
    escapeHatches: [
      {
        symbol: 'ensure_synced',
        evidence: 'COMPROBADO_EN_FUENTE',
        notes: 'NOT called on asp_state path (unlike operational_feed)',
      },
    ],
    limitations: [
      'WASM acceptance demonstrated in FASE-2.9 harness — not re-run in 2.25 unit suite',
      'Policy cannot inspect WASM internals at runtime in Node',
    ],
  },
  {
    method: 'Client.allContractsData',
    entrypoints: [
      {
        symbol: 'StateFetcher::all_contracts_data → contracts_data(enabled_pools,…)',
        evidence: 'COMPROBADO_EN_FUENTE',
        notes: 'pool Admin/State + ASP keys',
      },
      {
        symbol: 'get_contract_data_bulk → get_ledger_entries',
        evidence: 'COMPROBADO_EN_FUENTE',
        notes: 'same RPC class as aspState',
      },
    ],
    rpcMethods: ['getLedgerEntries'],
    syncProverSignSend: {
      sync: false,
      prove: false,
      sign: false,
      send: false,
      evidence: 'COMPROBADO_EN_FUENTE',
    },
    backgroundTasksAtInit: [],
    escapeHatches: [
      {
        symbol: 'contracts_data_for_pool',
        evidence: 'COMPROBADO_EN_FUENTE',
        notes: 'alternate entry; not exposed as separate JS method on Client wrap',
      },
    ],
    limitations: [
      'WASM acceptance FASE-2.12 — not re-run in 2.25 unit suite',
    ],
  },
];

/** Methods that must remain denied because SRC shows dangerous transitive effects. */
export const BLOCKED_DUE_TO_TRANSITIVE_EFFECTS = [
  {
    method: 'Client.sync',
    effect: 'catch_up → getEvents + getLatestLedger',
    evidence: 'COMPROBADO_EN_FUENTE' as EvidenceClass,
  },
  {
    method: 'Client.backgroundSync',
    effect: 'spawns indexer loop',
    evidence: 'COMPROBADO_EN_FUENTE' as EvidenceClass,
  },
  {
    method: 'Client.operationalFeed',
    effect: 'ensure_synced → catch_up',
    evidence: 'COMPROBADO_EN_FUENTE' as EvidenceClass,
  },
  {
    method: 'Client.recipientLookup',
    effect: 'ensure_synced → catch_up',
    evidence: 'COMPROBADO_EN_FUENTE' as EvidenceClass,
  },
  {
    method: 'Client.verifySelectiveDisclosure',
    effect: 'StateFetcher + prover verify path',
    evidence: 'COMPROBADO_EN_FUENTE' as EvidenceClass,
  },
  {
    method: 'PrivatePool.deposit',
    effect: 'execute_plan → prove/sim/sign/send',
    evidence: 'COMPROBADO_EN_FUENTE' as EvidenceClass,
  },
] as const;
