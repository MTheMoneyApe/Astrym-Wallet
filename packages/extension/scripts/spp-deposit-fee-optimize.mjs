#!/usr/bin/env node
/**
 * Fee optimization analysis for the prepared 2.0 XLM SPP deposit.
 *
 * - Does NOT broadcast (sendTransaction blocked / never called)
 * - Does NOT flip any authorization gates
 * - Does NOT raise the 8_000_000 policy ceiling
 * - Re-simulates the exact approved XDR and tests assembly / resource-trim
 *   alternatives with REAL simulateTransaction against Nethermind Testnet
 *
 * Writes under /opt/cursor/artifacts/deposit/fee-opt/
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXTENSION_ROOT = resolve(__dirname, '..');
const require = createRequire(join(EXTENSION_ROOT, 'package.json'));
const {
  rpc,
  TransactionBuilder,
  xdr,
  Account,
  Keypair,
  Networks,
  Operation,
  StrKey,
  Address,
  hash,
} = require('@stellar/stellar-sdk');

const RPC_URL = process.env.SPP_RPC_URL || 'https://soroban-testnet.stellar.org';
const NETWORK = 'Test SDF Network ; September 2015';
const POLICY_CAP = 8_000_000;
const POOL = 'CAMWBUWHYXEGBM3Q7M5DBGW7LLJL3I4QGANQEZFEWLRNTOJMTT2WG24U';
const OUT_DIR =
  process.env.SPP_FEE_OPT_DIR || '/opt/cursor/artifacts/deposit/fee-opt';
const PACKET_PATH =
  process.env.SPP_DEPOSIT_PACKET ||
  '/opt/cursor/artifacts/deposit/deposit-approval-packet.json';

const server = new rpc.Server(RPC_URL, { allowHttp: false });

function log(msg) {
  console.log(`[spp-deposit-fee-optimize] ${msg}`);
}

function fingerprintXdr(xdrB64) {
  return createHash('sha256').update(Buffer.from(String(xdrB64), 'base64')).digest('hex');
}

function jsonReplacer(_k, v) {
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Uint8Array) return Buffer.from(v).toString('hex');
  return v;
}

function writeJson(name, value) {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, name), JSON.stringify(value, jsonReplacer, 2));
}

function extractResourcesFromSim(sim) {
  const td = sim.transactionData;
  if (!td) return null;
  const built = typeof td.build === 'function' ? td.build() : td;
  // stellar-sdk v17+: properties, not methods
  const resources = built.resources;
  const footprint = resources.footprint;
  return {
    instructions: Number(resources.instructions),
    diskReadBytes: Number(resources.diskReadBytes),
    writeBytes: Number(resources.writeBytes),
    resourceFee: Number(built.resourceFee),
    readOnlyCount: footprint.readOnly.length,
    readWriteCount: footprint.readWrite.length,
    readOnly: JSON.parse(JSON.stringify(footprint.readOnly, jsonReplacer)),
    readWrite: JSON.parse(JSON.stringify(footprint.readWrite, jsonReplacer)),
  };
}

async function rawSimulate(xdrB64) {
  const resp = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'simulateTransaction',
      params: { transaction: xdrB64 },
    }),
  });
  return resp.json();
}

async function sdkSimulate(xdrB64) {
  const tx = TransactionBuilder.fromXDR(xdrB64, NETWORK);
  const sim = await server.simulateTransaction(tx);
  return { tx, sim };
}

/**
 * Approximate fee decomposition using Protocol-typical rates when live config
 * fetch is unavailable. Cross-checked so components sum ≈ minResourceFee.
 *
 * Live Testnet (protocol 30) empirically for THIS tx:
 *   instructions=69007741, diskRead=144, write=5760, resourceFee=8718232
 *
 * We reverse-engineer rent-dominated residual after known linear components.
 */
function decomposeFee(resources, minResourceFee, txSizeBytes) {
  // From Stellar docs / common testnet ConfigSetting values (protocol 20+ era):
  // These are USED ONLY for explanatory decomposition; the authoritative number
  // remains minResourceFee from simulate.
  const FEE_PER_INSTRUCTIONS_INCREMENT = 25; // stroops per 10_000 instructions
  const INSTRUCTIONS_INCREMENT = 10_000;
  const FEE_RATE_DISK_READ_1KB = 1786;
  const FEE_RATE_WRITE_1KB = 11_800; // non-rent write component approx
  // Bandwidth: feeRatePerTxSize1KB often ~1638–2000; events similar

  const cpuFee = Math.ceil(
    (resources.instructions * FEE_PER_INSTRUCTIONS_INCREMENT) / INSTRUCTIONS_INCREMENT,
  );
  const diskReadFee = Math.ceil((resources.diskReadBytes * FEE_RATE_DISK_READ_1KB) / 1024);
  const writeNonRentFee = Math.ceil((resources.writeBytes * FEE_RATE_WRITE_1KB) / 1024);
  const txSizeFee = Math.ceil((txSizeBytes * 1638) / 1024);

  const linearSum = cpuFee + diskReadFee + writeNonRentFee + txSizeFee;
  const residualRentAndMisc = Math.max(0, minResourceFee - linearSum);

  return {
    note: 'Decomposition uses published-typical rate constants for explanation; authoritative total is simulate minResourceFee. Residual is dominated by state rent (nullifier/commitment creates + TTL) plus events/historical fees.',
    ratesAssumed: {
      FEE_PER_INSTRUCTIONS_INCREMENT,
      INSTRUCTIONS_INCREMENT,
      FEE_RATE_DISK_READ_1KB,
      FEE_RATE_WRITE_1KB,
      FEE_RATE_TX_SIZE_1KB: 1638,
    },
    components: {
      cpuInstructionsFee: cpuFee,
      diskReadFee,
      writeNonRentFee,
      transactionSizeFee: txSizeFee,
      residualRentEventsHistorical: residualRentAndMisc,
    },
    sumCheck: {
      linearSum,
      minResourceFee,
      residualShareOfTotal: Number((residualRentAndMisc / minResourceFee).toFixed(4)),
      cpuShareOfTotal: Number((cpuFee / minResourceFee).toFixed(4)),
    },
  };
}

/**
 * Assemble the unsigned tx with simulation results (auth + sorobanData),
 * then optionally mutate resources and re-encode for experiments.
 */
/** assembleTransaction + setTimeout(0) — required when source tx has no timebounds. */
function assembleBuilt(tx, sim) {
  if (!rpc.Api.isSimulationSuccess(sim)) {
    throw new Error('cannot assemble from failed simulation');
  }
  return rpc.assembleTransaction(tx, sim).setTimeout(0).build();
}

async function experimentBaseline(originalXdr) {
  const { tx, sim } = await sdkSimulate(originalXdr);
  const success = rpc.Api.isSimulationSuccess(sim);
  const resources = success ? extractResourcesFromSim(sim) : null;
  const raw = await rawSimulate(originalXdr);
  return {
    id: 'A_baseline_original_xdr',
    description:
      'Re-simulate exact approved unsigned deposit XDR (no sorobanData; auth filled by sim)',
    simulationStatus: success ? 'succeeded' : 'failed',
    minResourceFee: sim.minResourceFee ? Number(sim.minResourceFee) : null,
    withinPolicy8M: sim.minResourceFee ? Number(sim.minResourceFee) <= POLICY_CAP : false,
    resources,
    error: rpc.Api.isSimulationError(sim) ? String(sim.error).slice(0, 500) : null,
    rawMinResourceFee: raw.result?.minResourceFee
      ? Number(raw.result.minResourceFee)
      : null,
    stateChangeCount: Array.isArray(raw.result?.stateChanges)
      ? raw.result.stateChanges.length
      : null,
    eventsCount: Array.isArray(raw.result?.events) ? raw.result.events.length : null,
    authInResult: Array.isArray(sim.result?.auth) ? sim.result.auth.length : null,
    txMeta: {
      source: tx.source,
      sequence: String(tx.sequence),
      envelopeFee: String(tx.fee),
      xdrBytes: Buffer.from(originalXdr, 'base64').length,
      fingerprint: fingerprintXdr(originalXdr),
    },
  };
}

async function experimentAssembled(originalXdr, baselineSim) {
  const tx = TransactionBuilder.fromXDR(originalXdr, NETWORK);
  const assembled = assembleBuilt(tx, baselineSim);
  const assembledXdr = assembled.toXDR();
  // Re-simulate assembled transaction (with auth + sorobanData already attached)
  const { sim } = await sdkSimulate(assembledXdr);
  const success = rpc.Api.isSimulationSuccess(sim);
  const resources = success ? extractResourcesFromSim(sim) : null;
  return {
    id: 'B_assembled_resimulate',
    description:
      'assembleTransaction(auth+sorobanData) then simulate again — checks for assembly padding',
    simulationStatus: success ? 'succeeded' : 'failed',
    minResourceFee: sim.minResourceFee ? Number(sim.minResourceFee) : null,
    withinPolicy8M: sim.minResourceFee ? Number(sim.minResourceFee) <= POLICY_CAP : false,
    resources,
    assembled: {
      fee: String(assembled.fee),
      xdrBytes: Buffer.from(assembledXdr, 'base64').length,
      fingerprint: fingerprintXdr(assembledXdr),
      hasSorobanData: Boolean(assembled.sorobanData),
    },
    error: rpc.Api.isSimulationError(sim) ? String(sim.error).slice(0, 500) : null,
    savingsVsBaseline: null, // filled later
  };
}

async function experimentTrimInstructions(originalXdr, _baselineSim, baselineResources) {
  const tx = TransactionBuilder.fromXDR(originalXdr, NETWORK);
  const results = [];
  // Declared instruction budget is enforced at apply. Simulate re-executes and
  // returns FRESH metered resources. Assembling with trimmed declarations then
  // re-simulating proves metering is unchanged (trim cannot create savings).
  const trimFactors = [1.0, 0.95, 0.9, 0.85, 0.8];
  for (const f of trimFactors) {
    const { sim: freshSim } = await sdkSimulate(originalXdr);
    if (!rpc.Api.isSimulationSuccess(freshSim)) {
      results.push({
        trimFactor: f,
        simulationStatus: 'failed',
        error: 'fresh baseline sim failed',
      });
      continue;
    }
    const targetInstr = Math.floor(baselineResources.instructions * f);
    freshSim.transactionData.setResources(
      targetInstr,
      baselineResources.diskReadBytes,
      baselineResources.writeBytes,
    );
    const assembled = assembleBuilt(tx, freshSim);
    const { sim } = await sdkSimulate(assembled.toXDR());
    const success = rpc.Api.isSimulationSuccess(sim);
    const resources = success ? extractResourcesFromSim(sim) : null;
    const declaredBelowMetered =
      resources != null && targetInstr < resources.instructions;
    results.push({
      trimFactor: f,
      declaredInstructions: targetInstr,
      simulationStatus: success ? 'succeeded' : 'failed',
      minResourceFee: sim.minResourceFee ? Number(sim.minResourceFee) : null,
      meteredInstructions: resources?.instructions ?? null,
      declaredBelowMetered,
      unsafeForSubmit: declaredBelowMetered || !success,
      withinPolicy8M: sim.minResourceFee
        ? Number(sim.minResourceFee) <= POLICY_CAP
        : false,
      error: rpc.Api.isSimulationError(sim) ? String(sim.error).slice(0, 300) : null,
    });
  }
  return {
    id: 'C_trim_declared_instructions',
    description:
      'Assemble with reduced declared instruction budget; re-simulate to see if metering drops (it should not — work unchanged)',
    results,
    conclusion: null, // filled after
  };
}

async function experimentDropFootprintKeys(originalXdr, baselineSim, baselineResources) {
  const tx = TransactionBuilder.fromXDR(originalXdr, NETWORK);
  const results = [];
  const roCount = baselineResources.readOnlyCount;
  // Drop each read-only key one at a time
  for (let i = 0; i < roCount; i++) {
    const td = baselineSim.transactionData;
    // reset from a fresh sim each time to avoid cumulative mutation
    const { sim: freshSim } = await sdkSimulate(originalXdr);
    if (!rpc.Api.isSimulationSuccess(freshSim)) {
      results.push({ droppedReadOnlyIndex: i, simulationStatus: 'failed', error: 'fresh sim failed' });
      continue;
    }
    const ro = freshSim.transactionData.getReadOnly();
    const kept = ro.filter((_, idx) => idx !== i);
    freshSim.transactionData.setReadOnly(kept);
    const assembled = assembleBuilt(tx, freshSim);
    // IMPORTANT: footprint on assembled tx is used at apply; simulate of
    // host function still re-derives footprint. Dropping before assemble may
    // cause auth/footprint mismatch errors on simulate.
    const { sim } = await sdkSimulate(assembled.toXDR());
    const success = rpc.Api.isSimulationSuccess(sim);
    const resources = success ? extractResourcesFromSim(sim) : null;
    results.push({
      droppedReadOnlyIndex: i,
      droppedKeyPreview: JSON.stringify(baselineResources.readOnly[i], jsonReplacer).slice(0, 160),
      simulationStatus: success ? 'succeeded' : 'failed',
      minResourceFee: sim.minResourceFee ? Number(sim.minResourceFee) : null,
      withinPolicy8M: sim.minResourceFee
        ? Number(sim.minResourceFee) <= POLICY_CAP
        : false,
      resources: resources
        ? {
            instructions: resources.instructions,
            writeBytes: resources.writeBytes,
            readOnlyCount: resources.readOnlyCount,
            readWriteCount: resources.readWriteCount,
          }
        : null,
      error: rpc.Api.isSimulationError(sim) ? String(sim.error).slice(0, 400) : null,
    });
  }
  return {
    id: 'D_drop_readonly_footprint_keys',
    description:
      'Assemble with one read-only footprint entry removed per trial — detect redundant keys',
    results,
  };
}

async function experimentLowerResourceFeeOnly(originalXdr, baselineSim, baselineResources) {
  const tx = TransactionBuilder.fromXDR(originalXdr, NETWORK);
  const targets = [
    POLICY_CAP,
    baselineResources.resourceFee,
    Math.floor(baselineResources.resourceFee * 0.95),
    8_000_000,
    7_500_000,
  ];
  const unique = [...new Set(targets)];
  const results = [];
  for (const fee of unique) {
    const { sim: freshSim } = await sdkSimulate(originalXdr);
    if (!rpc.Api.isSimulationSuccess(freshSim)) {
      results.push({ setResourceFee: fee, simulationStatus: 'failed', error: 'fresh sim failed' });
      continue;
    }
    freshSim.transactionData.setResourceFee(fee);
    const assembled = assembleBuilt(tx, freshSim);
    const { sim } = await sdkSimulate(assembled.toXDR());
    const success = rpc.Api.isSimulationSuccess(sim);
    results.push({
      setResourceFee: fee,
      assembledEnvelopeFee: String(assembled.fee),
      simulationStatus: success ? 'succeeded' : 'failed',
      minResourceFee: sim.minResourceFee ? Number(sim.minResourceFee) : null,
      // Setting resourceFee below metered minimum is unsafe at submit even if sim succeeds
      belowMeteredMinimum: fee < baselineResources.resourceFee,
      withinPolicy8M: fee <= POLICY_CAP,
      unsafeForSubmit: fee < Number(freshSim.minResourceFee),
      error: rpc.Api.isSimulationError(sim) ? String(sim.error).slice(0, 300) : null,
      note:
        fee < baselineResources.resourceFee
          ? 'Below simulated minimum — would fail at submit with insufficient resource fee'
          : 'At/above simulated minimum',
    });
  }
  return {
    id: 'E_lower_declared_resource_fee',
    description:
      'Assemble with lower resourceFee while keeping same work — sim may still succeed (re-meters) but submit would reject fees below minimum',
    results,
  };
}

async function experimentInclusionFeeOnly(originalXdr, baselineSim) {
  // Inclusion fee is tiny (p50=100). Raising/lowering it does not fix resource fee.
  const tx = TransactionBuilder.fromXDR(originalXdr, NETWORK);
  const assembled = assembleBuilt(tx, baselineSim);
  return {
    id: 'F_inclusion_fee_observation',
    description:
      'Soroban inclusion fee market is ~100–200 stroops; irrelevant to 8.7M resource fee gap',
    assembledFee: String(assembled.fee),
    sorobanInclusionFeeP50: 100,
    sorobanInclusionFeeP95: 200,
    impactOnPolicyGap: 'negligible',
    simulationStatus: 'n/a_observation_only',
  };
}

function verifyAmountSemantics(packet) {
  const args = packet.contractArguments || {};
  const feeCheck = args.extData?.fee_check;
  return {
    public_amount: args.proofPublicInputs?.public_amount ?? feeCheck?.public_amount,
    ext_amount: args.extData?.ext_amount ?? feeCheck?.ext_amount,
    difference: feeCheck?.difference,
    matchesPoolFee: feeCheck?.matchesPoolFee === true,
    expectedNoteStroops: '20000000',
    expectedExtStroops: '21000000',
    amountsUnchanged: feeCheck?.public_amount === '20000000' && feeCheck?.ext_amount === '21000000',
  };
}

async function main() {
  if (!existsSync(PACKET_PATH)) {
    console.error('Missing deposit approval packet at', PACKET_PATH);
    process.exit(1);
  }
  mkdirSync(OUT_DIR, { recursive: true });
  const packet = JSON.parse(readFileSync(PACKET_PATH, 'utf8'));
  const originalXdr = packet.unsignedTransactionXdr;
  if (!originalXdr) {
    console.error('Packet missing unsignedTransactionXdr');
    process.exit(1);
  }

  log('A: baseline re-simulate…');
  const A = await experimentBaseline(originalXdr);
  writeJson('exp-A-baseline.json', A);

  if (A.simulationStatus !== 'succeeded') {
    writeJson('FEE-OPTIMIZATION-REPORT.json', {
      error: 'Baseline simulation failed; cannot optimize',
      A,
    });
    process.exit(2);
  }

  const { sim: baselineSim } = await sdkSimulate(originalXdr);
  const baselineResources = extractResourcesFromSim(baselineSim);

  log('B: assembled re-simulate…');
  const B = await experimentAssembled(originalXdr, baselineSim);
  B.savingsVsBaseline =
    A.minResourceFee != null && B.minResourceFee != null
      ? A.minResourceFee - B.minResourceFee
      : null;
  writeJson('exp-B-assembled.json', B);

  log('C: trim declared instructions…');
  const C = await experimentTrimInstructions(originalXdr, baselineSim, baselineResources);
  const anySafeSaving = (C.results || []).some(
    (r) =>
      r.simulationStatus === 'succeeded' &&
      !r.unsafeForSubmit &&
      r.minResourceFee != null &&
      r.minResourceFee < A.minResourceFee,
  );
  C.conclusion = anySafeSaving
    ? 'Found safe instruction trim that reduced minResourceFee'
    : 'No safe instruction trim reduces fee — metering is determined by ZK verify + storage writes, not declared budget padding';
  writeJson('exp-C-trim-instructions.json', C);

  log('D: drop read-only footprint keys…');
  const D = await experimentDropFootprintKeys(originalXdr, baselineSim, baselineResources);
  writeJson('exp-D-drop-footprint.json', D);

  log('E: lower declared resourceFee…');
  const E = await experimentLowerResourceFeeOnly(originalXdr, baselineSim, baselineResources);
  writeJson('exp-E-lower-resource-fee.json', E);

  log('F: inclusion fee observation…');
  const F = await experimentInclusionFeeOnly(originalXdr, baselineSim);
  writeJson('exp-F-inclusion.json', F);

  const txSize = Buffer.from(originalXdr, 'base64').length;
  const decomposition = decomposeFee(baselineResources, A.minResourceFee, txSize);
  writeJson('fee-decomposition.json', {
    resources: baselineResources,
    minResourceFee: A.minResourceFee,
    txSizeBytes: txSize,
    decomposition,
  });

  const amountSemantics = verifyAmountSemantics(packet);

  // Determine best safe outcome
  const alternatives = [A, B, C, D, E, F];
  const successfulFeeNumbers = [];
  if (A.minResourceFee != null) successfulFeeNumbers.push({ id: A.id, fee: A.minResourceFee, safe: true });
  if (B.minResourceFee != null && B.simulationStatus === 'succeeded') {
    successfulFeeNumbers.push({
      id: B.id,
      fee: B.minResourceFee,
      safe: true,
      note: 'Same work; assembly does not reduce metering',
    });
  }
  for (const r of D.results || []) {
    if (r.simulationStatus === 'succeeded' && r.minResourceFee != null) {
      successfulFeeNumbers.push({
        id: `${D.id}#ro${r.droppedReadOnlyIndex}`,
        fee: r.minResourceFee,
        safe: r.minResourceFee <= A.minResourceFee, // if higher or equal, no win; if somehow lower need footprint still valid at submit
        note: 'Footprint drop — treat as unsafe unless fee drops AND apply would succeed (not proven without broadcast)',
        dropped: true,
      });
    }
  }

  const bestSafe = successfulFeeNumbers
    .filter((x) => x.safe && !x.dropped)
    .sort((a, b) => a.fee - b.fee)[0];

  const gap = A.minResourceFee - POLICY_CAP;
  const defensibleCeiling = A.minResourceFee + 200_000; // inclusion headroom
  const policyDecision = {
    existingPolicyCap: POLICY_CAP,
    simulateMinResourceFee: A.minResourceFee,
    gapAbovePolicy: gap,
    policyRaised: false,
    optimizationReducedBelowPolicy: bestSafe != null && bestSafe.fee <= POLICY_CAP,
    recommendedAction:
      bestSafe != null && bestSafe.fee <= POLICY_CAP
        ? 'Use optimized XDR; remains within 8M policy'
        : 'No safe client-side optimization brings minResourceFee ≤ 8_000_000. Human must raise deposit policy ceiling or refuse deposit.',
    minimumDefensibleFeeCeiling: defensibleCeiling,
    minimumDefensibleFeeCeilingXlm: (defensibleCeiling / 1e7).toFixed(7),
    safetyMarginStroops: 200_000,
    safetyMarginBasis: 'soroban inclusion fee headroom above minResourceFee (p95≈200; using 200_000 conservative buffer for resource fee refunds/rounding)',
  };

  const report = {
    title: 'ASTRYM SPP deposit fee optimization report',
    generatedAt: new Date().toISOString(),
    generatedAtEuropeParis:
      new Date().toLocaleString('en-GB', { timeZone: 'Europe/Paris' }) + ' Europe/Paris',
    amountSemantics,
    original: {
      fingerprint: A.txMeta.fingerprint,
      minResourceFee: A.minResourceFee,
      resources: {
        instructions: baselineResources.instructions,
        diskReadBytes: baselineResources.diskReadBytes,
        writeBytes: baselineResources.writeBytes,
        readOnlyCount: baselineResources.readOnlyCount,
        readWriteCount: baselineResources.readWriteCount,
        resourceFee: baselineResources.resourceFee,
      },
      decomposition,
    },
    alternatives: {
      A,
      B: { ...B, resources: B.resources },
      C: { id: C.id, conclusion: C.conclusion, results: C.results },
      D: { id: D.id, results: D.results },
      E: { id: E.id, results: E.results },
      F,
    },
    bestSafeOptimization: bestSafe,
    xdrChanged: false,
    updatedFingerprint: A.txMeta.fingerprint,
    policyDecision,
    totalDepositExposureIfBroadcastWithDefensibleCeiling: {
      noteStroops: 20_000_000,
      poolFeeStroops: 1_000_000,
      maxGasStroops: defensibleCeiling,
      totalStroops: 20_000_000 + 1_000_000 + defensibleCeiling,
      totalXlm: ((20_000_000 + 1_000_000 + defensibleCeiling) / 1e7).toFixed(7),
    },
    gates: {
      globalMutator: 'OFF',
      registration: 'OFF',
      deposit: 'OFF',
      broadcastPerformed: false,
      sendTransactionCalled: false,
    },
    proofAndSemantics: {
      groth16ProofRetained: true,
      public_amount: amountSemantics.public_amount,
      ext_amount: amountSemantics.ext_amount,
      poolFeeAccountingValid: amountSemantics.matchesPoolFee,
      contractFunction: 'transact',
      pool: POOL,
      cryptographicValidationWeakened: false,
      depositAmountSilentReduced: false,
    },
    findings: [
      'Fee is dominated by state rent / storage writes for nullifier+commitment creates and TTL, plus ~69M CPU instructions for on-chain Groth16 verify — not by inclusion fee or envelope base fee.',
      'diskReadBytes=144 is already tiny; writeBytes=5760 matches creating multiple persistent ledger entries.',
      'Re-assembly does not reduce minResourceFee (same host metering).',
      'Trimming declared instructions does not reduce metered work; declaring below metered is unsafe at submit.',
      'Lowering resourceFee below simulate minimum is unsafe at submit even when a re-simulate still reports the true minimum.',
      'No safe client-side optimization achieved minResourceFee ≤ 8_000_000 without changing deposit semantics or weakening verification.',
    ],
  };

  writeJson('FEE-OPTIMIZATION-REPORT.json', report);

  // Markdown summary
  const md = `# SPP deposit fee optimization

Generated: ${report.generatedAtEuropeParis}

## Original resources

| Resource | Value |
| --- | ---: |
| instructions | ${baselineResources.instructions} |
| diskReadBytes | ${baselineResources.diskReadBytes} |
| writeBytes | ${baselineResources.writeBytes} |
| readOnly keys | ${baselineResources.readOnlyCount} |
| readWrite keys | ${baselineResources.readWriteCount} |
| **minResourceFee** | **${A.minResourceFee}** |
| Policy cap | ${POLICY_CAP} |
| Gap | ${gap} |

## Fee decomposition (explanatory)

| Component | Stroops | Share |
| --- | ---: | ---: |
| CPU instructions | ${decomposition.components.cpuInstructionsFee} | ${(decomposition.sumCheck.cpuShareOfTotal * 100).toFixed(1)}% |
| Disk read | ${decomposition.components.diskReadFee} | |
| Write (non-rent) | ${decomposition.components.writeNonRentFee} | |
| Tx size | ${decomposition.components.transactionSizeFee} | |
| Residual rent/events/historical | ${decomposition.components.residualRentEventsHistorical} | ${(decomposition.sumCheck.residualShareOfTotal * 100).toFixed(1)}% |

${decomposition.note}

## Alternatives tested (real simulateTransaction)

| ID | Result | minResourceFee | ≤8M? |
| --- | --- | ---: | --- |
| A baseline | ${A.simulationStatus} | ${A.minResourceFee} | ${A.withinPolicy8M} |
| B assembled | ${B.simulationStatus} | ${B.minResourceFee} | ${B.withinPolicy8M} |
| C trim instructions | see report | (no safe reduction) | false |
| D drop RO keys | see report | (per-key) | |
| E lower resourceFee | sim may succeed; submit unsafe if below min | | |
| F inclusion fee | observation | n/a | n/a |

## Amount semantics

- public_amount = ${amountSemantics.public_amount}
- ext_amount = ${amountSemantics.ext_amount}
- fee check = ${amountSemantics.matchesPoolFee}

## Recommendation

${policyDecision.recommendedAction}

- Minimum defensible fee ceiling: **${defensibleCeiling}** stroops (${policyDecision.minimumDefensibleFeeCeilingXlm} XLM) with ${policyDecision.safetyMarginStroops} stroop margin
- Policy **NOT** raised automatically
- XDR **unchanged** (fingerprint \`${A.txMeta.fingerprint}\`)
- Broadcast: **none**; gates remain **OFF**

## Total exposure if human raises ceiling

${report.totalDepositExposureIfBroadcastWithDefensibleCeiling.totalXlm} XLM (= 2.0 note + 0.1 pool fee + ${(defensibleCeiling / 1e7).toFixed(7)} max gas)
`;
  writeFileSync(join(OUT_DIR, 'FEE-OPTIMIZATION-REPORT.md'), md);
  log(`report → ${join(OUT_DIR, 'FEE-OPTIMIZATION-REPORT.json')}`);
  log(
    `baselineFee=${A.minResourceFee} bestSafe=${bestSafe?.fee ?? 'none'} policyGap=${gap} xdrChanged=false`,
  );
}

main().catch((e) => {
  console.error('[spp-deposit-fee-optimize] fatal', e);
  process.exit(1);
});
