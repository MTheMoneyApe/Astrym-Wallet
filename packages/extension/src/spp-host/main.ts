/**
 * Solanym SPP isolated host page entry (Fase 4B–5D).
 * Extension page only — not the service worker, popup React tree, or dapp provider.
 *
 * Actions (button only, never on load):
 * 1) Comprobar SDK — import packaged facade + inspect exports
 * 2) Inicializar WASM — default({ module_or_path: local .wasm URL })
 * 3) Storage lab prep — evaluate gates
 * 4) Storage open — only when phase-authorized + ready-for-lab + explicit click
 * 5) Storage free — explicit only when a private handle exists
 *
 * Default build: STORAGE_LAB_EXECUTION_AUTHORIZED=false → run button stays disabled.
 */

import {
  SPP_SESSION_STATUS_STORAGE_KEY,
  toStoredSppSessionClear,
  toStoredSppSessionStatus,
  type SppSessionStatusHandle,
} from '@solanym/wallet-core/src/stellar/spp/SppIntegrationStatus.js';
import { SppHostController } from './hostController.js';
import type { SppHostSnapshot } from './hostController.js';
import { SPP_PACKAGE_PATHS } from './paths.js';
import { readHostLabSppIntegrationSnapshot } from './sppIntegrationProbe.js';
import { STORAGE_LAB_EXECUTION_AUTHORIZED } from './storageLabPrep.js';

function getExtensionURL(path: string): string {
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    return chrome.runtime.getURL(path);
  }
  throw new Error('chrome.runtime.getURL is unavailable — open this page as an extension page');
}

/** Mirror bound session (or clear) for popup Settings — no session init. */
function publishBoundSessionToExtensionStorage(
  session: SppSessionStatusHandle | null,
  meta: { generation: number },
): void {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  if (session == null) {
    void chrome.storage.local.set({
      [SPP_SESSION_STATUS_STORAGE_KEY]: toStoredSppSessionClear(meta),
    });
    return;
  }
  const stored = toStoredSppSessionStatus(session, meta);
  if (stored == null) {
    void chrome.storage.local.set({
      [SPP_SESSION_STATUS_STORAGE_KEY]: toStoredSppSessionClear(meta),
    });
    return;
  }
  void chrome.storage.local.set({ [SPP_SESSION_STATUS_STORAGE_KEY]: stored });
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}

function render(snapshot: SppHostSnapshot, extras?: { resolvedFacadeHint?: string }): void {
  const phaseEl = el<HTMLElement>('spp-phase');
  const wasmPhaseEl = el<HTMLElement>('spp-wasm-phase');
  const sessionStateEl = el<HTMLElement>('spp-session-state');
  const sessionGenEl = el<HTMLElement>('spp-session-gen');
  const storagePhaseEl = el<HTMLElement>('spp-storage-lab-phase');
  const detailEl = el<HTMLElement>('spp-detail');
  const errorEl = el<HTMLElement>('spp-error');
  const probeBtn = el<HTMLButtonElement>('spp-probe-btn');
  const wasmBtn = el<HTMLButtonElement>('spp-wasm-btn');
  const sessionConstructBtn = el<HTMLButtonElement>('spp-session-construct-btn');
  const sessionInitBtn = el<HTMLButtonElement>('spp-session-init-btn');
  const sessionClearBtn = el<HTMLButtonElement>('spp-session-clear-btn');
  const storageEvalBtn = el<HTMLButtonElement>('spp-storage-eval-btn');
  const storageRunBtn = el<HTMLButtonElement>('spp-storage-run-btn');
  const storageFreeBtn = el<HTMLButtonElement>('spp-storage-free-btn');

  phaseEl.textContent = snapshot.phase;
  phaseEl.dataset['phase'] = snapshot.phase;
  wasmPhaseEl.textContent = snapshot.wasmPhase;
  wasmPhaseEl.dataset['phase'] = snapshot.wasmPhase;
  sessionStateEl.textContent = snapshot.sessionState ?? 'none';
  sessionStateEl.dataset['state'] = snapshot.sessionState ?? 'none';
  sessionGenEl.textContent = snapshot.sessionStatusGeneration
    ? `(gen ${snapshot.sessionStatusGeneration})`
    : '';
  storagePhaseEl.textContent = snapshot.storageLabPhase;
  storagePhaseEl.dataset['phase'] = snapshot.storageLabPhase;

  const busy =
    snapshot.phase === 'loading' ||
    snapshot.wasmPhase === 'initializing' ||
    snapshot.storageLabPhase === 'running';
  probeBtn.disabled = busy;
  wasmBtn.disabled = busy || snapshot.phase !== 'ready';
  sessionConstructBtn.disabled = busy || snapshot.phase !== 'ready' || snapshot.sessionBound;
  sessionInitBtn.disabled =
    busy || snapshot.sessionState !== 'uninitialized' || snapshot.sessionInitializeEnabled;
  sessionClearBtn.disabled = busy || !snapshot.sessionBound;
  storageEvalBtn.disabled = busy;
  storageRunBtn.disabled = busy || !snapshot.storageLabRunEnabled;
  storageFreeBtn.disabled = busy || !snapshot.storageLabFreeEnabled;

  if (!snapshot.storageLabExecutionAuthorized) {
    storageRunBtn.title =
      'Blocked: STORAGE_LAB_EXECUTION_AUTHORIZED is false (review Fase 5D diff before flipping).';
  } else if (!snapshot.storageLabRunEnabled) {
    storageRunBtn.title =
      'Blocked: need ready-for-lab (all gates) and unused single-open slot on this host instance.';
  } else {
    storageRunBtn.title = 'Authorized lab open — one Storage.open with packaged storage worker URL.';
  }

  const evidence = snapshot.storageLabEvidence;
  const lines: string[] = [
    `facadePhase=${snapshot.phase}`,
    `wasmPhase=${snapshot.wasmPhase}`,
    `wasmInitialized=${snapshot.wasmInitialized}`,
    `storageLabPhase=${snapshot.storageLabPhase}`,
    `executionAuthorized=${snapshot.storageLabExecutionAuthorized}`,
    `storageLabRunEnabled=${snapshot.storageLabRunEnabled}`,
    `storageLabFreeEnabled=${snapshot.storageLabFreeEnabled}`,
    `sdkInitialized=${snapshot.sdkInitialized}`,
    `sessionInitializeEnabled=${snapshot.sessionInitializeEnabled}`,
    `sessionBound=${snapshot.sessionBound}`,
    `sessionState=${snapshot.sessionState ?? 'none'}`,
    `sessionStatusGeneration=${snapshot.sessionStatusGeneration}`,
    `sessionConstructError=${snapshot.sessionConstructError ?? '—'}`,
    `metaVersion=${snapshot.metaVersion ?? '—'}`,
    `importedModuleUrl=${snapshot.importedModuleUrl ?? '—'}`,
    `wasmUrlUsed=${snapshot.wasmUrlUsed ?? '—'}`,
  ];

  if (extras?.resolvedFacadeHint) {
    lines.push(`resolvedFacadeHint=${extras.resolvedFacadeHint}`);
  }

  if (snapshot.assets) {
    lines.push('assets:');
    lines.push(`  facade=${snapshot.assets.facadeModuleUrl}`);
    lines.push(`  wasm=${snapshot.assets.wasmUrl}`);
    lines.push(`  storageWorker=${snapshot.assets.storageWorkerUrl}`);
    lines.push(`  proverWorker=${snapshot.assets.proverWorkerUrl}`);
    lines.push(`  circuitsBase=${snapshot.assets.circuitsBaseUrl}`);
  }

  if (snapshot.inspection) {
    const i = snapshot.inspection;
    lines.push('facade inspection:');
    lines.push(`  default(init)=${i.hasDefaultInit}`);
    lines.push(`  Client.new=${i.hasClientNew}`);
    lines.push(`  Storage.open=${i.hasStorageOpen}`);
    lines.push(`  exports=${i.exportKeys.join(',')}`);
    for (const note of i.notes) {
      lines.push(`  note: ${note}`);
    }
  }

  lines.push('storage lab evidence:');
  lines.push(`  phase=${evidence.phase}`);
  lines.push(`  storageLabPhase=${evidence.storageLabPhase}`);
  lines.push(`  storageOpenAttempted=${String(evidence.storageOpenAttempted)}`);
  lines.push(`  storageOpenInvocationCount=${evidence.storageOpenInvocationCount}`);
  lines.push(`  storageOpenResolved=${String(evidence.storageOpenResolved)}`);
  lines.push(`  storageOpenRejected=${String(evidence.storageOpenRejected)}`);
  lines.push(`  storageOpenDurationMs=${String(evidence.storageOpenDurationMs)}`);
  lines.push(`  storageHandleObtained=${String(evidence.storageHandleObtained)}`);
  lines.push(`  storageFreeAttempted=${String(evidence.storageFreeAttempted)}`);
  lines.push(`  storageFreeSucceeded=${String(evidence.storageFreeSucceeded)}`);
  lines.push(`  workerLoadErrorSuspected=${String(evidence.workerLoadErrorSuspected)}`);
  lines.push(`  externalNetworkObserved=${String(evidence.externalNetworkObserved)}`);
  lines.push(`  opfsRootAccessible=${String(evidence.opfsRootAccessible)}`);
  lines.push(`  opfsEntryNameHints=${JSON.stringify(evidence.opfsEntryNameHints)}`);
  lines.push(`  workerProcessObserved=${String(evidence.workerProcessObserved)}`);
  lines.push(`  opfsContentRead=${String(evidence.opfsContentRead)}`);
  lines.push(`  opfsWipedAfterFree=${String(evidence.opfsWipedAfterFree)}`);
  lines.push(`  openLimitScope=${evidence.storageOpenLimitScope}`);
  lines.push(`  profileScopedOpenLimitImplemented=${evidence.profileScopedOpenLimitImplemented}`);
  lines.push(`  openCancellationSupported=${evidence.storageOpenCancellationSupported}`);
  lines.push(`  openWatchdogMs=${evidence.storageOpenWatchdogMs}`);
  lines.push(
    `  watchdogFiredWhilePending=${String(evidence.storageOpenWatchdogFiredWhilePending)}`,
  );
  lines.push(`  openExceededWatchdog=${String(evidence.storageOpenExceededWatchdog)}`);
  for (const reason of evidence.blockReasons) {
    lines.push(`  block: ${reason}`);
  }
  for (const note of evidence.notes) {
    lines.push(`  note: ${note}`);
  }

  lines.push('');
  lines.push(
    'Fase 5D.2: max one Storage open per controller instance when phase-authorized. Reload = new slot.',
  );
  lines.push(
    `Compile-time phase gate STORAGE_LAB_EXECUTION_AUTHORIZED=${String(STORAGE_LAB_EXECUTION_AUTHORIZED)}.`,
  );
  lines.push(
    'fetch-wrap false ≠ zero network. free() ≠ worker terminate / OPFS wipe. No open cancellation.',
  );

  detailEl.textContent = lines.join('\n');

  const combinedError = [
    snapshot.errorMessage,
    snapshot.wasmErrorMessage,
    snapshot.sessionConstructError,
    snapshot.storageLabErrorMessage,
  ]
    .filter(Boolean)
    .join('\n');
  errorEl.textContent = combinedError;
  errorEl.hidden = !combinedError;
}

function main(): void {
  const statusBoot = el<HTMLElement>('spp-boot');
  const probeBtn = el<HTMLButtonElement>('spp-probe-btn');
  const wasmBtn = el<HTMLButtonElement>('spp-wasm-btn');
  const storageEvalBtn = el<HTMLButtonElement>('spp-storage-eval-btn');
  const storageRunBtn = el<HTMLButtonElement>('spp-storage-run-btn');
  const storageFreeBtn = el<HTMLButtonElement>('spp-storage-free-btn');
  const gateProfile = el<HTMLInputElement>('spp-gate-lab-profile');
  const gateOpfs = el<HTMLInputElement>('spp-gate-opfs-risk');
  const gateDiff = el<HTMLInputElement>('spp-gate-phase-diff');

  const controller = new SppHostController({
    getURL: getExtensionURL,
    onBoundSessionChange: publishBoundSessionToExtensionStorage,
  });

  let facadeHint = '';
  try {
    facadeHint = getExtensionURL(SPP_PACKAGE_PATHS.facadeJs);
  } catch (err) {
    facadeHint = err instanceof Error ? err.message : String(err);
  }

  statusBoot.textContent =
    'Idle — Nothing runs on load. Open limit = one per page instance (reload resets). Auth gate false by default.';
  render(controller.snapshot(), { resolvedFacadeHint: facadeHint });

  (window as unknown as { __SOLANYM_SPP_HOST__?: unknown }).__SOLANYM_SPP_HOST__ = {
    snapshot: () => controller.snapshot(),
    /**
     * Integration status for diagnostics. Sync read of in-memory host fields only.
     * Does not create SppSession; popup Settings cannot see this without IPC.
     */
    integrationSnapshot: () =>
      readHostLabSppIntegrationSnapshot(
        () => {
          const s = controller.snapshot();
          return {
            phase: s.phase,
            wasmPhase: s.wasmPhase,
            wasmInitialized: s.wasmInitialized,
            sdkInitialized: s.sdkInitialized,
            sessionInitializeEnabled: s.sessionInitializeEnabled,
            sessionBound: s.sessionBound,
            sessionState: s.sessionState,
          };
        },
        { getSession: () => controller.readBoundSessionStatus() },
      ),
    initializeSessionDisabled: true,
    storageOpenDisabled: !STORAGE_LAB_EXECUTION_AUTHORIZED,
    probeOnlyOnButton: true,
    wasmInitOnlyOnButton: true,
    storageLabPrepOnly: true,
  };

  probeBtn.addEventListener('click', () => {
    void (async () => {
      statusBoot.textContent = 'Importing packaged SPP facade…';
      render(controller.snapshot(), { resolvedFacadeHint: facadeHint });
      const snapshot = await controller.probe();
      render(snapshot, { resolvedFacadeHint: facadeHint });
      if (snapshot.phase === 'ready') {
        statusBoot.textContent =
          'Probe OK — next: Inicializar WASM. Storage lab stays blocked (not auto ready-for-lab).';
      } else if (snapshot.phase === 'error') {
        statusBoot.textContent = 'Probe failed — see technical error below.';
      }
    })();
  });

  wasmBtn.addEventListener('click', () => {
    void (async () => {
      statusBoot.textContent = 'Initializing packaged WASM…';
      render(controller.snapshot(), { resolvedFacadeHint: facadeHint });
      const snapshot = await controller.initializeWasm();
      render(snapshot, { resolvedFacadeHint: facadeHint });
      if (snapshot.wasmPhase === 'ready') {
        statusBoot.textContent =
          'WASM init OK — evaluate Storage gates next (open still requires phase auth).';
      } else if (snapshot.wasmPhase === 'error') {
        statusBoot.textContent = 'WASM init failed — see technical error below.';
      }
    })();
  });

  const sessionConstructBtn = el<HTMLButtonElement>('spp-session-construct-btn');
  const sessionInitBtn = el<HTMLButtonElement>('spp-session-init-btn');
  const sessionClearBtn = el<HTMLButtonElement>('spp-session-clear-btn');
  const sessionRpcInput = el<HTMLInputElement>('spp-session-rpc');
  const sessionContractsInput = el<HTMLTextAreaElement>('spp-session-contracts');
  const sessionCircuitsInput = el<HTMLTextAreaElement>('spp-session-circuits');

  sessionConstructBtn.addEventListener('click', () => {
    try {
      let contractConfig: unknown;
      let circuitLock: unknown;
      try {
        contractConfig = JSON.parse(sessionContractsInput.value || 'null');
      } catch {
        throw new Error('contractConfig JSON is invalid');
      }
      try {
        circuitLock = JSON.parse(sessionCircuitsInput.value || 'null');
      } catch {
        throw new Error('circuitLock JSON is invalid');
      }
      statusBoot.textContent = 'Constructing uninitialized SppSession…';
      const snapshot = controller.constructAndAttachUninitializedSession({
        rpcUrl: sessionRpcInput.value,
        contractConfig,
        circuitLock,
      });
      render(snapshot, { resolvedFacadeHint: facadeHint });
      statusBoot.textContent =
        snapshot.sessionState === 'uninitialized'
          ? 'Session constructed and bound (uninitialized) — initialize() not called.'
          : `Session bound in state ${String(snapshot.sessionState)} — initialize() not called.`;
    } catch (err) {
      statusBoot.textContent =
        err instanceof Error ? `Session construct failed: ${err.message}` : 'Session construct failed';
      render(controller.snapshot(), { resolvedFacadeHint: facadeHint });
    }
  });

  sessionInitBtn.addEventListener('click', () => {
    void (async () => {
      const response = await chrome.runtime.sendMessage({
        id: crypto.randomUUID(),
        type: 'NYM_STATUS',
        payload: {},
      }) as { payload?: { connected?: boolean; mode?: string } } | undefined;
      const nymActive = response?.payload?.connected === true && response.payload.mode === 'nym';
      if (!nymActive) {
        statusBoot.textContent = 'Stellar Private Payments requiere Nym conectado.';
        return;
      }
      const snapshot = await controller.initializeBoundSessionForNym(true);
      render(snapshot, { resolvedFacadeHint: facadeHint });
      statusBoot.textContent = snapshot.sessionInitializeEnabled
        ? 'Sesión SPP inicializada con Nym.'
        : 'La sesión no quedó lista.';
    })().catch((err: unknown) => {
      statusBoot.textContent = err instanceof Error ? err.message : 'No se pudo inicializar SPP';
      render(controller.snapshot(), { resolvedFacadeHint: facadeHint });
    });
  });

  sessionClearBtn.addEventListener('click', () => {
    controller.clearBoundSession();
    statusBoot.textContent = 'Session reference cleared (dispose not called).';
    render(controller.snapshot(), { resolvedFacadeHint: facadeHint });
  });

  storageEvalBtn.addEventListener('click', () => {
    try {
      controller.setStorageLabGates({
        dedicatedLabProfileConfirmed: gateProfile.checked,
        opfsPersistenceRiskAccepted: gateOpfs.checked,
        phaseDiffReviewedAndAuthorized: gateDiff.checked,
      });
      const snapshot = controller.evaluateStorageLabPrep();
      render(snapshot, { resolvedFacadeHint: facadeHint });
      if (snapshot.storageLabPhase === 'ready-for-lab') {
        statusBoot.textContent = snapshot.storageLabRunEnabled
          ? 'ready-for-lab + phase auth — run button enabled for one explicit Storage open.'
          : 'ready-for-lab recorded — run still disabled (phase gate false or open already used).';
      } else {
        statusBoot.textContent = `Storage lab = ${snapshot.storageLabPhase} — see block reasons.`;
      }
    } catch {
      statusBoot.textContent = 'Storage lab evaluate failed — see error.';
      render(controller.snapshot(), { resolvedFacadeHint: facadeHint });
    }
  });

  storageRunBtn.addEventListener('click', () => {
    void (async () => {
      statusBoot.textContent = 'Storage lab run requested…';
      render(controller.snapshot(), { resolvedFacadeHint: facadeHint });
      const snapshot = await controller.requestStorageLabRun();
      render(snapshot, { resolvedFacadeHint: facadeHint });
      if (snapshot.storageLabPhase === 'success') {
        statusBoot.textContent =
          'Storage open resolved — handle kept private. Optional: free(). Do not open Client.';
      } else {
        statusBoot.textContent =
          'Storage run ended without success — see evidence/errors. No automatic retry.';
      }
    })();
  });

  storageFreeBtn.addEventListener('click', () => {
    void (async () => {
      statusBoot.textContent = 'Attempting Storage free()…';
      const snapshot = await controller.requestStorageLabFree();
      render(snapshot, { resolvedFacadeHint: facadeHint });
      statusBoot.textContent =
        'free() attempt finished — worker termination / OPFS wipe are NOT asserted (see evidence nulls).';
    })();
  });
}

try {
  main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  const phaseEl = document.getElementById('spp-phase');
  const errorEl = document.getElementById('spp-error');
  const bootEl = document.getElementById('spp-boot');
  if (phaseEl) {
    phaseEl.textContent = 'error';
    (phaseEl as HTMLElement).dataset['phase'] = 'error';
  }
  if (bootEl) bootEl.textContent = 'SPP host UI failed to start.';
  if (errorEl) {
    errorEl.hidden = false;
    errorEl.textContent = message.slice(0, 240);
  }
}
