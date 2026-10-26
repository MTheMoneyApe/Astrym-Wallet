/**
 * Isolated browser harness for stellar-private-payments@0.2.1 (Fase 2.1 / 2.7).
 *
 * Stage A: OPFS + WASM + Storage worker.
 * Stage B: Client.new against same-origin synthetic mock RPC (/rpc) — no backgroundSync.
 * Stage C (optional): account + derivePrivacyKeys with rejecting recorder.
 * Stage D (Fase 2.7): read-only readTokenDecimals against /rpc — expect simulateTransaction
 *   only; mock remains fail-closed for that method (no invented success body).
 * Stage E (Fase 2.12): read-only Client.allContractsData() — getLedgerEntries via
 *   StateFetcher for enabled pool (Admin/State + instance) + ASP; no sync/ZK/write.
 *   aspState() remains proven in Fase 2.9 (not re-probed here).
 *
 * Classifications written into window.__SPP_HARNESS_RESULT__.
 * Never calls backgroundSync, register, deposit, transfer, withdraw, or sendTransaction.
 */

const HARNESS_REJECT = 'RecordingWalletSigner: harness does not produce valid signatures';
/** Synthetic public fixture (SEP-0005 TV1 address) — not a user account. */
const SYNTHETIC_G = 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6';
const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';

/** @type {{ method: string, input?: string, opts?: object, atMs: number, source: string }[]} */
const signerCalls = [];

function createRecordingSigner(sourceTag) {
  return {
    async getPublicKey() {
      signerCalls.push({ method: 'getPublicKey', atMs: Date.now(), source: sourceTag });
      return SYNTHETIC_G;
    },
    async signMessage(message, opts) {
      signerCalls.push({
        method: 'signMessage',
        input: message,
        opts,
        atMs: Date.now(),
        source: sourceTag,
      });
      throw new Error(HARNESS_REJECT);
    },
    async signTransaction(xdr, opts) {
      signerCalls.push({
        method: 'signTransaction',
        input: xdr,
        opts,
        atMs: Date.now(),
        source: sourceTag,
      });
      throw new Error(HARNESS_REJECT);
    },
    async signAuthEntry(xdr, opts) {
      signerCalls.push({
        method: 'signAuthEntry',
        input: xdr,
        opts,
        atMs: Date.now(),
        source: sourceTag,
      });
      throw new Error(HARNESS_REJECT);
    },
  };
}

function installNetworkGuard(report) {
  const originalFetch = globalThis.fetch.bind(globalThis);
  const blocked = [];
  const allowed = [];
  const externalSent = [];

  globalThis.fetch = async (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input && typeof input.url === 'string'
            ? input.url
            : String(input);
    const resolved = new URL(url, location.href);
    if (resolved.origin !== location.origin) {
      blocked.push(resolved.href);
      throw new Error(`offline harness: blocked external fetch ${resolved.href}`);
    }
    allowed.push(resolved.href);
    try {
      return await originalFetch(input, init);
    } catch (e) {
      // Same-origin failures are local; do not count as externalSent.
      throw e;
    }
  };

  const XHR = globalThis.XMLHttpRequest;
  if (XHR) {
    const open = XHR.prototype.open;
    XHR.prototype.open = function (method, url, ...rest) {
      const resolved = new URL(String(url), location.href);
      if (resolved.origin !== location.origin) {
        blocked.push(resolved.href);
        throw new Error(`offline harness: blocked external XHR ${resolved.href}`);
      }
      return open.call(this, method, url, ...rest);
    };
  }

  report.network = {
    blocked,
    allowed,
    externalSent,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

async function probeOpfs() {
  const out = {
    hasNavigatorStorage: typeof navigator !== 'undefined' && !!navigator.storage,
    hasGetDirectory: typeof navigator?.storage?.getDirectory === 'function',
    status: 'BLOQUEADO',
    error: null,
  };
  if (!out.hasGetDirectory) {
    out.error = 'navigator.storage.getDirectory unavailable';
    return out;
  }
  try {
    const root = await navigator.storage.getDirectory();
    const name = `solanym-spp-harness-${Date.now()}`;
    const dir = await root.getDirectoryHandle(name, { create: true });
    await root.removeEntry(name, { recursive: true });
    out.status = 'INICIALIZADO';
    out.dirKind = dir.kind;
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
    out.status = 'BLOQUEADO';
  }
  return out;
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function run() {
  const report = {
    phase: '2.12',
    startedAt: new Date().toISOString(),
    browser: {
      userAgent: navigator.userAgent,
      vendor: navigator.vendor,
      language: navigator.language,
    },
    playwrightInstalledInRepo: false,
    stages: {},
    rpcMock: { url: `${location.origin}/rpc`, synthetic: true },
    signerCallsFromSdk: [],
    syntheticSignerProbe: null,
    notes: [],
  };

  installNetworkGuard(report);
  // Clear mock log at start
  try {
    await fetch('/mock-rpc-log/clear', { method: 'POST' });
  } catch {
    /* ignore */
  }

  const statusEl = document.getElementById('status');
  const reportEl = document.getElementById('report');
  const paint = () => {
    reportEl.textContent = JSON.stringify(report, null, 2);
    window.__SPP_HARNESS_RESULT__ = report;
  };

  // --- Stage A ---
  report.stages.opfs = await probeOpfs();
  paint();

  let storage = null;
  let client = null;
  let wasmMod = null;
  let sppFacade = null;

  try {
    wasmMod = await import('/node_modules/stellar-private-payments/dist/stellar_private_payments_web.js');
    const wasmUrl = new URL(
      '/node_modules/stellar-private-payments/dist/stellar_private_payments_web_bg.wasm',
      location.origin,
    );
    await wasmMod.default({ module_or_path: wasmUrl });
    report.stages.wasm = {
      status: 'INICIALIZADO',
      via: 'stellar_private_payments_web.js + local wasm URL',
    };

    const workerUrl = new URL(
      '/node_modules/stellar-private-payments/dist/workers/storage-worker.js',
      location.origin,
    ).href;

    const workerProbe = { status: 'PARCIAL', workerUrl, error: null };
    try {
      await new Promise((resolve, reject) => {
        const w = new Worker(workerUrl, { type: 'module' });
        const t = setTimeout(() => {
          w.terminate();
          reject(new Error('worker spawn timeout'));
        }, 5000);
        w.addEventListener('error', (ev) => {
          clearTimeout(t);
          reject(ev.error || new Error(ev.message || 'worker error'));
        });
        setTimeout(() => {
          clearTimeout(t);
          w.terminate();
          resolve(undefined);
        }, 400);
      });
      workerProbe.status = 'INICIALIZADO';
    } catch (e) {
      workerProbe.status = 'BLOQUEADO';
      workerProbe.error = e instanceof Error ? e.message : String(e);
    }
    report.stages.worker = workerProbe;

    storage = await wasmMod.Storage.open({ workerUrl });
    report.stages.storage = {
      status: 'INICIALIZADO',
      hasFork: typeof storage?.fork === 'function',
      keptOpenForClient: true,
    };
  } catch (e) {
    report.stages.wasm = {
      status: 'BLOQUEADO',
      error: e instanceof Error ? e.message : String(e),
    };
    report.stages.worker = report.stages.worker || {
      status: 'BLOQUEADO',
      error: 'skipped after wasm failure',
    };
    report.stages.storage = { status: 'BLOQUEADO', error: 'skipped after wasm failure' };
  }
  paint();

  // --- Stage B: Client.new (no backgroundSync) ---
  const isolationOk =
    report.network.blocked.length === 0 &&
    report.stages.storage?.status === 'INICIALIZADO' &&
    report.stages.wasm?.status === 'INICIALIZADO';

  if (!isolationOk) {
    report.stages.clientNew = {
      status: 'BLOQUEADO',
      reason: 'Network isolation or Stage A failed — Client.new not invoked',
      blocked: report.network.blocked.slice(),
    };
  } else {
    try {
      sppFacade = await import('/node_modules/stellar-private-payments/js/index.js');
      const contractConfig = await fetch(
        '/tests/stellar/spp/harness/browser/synthetic-contract-config.json',
      ).then((r) => r.json());
      const circuitLock = await fetch(
        '/node_modules/stellar-private-payments/dist/circuits/circuits.json',
      ).then((r) => r.json());
      const circuitsBaseUrl = new URL(
        '/node_modules/stellar-private-payments/dist/circuits/',
        location.origin,
      ).href;
      const proverWorkerUrl = new URL(
        '/node_modules/stellar-private-payments/dist/workers/prover-worker.js',
        location.origin,
      ).href;

      const rpcUrl = `${location.origin}/rpc`;
      client = await withTimeout(
        sppFacade.Client.new({
          rpcUrl,
          storage,
          contractConfig,
          circuitsBaseUrl,
          circuitLock,
          proverWorkerUrl,
        }),
        20000,
        'Client.new',
      );

      const mockLog = await fetch('/mock-rpc-log').then((r) => r.json());
      report.stages.clientNew = {
        status: 'INICIALIZADO',
        rpcUrl,
        mockLogSynthetic: true,
        rpcMethodsObserved: (mockLog.log || []).map((e) => ({
          method: e.method,
          outcome: e.outcome,
          synthetic: e.synthetic,
        })),
        note: 'backgroundSync NOT called',
      };
    } catch (e) {
      let mockLog = { log: [] };
      try {
        mockLog = await fetch('/mock-rpc-log').then((r) => r.json());
      } catch {
        /* ignore */
      }
      report.stages.clientNew = {
        status: 'BLOQUEADO',
        error: e instanceof Error ? e.message : String(e),
        rpcMethodsObserved: (mockLog.log || []).map((e) => ({
          method: e.method,
          outcome: e.outcome,
          synthetic: e.synthetic,
        })),
      };
      client = null;
    }
  }
  paint();

  // --- Stage C optional: account + derivePrivacyKeys ---
  report.stages.account = { status: 'BLOQUEADO', reason: 'not attempted' };
  report.stages.derivePrivacyKeys = { status: 'BLOQUEADO', reason: 'not attempted' };
  report.stages.signerCapture = {
    status: 'BLOQUEADO',
    observedFromWasm: false,
    reason: 'pending',
  };

  if (report.stages.clientNew?.status === 'INICIALIZADO' && client && sppFacade) {
    const beforeCount = signerCalls.length;
    const recorder = createRecordingSigner('sdk-account-session');
    try {
      const account = await withTimeout(
        client.account({ networkPassphrase: NETWORK_PASSPHRASE, userAddress: SYNTHETIC_G }, recorder),
        15000,
        'client.account',
      );
      report.stages.account = { status: 'INICIALIZADO', userAddress: SYNTHETIC_G };

      try {
        await withTimeout(account.derivePrivacyKeys(), 15000, 'derivePrivacyKeys');
        report.stages.derivePrivacyKeys = {
          status: 'PARCIAL',
          note: 'returned without expected signer reject — unexpected',
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const sdkCalls = signerCalls.filter((c) => c.source === 'sdk-account-session');
        const observedSign = sdkCalls.some((c) => c.method === 'signMessage');
        report.stages.derivePrivacyKeys = {
          status: observedSign ? 'OBSERVADO_PATH' : 'BLOQUEADO',
          error: msg,
          signerMethods: sdkCalls.map((c) => c.method),
        };
        if (
          observedSign &&
          report.network.blocked.length === 0 &&
          report.network.externalSent.length === 0
        ) {
          report.stages.signerCapture = {
            status: 'OBSERVADO',
            observedFromWasm: true,
            originatingOperation: 'derivePrivacyKeys',
            calls: sdkCalls,
            abortedBeforeValidSignature: msg.includes(HARNESS_REJECT) || sdkCalls.length > 0,
          };
          report.signerCallsFromSdk = sdkCalls;
        } else {
          report.stages.signerCapture = {
            status: 'BLOQUEADO',
            observedFromWasm: false,
            reason: observedSign
              ? 'network isolation failed'
              : 'derivePrivacyKeys failed before WalletSigner sign*',
            error: msg,
          };
        }
      }

      if (typeof account.free === 'function') account.free();
    } catch (e) {
      report.stages.account = {
        status: 'BLOQUEADO',
        error: e instanceof Error ? e.message : String(e),
        signerCallsDuringAttempt: signerCalls.slice(beforeCount),
      };
      report.stages.signerCapture = {
        status: 'BLOQUEADO',
        observedFromWasm: false,
        reason: 'account() did not complete',
      };
    }
  } else {
    report.stages.signerCapture = {
      status: 'BLOQUEADO',
      observedFromWasm: false,
      reason: 'Client.new not initialized',
    };
  }

  report.stages.registerPublicKeys = { status: 'BLOQUEADO', reason: 'write path not in scope' };
  report.stages.deposit = { status: 'BLOQUEADO', reason: 'write path not in scope' };
  report.stages.transfer = { status: 'BLOQUEADO', reason: 'write path not in scope' };
  report.stages.withdraw = { status: 'BLOQUEADO', reason: 'write path not in scope' };
  report.stages.backgroundSync = { status: 'BLOQUEADO', reason: 'not invoked (Fase 2.7)' };
  report.stages.sendTransaction = { status: 'BLOQUEADO', reason: 'mock always rejects; not invoked by harness' };

  // --- Stage D (Fase 2.7): readTokenDecimals — read-only RPC probe ---
  report.stages.readTokenDecimals = { status: 'BLOQUEADO', reason: 'not attempted' };
  if (
    report.stages.wasm?.status === 'INICIALIZADO' &&
    report.network.blocked.length === 0 &&
    wasmMod &&
    typeof wasmMod.readTokenDecimals === 'function'
  ) {
    try {
      await fetch('/mock-rpc-log/clear', { method: 'POST' });
      const contractConfig = await fetch(
        '/tests/stellar/spp/harness/browser/synthetic-contract-config.json',
      ).then((r) => r.json());
      const tokenContract = contractConfig?.pools?.[0]?.tokenContractId;
      const rpcUrl = `${location.origin}/rpc`;
      let decimalsError = null;
      let decimalsValue = null;
      try {
        decimalsValue = await withTimeout(
          wasmMod.readTokenDecimals(rpcUrl, tokenContract),
          15000,
          'readTokenDecimals',
        );
      } catch (e) {
        decimalsError = e instanceof Error ? e.message : String(e);
      }
      const mockLog = await fetch('/mock-rpc-log').then((r) => r.json());
      const rpcEntries = (mockLog.log || []).map((e) => ({
        method: e.method,
        outcome: e.outcome,
        synthetic: e.synthetic,
      }));
      const methods = rpcEntries.map((e) => e.method);
      const onlySimulate =
        methods.length > 0 && methods.every((m) => m === 'simulateTransaction');
      const rejectedUnmodeled = rpcEntries.some(
        (e) => e.method === 'simulateTransaction' && e.outcome === 'reject_unmodeled',
      );
      report.stages.readTokenDecimals = {
        status: onlySimulate && rejectedUnmodeled ? 'OBSERVADO_PATH' : 'PARCIAL',
        callPath:
          'wasm.readTokenDecimals(rpcUrl, tokenContract) → RpcClient::get_token_decimals → read_contract → simulate_transaction',
        rpcUrlSameOrigin: rpcUrl === `${location.origin}/rpc`,
        tokenContractIdPrefix: typeof tokenContract === 'string' ? tokenContract.slice(0, 8) : null,
        decimalsValue,
        error: decimalsError,
        rpcMethodsObserved: rpcEntries,
        onlySimulateTransaction: onlySimulate,
        simulateRejectedByMock: rejectedUnmodeled,
        wasmAcceptedSimulateSuccessBody: false,
        note:
          'Mock does not serve simulateTransaction success (schema known from rpc.rs but harness keeps method fail-closed). No write ops.',
      };
    } catch (e) {
      report.stages.readTokenDecimals = {
        status: 'BLOQUEADO',
        error: e instanceof Error ? e.message : String(e),
      };
    }
    paint();
  } else {
    report.stages.readTokenDecimals = {
      status: 'BLOQUEADO',
      reason: 'WASM not ready or network isolation failed — probe not invoked',
      blocked: report.network.blocked.slice(),
    };
  }

  // --- Stage E (Fase 2.12): allContractsData → getLedgerEntries (source-safe) ---
  report.stages.aspState = {
    status: 'OBSERVADO',
    note: 'Proven in Fase 2.9 (aspMinimal); not re-probed in 2.12 — see FASE-2.9 report',
  };
  report.stages.allContractsData = { status: 'BLOQUEADO', reason: 'not attempted' };
  report.stages.getLatestLedgerPath = {
    status: 'BLOQUEADO',
    reason:
      'No WASM export reaches getLatestLedger without Indexer::fetch_contract_events (sync/catch_up/backgroundSync) — not invoked',
  };
  const POOL_ID = 'CACQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQLC2U';
  const TOKEN_ID = 'CADAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMSST';
  if (
    report.stages.clientNew?.status === 'INICIALIZADO' &&
    client &&
    typeof client.allContractsData === 'function' &&
    report.network.blocked.length === 0
  ) {
    try {
      await fetch('/mock-rpc-log/clear', { method: 'POST' });
      let callError = null;
      let callOk = false;
      let parsed = null;
      try {
        const data = await withTimeout(client.allContractsData(), 20000, 'allContractsData');
        callOk = true;
        const big = (v) => (typeof v === 'bigint' ? v.toString() : v);
        const pools = [];
        if (data?.pools) {
          const len = typeof data.pools.length === 'number' ? data.pools.length : 0;
          for (let i = 0; i < len; i++) {
            const p = data.pools[i];
            pools.push({
              contractId: p?.contractId,
              admin: p?.admin,
              token: p?.token,
              verifier: p?.verifier,
              aspMembership: p?.aspMembership,
              aspNonMembership: p?.aspNonMembership,
              merkleLevels: p?.merkleLevels,
              merkleNextIndex: p?.merkleNextIndex,
              merkleRoot: p?.merkleRoot,
              maximumDepositAmount: p?.maximumDepositAmount != null ? String(p.maximumDepositAmount) : null,
              depositsPaused: p?.depositsPaused,
              ledger: p?.ledger,
              capacity: big(p?.merkleCapacity ?? p?.capacity),
            });
          }
        }
        parsed = {
          poolCount: pools.length,
          pools,
          aspMembership: data?.aspMembership
            ? {
                contractId: data.aspMembership.contractId,
                admin: data.aspMembership.admin,
                nextIndex: data.aspMembership.nextIndex,
                levels: data.aspMembership.levels,
                root: data.aspMembership.root,
                capacity: big(data.aspMembership.capacity),
                ledger: data.aspMembership.ledger,
              }
            : null,
          aspNonMembership: data?.aspNonMembership
            ? {
                contractId: data.aspNonMembership.contractId,
                admin: data.aspNonMembership.admin,
                root: data.aspNonMembership.root,
                isEmpty: data.aspNonMembership.isEmpty,
                ledger: data.aspNonMembership.ledger,
              }
            : null,
        };
        if (typeof data?.free === 'function') data.free();
      } catch (e) {
        callError = e instanceof Error ? e.message : String(e);
      }
      const mockLog = await fetch('/mock-rpc-log').then((r) => r.json());
      const rpcEntries = (mockLog.log || []).map((e) => ({
        method: e.method,
        outcome: e.outcome,
        synthetic: e.synthetic,
      }));
      const methods = rpcEntries.map((e) => e.method);
      const sawLedgerEntries = methods.includes('getLedgerEntries');
      const sawForbidden = methods.some((m) =>
        ['sendTransaction', 'simulateTransaction', 'getEvents', 'getLatestLedger'].includes(m),
      );
      const ledgerSuccess = rpcEntries.some(
        (e) =>
          e.method === 'getLedgerEntries' &&
          String(e.outcome) === 'synthetic_getLedgerEntries_allContractsMinimal',
      );
      const deserAccepted =
        ledgerSuccess &&
        (callOk ||
          (typeof callError === 'string' &&
            !/jsonrpc error|method not modeled|serde|json decoding/i.test(callError)));
      const pool0 = parsed?.pools?.[0];
      const poolDecodeObserved =
        callOk &&
        pool0?.contractId === POOL_ID &&
        pool0?.admin === SYNTHETIC_G &&
        pool0?.token === TOKEN_ID &&
        pool0?.merkleLevels === 1 &&
        pool0?.merkleNextIndex === '0';
      const aspDecodeObserved =
        callOk &&
        parsed?.aspMembership?.admin === SYNTHETIC_G &&
        parsed?.aspMembership?.nextIndex != null &&
        parsed?.aspMembership?.levels === 1;
      const entryDecodeObserved = poolDecodeObserved && aspDecodeObserved;
      report.stages.allContractsData = {
        status: entryDecodeObserved
          ? 'OBSERVADO'
          : sawLedgerEntries && !sawForbidden
            ? 'OBSERVADO_PATH'
            : 'PARCIAL',
        callPath:
          'Client.allContractsData → StateFetcher::all_contracts_data → get_contract_data_bulk → get_ledger_entries',
        safetyGate:
          'Source audit (b79107cd): no ensure_synced, simulate, send, register, pool write, prover, or backgroundSync on this path',
        rpcMethodsObserved: rpcEntries,
        invokedGetLedgerEntries: sawLedgerEntries,
        invokedGetLatestLedger: methods.includes('getLatestLedger'),
        invokedForbiddenRpc: sawForbidden,
        mockServedSyntheticLedgerEntries: ledgerSuccess,
        wasmAcceptedGetLedgerEntriesSuccessBody: deserAccepted,
        poolEntryDecodeObserved: poolDecodeObserved,
        aspEntryDecodeObserved: aspDecodeObserved,
        contractEntryDecodeObserved: entryDecodeObserved,
        callCompletedOk: callOk,
        parsedSynthetic: parsed,
        error: callError,
        note: 'Values are SYNTHETIC (Fase 2.12 allContractsMinimal fixture). Not a real pool/Testnet deployment.',
      };
    } catch (e) {
      report.stages.allContractsData = {
        status: 'BLOQUEADO',
        error: e instanceof Error ? e.message : String(e),
      };
    }
    paint();
  } else {
    report.stages.allContractsData = {
      status: 'BLOQUEADO',
      reason: 'Client.new not ready or network isolation failed — probe not invoked',
    };
  }

  // Synthetic-only probe (does NOT count as OBSERVED).
  const synthRecorder = createRecordingSigner('synthetic-direct');
  let syntheticOk = false;
  const synthBefore = signerCalls.length;
  try {
    await synthRecorder.signMessage('synthetic-harness-probe');
  } catch (e) {
    syntheticOk =
      e instanceof Error &&
      e.message === HARNESS_REJECT &&
      signerCalls.length === synthBefore + 1;
  }
  report.syntheticSignerProbe = {
    status: 'SINTÉTICO',
    rejectedAsExpected: syntheticOk,
    calls: signerCalls.filter((c) => c.source === 'synthetic-direct'),
  };

  // Cleanup client/storage
  try {
    if (client && typeof client.dispose === 'function') client.dispose();
  } catch {
    /* ignore */
  }
  try {
    if (storage && typeof storage.free === 'function') storage.free();
  } catch {
    /* ignore */
  }

  let finalMockLog = { log: [] };
  try {
    finalMockLog = await fetch('/mock-rpc-log').then((r) => r.json());
  } catch {
    /* ignore */
  }
  report.rpcMock.finalLog = finalMockLog.log || [];

  report.networkSummary = {
    blockedExternal: report.network.blocked.slice(),
    allowedSameOriginCount: report.network.allowed.length,
    externalSentCount: report.network.externalSent.length,
  };
  report.network.restore();
  delete report.network.restore;

  report.finishedAt = new Date().toISOString();
  report.ok =
    report.stages.wasm?.status === 'INICIALIZADO' &&
    report.networkSummary.externalSentCount === 0 &&
    report.networkSummary.blockedExternal.length === 0;

  statusEl.textContent = report.ok
    ? `Harness 2.12 finished. allContractsData=${report.stages.allContractsData?.status}; readTokenDecimals=${report.stages.readTokenDecimals?.status}`
    : 'Harness finished with failures — see report.';
  statusEl.className = report.ok ? 'ok' : 'bad';
  paint();
}

run().catch((e) => {
  const report = {
    fatal: e instanceof Error ? e.message : String(e),
    stack: e instanceof Error ? e.stack : undefined,
  };
  window.__SPP_HARNESS_RESULT__ = report;
  const statusEl = document.getElementById('status');
  const reportEl = document.getElementById('report');
  if (statusEl) {
    statusEl.textContent = 'Fatal error';
    statusEl.className = 'bad';
  }
  if (reportEl) reportEl.textContent = JSON.stringify(report, null, 2);
});
