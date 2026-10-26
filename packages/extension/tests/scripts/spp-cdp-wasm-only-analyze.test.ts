/**
 * Fase 5G.9 — unit tests for offline WASM-only NDJSON analyzer.
 * Synthetic fixtures only: no Chrome, network, WASM, or SPP SDK.
 */

import { describe, expect, it } from 'vitest';

import {
  ABSENCE_LIMIT,
  analyzeNdjsonText,
  classifyResourceUrl,
  correlateNetwork,
  parseAnalyzeArgs,
  parseNdjsonText,
  SCHEMA_VERSION,
} from '../../scripts/spp-cdp-wasm-only-analyze.mjs';

const EXT = 'abcdefghijklmnopqrstuvwxyzabcdef';

function ndjson(rows: object[]): string {
  return rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
}

function markers(okWasm = true) {
  return [
    {
      t: '2026-10-26T12:00:00.000Z',
      kind: 'phase-marker',
      phase: 'T0',
      targetId: 'HOST',
      sessionId: 'S_HOST',
      ui: { phase: 'uninitialized', wasm: 'not-started', runDisabled: true },
    },
    {
      t: '2026-10-26T12:00:05.000Z',
      kind: 'phase-marker',
      phase: 'T1',
      targetId: 'HOST',
      sessionId: 'S_HOST',
      ui: { phase: 'ready', wasm: 'not-started', runDisabled: true },
    },
    {
      t: '2026-10-26T12:00:10.000Z',
      kind: 'phase-marker',
      phase: 'T2',
      targetId: 'HOST',
      sessionId: 'S_HOST',
      outcome: okWasm ? 'ready' : 'error',
      ui: {
        phase: 'ready',
        wasm: okWasm ? 'ready' : 'error',
        runDisabled: true,
        executionAuthorized: false,
        sdkInitialized: false,
        sessionInitializeEnabled: false,
      },
    },
  ];
}

function netEvent(
  method: string,
  t: string,
  requestId: string,
  url: string,
  sessionId: string,
  extra: Record<string, unknown> = {},
) {
  const summary: Record<string, unknown> = { requestId, url, ...extra };
  if (method === 'Network.requestWillBeSent') {
    summary.method = 'GET';
    summary.type = 'Fetch';
  }
  return {
    t,
    kind: 'event',
    method,
    sessionId,
    targetId: 'HOST',
    targetType: 'page',
    targetUrl: `chrome-extension://${EXT}/spp-host.html`,
    hostOpened: true,
    summary,
  };
}

/** Positive host-page Network.enable success (required for ok). */
function hostNetworkEnableOk(sessionId = 'S_HOST') {
  return {
    t: '2026-10-26T11:59:58.000Z',
    kind: 'domain-setup',
    domain: 'Network.enable',
    ok: true,
    sessionId,
    targetId: 'HOST',
    type: 'page',
    url: `chrome-extension://${EXT}/spp-host.html`,
  };
}

function okFixture() {
  const wasmUrl = `chrome-extension://${EXT}/spp/dist/stellar_private_payments_web_bg.wasm`;
  return ndjson([
    { t: '2026-10-26T11:59:59.000Z', kind: 'meta', extensionId: EXT },
    hostNetworkEnableOk(),
    ...markers(true),
    netEvent(
      'Network.requestWillBeSent',
      '2026-10-26T12:00:02.000Z',
      'P1',
      `chrome-extension://${EXT}/spp/js/index.js`,
      'S_HOST',
    ),
    netEvent(
      'Network.responseReceived',
      '2026-10-26T12:00:02.100Z',
      'P1',
      `chrome-extension://${EXT}/spp/js/index.js`,
      'S_HOST',
      { status: 200 },
    ),
    netEvent('Network.requestWillBeSent', '2026-10-26T12:00:07.000Z', 'W1', wasmUrl, 'S_HOST'),
    netEvent(
      'Network.responseReceived',
      '2026-10-26T12:00:07.200Z',
      'W1',
      wasmUrl,
      'S_HOST',
      { status: 200, mimeType: 'application/wasm' },
    ),
  ]);
}

describe('parseAnalyzeArgs', () => {
  it('parses input, extension-id, and output', () => {
    const a = parseAnalyzeArgs([
      'node',
      'analyze.mjs',
      'C:\\tmp\\in.ndjson',
      '--extension-id',
      EXT,
      '--output',
      'C:\\tmp\\out.json',
    ]);
    expect(a.input).toMatch(/in\.ndjson$/);
    expect(a.extensionId).toBe(EXT);
    expect(a.output).toMatch(/out\.json$/);
  });
});

describe('parseNdjsonText', () => {
  it('parses valid NDJSON objects', () => {
    const { rows, parseErrors } = parseNdjsonText(
      ndjson([{ t: '2026-01-01T00:00:00.000Z', kind: 'meta' }, { kind: 'event', method: 'X' }]),
    );
    expect(parseErrors).toHaveLength(0);
    expect(rows).toHaveLength(2);
    expect(rows[0].kind).toBe('meta');
  });

  it('records invalid JSON with line number', () => {
    const text = '{"kind":"meta"}\n{not-json\n{"kind":"event"}\n';
    const { rows, parseErrors } = parseNdjsonText(text);
    expect(rows).toHaveLength(2);
    expect(parseErrors).toHaveLength(1);
    expect(parseErrors[0].line).toBe(2);
    expect(parseErrors[0].reason).toMatch(/JSON|Unexpected|position/i);
  });
});

describe('correlateNetwork', () => {
  it('joins request/response/failure by session+requestId', () => {
    const rows = [
      netEvent(
        'Network.requestWillBeSent',
        '2026-10-26T12:00:07.000Z',
        'W1',
        `chrome-extension://${EXT}/spp/dist/stellar_private_payments_web_bg.wasm`,
        'S_HOST',
      ),
      netEvent(
        'Network.responseReceived',
        '2026-10-26T12:00:07.100Z',
        'W1',
        `chrome-extension://${EXT}/spp/dist/stellar_private_payments_web_bg.wasm`,
        'S_HOST',
        { status: 200 },
      ),
      netEvent(
        'Network.requestWillBeSent',
        '2026-10-26T12:00:08.000Z',
        'F1',
        `chrome-extension://${EXT}/spp/x.js`,
        'S_HOST',
      ),
      netEvent(
        'Network.loadingFailed',
        '2026-10-26T12:00:08.050Z',
        'F1',
        `chrome-extension://${EXT}/spp/x.js`,
        'S_HOST',
        { errorText: 'net::ERR_FAILED', canceled: false },
      ),
    ].map((r, i) => ({ ...r, _line: i + 1 }));

    const { requests } = correlateNetwork(rows);
    expect(requests).toHaveLength(2);
    const ok = requests.find((r) => r.requestId === 'W1');
    expect(ok?.incomplete).toBe(false);
    expect(ok?.status).toBe(200);
    expect(ok?.failed).toBe(false);
    const fail = requests.find((r) => r.requestId === 'F1');
    expect(fail?.failed).toBe(true);
    expect(fail?.incomplete).toBe(false);
  });

  it('isolates identical requestIds across sessions', () => {
    const rows = [
      netEvent(
        'Network.requestWillBeSent',
        '2026-10-26T12:00:07.000Z',
        'R',
        `chrome-extension://${EXT}/a.js`,
        'S1',
      ),
      netEvent(
        'Network.requestWillBeSent',
        '2026-10-26T12:00:07.000Z',
        'R',
        `chrome-extension://${EXT}/b.js`,
        'S2',
      ),
    ].map((r, i) => ({ ...r, _line: i + 1 }));
    const { requests } = correlateNetwork(rows);
    expect(requests).toHaveLength(2);
    expect(requests[0].url).toContain('a.js');
    expect(requests[1].url).toContain('b.js');
  });

  it('marks incomplete requests without terminal events', () => {
    const rows = [
      netEvent(
        'Network.requestWillBeSent',
        '2026-10-26T12:00:07.000Z',
        'W1',
        `chrome-extension://${EXT}/spp/dist/stellar_private_payments_web_bg.wasm`,
        'S_HOST',
      ),
    ].map((r, i) => ({ ...r, _line: i + 1 }));
    const { requests } = correlateNetwork(rows);
    expect(requests[0].incomplete).toBe(true);
  });

  it('detects duplicates and conflicts', () => {
    const base = netEvent(
      'Network.requestWillBeSent',
      '2026-10-26T12:00:07.000Z',
      'W1',
      `chrome-extension://${EXT}/a.wasm`,
      'S_HOST',
    );
    const rows = [
      base,
      { ...base },
      netEvent(
        'Network.requestWillBeSent',
        '2026-10-26T12:00:07.001Z',
        'W1',
        `chrome-extension://${EXT}/b.wasm`,
        'S_HOST',
      ),
    ].map((r, i) => ({ ...r, _line: i + 1 }));
    const { requests } = correlateNetwork(rows);
    expect(requests[0].duplicates.length).toBeGreaterThanOrEqual(1);
    expect(requests[0].conflicts.length).toBeGreaterThanOrEqual(1);
    expect(requests[0].urlMutations.length).toBeGreaterThanOrEqual(1);
    expect(requests[0].redirectAmbiguous).toBe(true);
  });

  it('warns on weak key when sessionId is missing', () => {
    const row = {
      ...netEvent(
        'Network.requestWillBeSent',
        '2026-10-26T12:00:07.000Z',
        'W1',
        `chrome-extension://${EXT}/x.wasm`,
        'S_HOST',
      ),
      sessionId: null,
      _line: 1,
    };
    const { warnings } = correlateNetwork([row]);
    expect(warnings.some((w) => w.code === 'weak-network-key')).toBe(true);
  });
});

describe('classifyResourceUrl', () => {
  it('classifies wasm-main', () => {
    const c = classifyResourceUrl(
      `chrome-extension://${EXT}/spp/dist/stellar_private_payments_web_bg.wasm`,
      EXT,
    );
    expect(c.class).toBe('wasm-main');
  });

  it('classifies storage-worker, prover-worker, and circuits', () => {
    expect(
      classifyResourceUrl(
        `chrome-extension://${EXT}/spp/dist/workers/storage-worker.js`,
        EXT,
      ).class,
    ).toBe('storage-worker');
    expect(
      classifyResourceUrl(
        `chrome-extension://${EXT}/spp/dist/workers/prover-worker.js`,
        EXT,
      ).class,
    ).toBe('prover-worker');
    expect(
      classifyResourceUrl(
        `chrome-extension://${EXT}/spp/dist/circuits/circuits.json`,
        EXT,
      ).class,
    ).toBe('circuits');
  });

  it('classifies external and foreign-extension URLs', () => {
    expect(classifyResourceUrl('https://example.com/rpc', EXT).class).toBe('external');
    expect(
      classifyResourceUrl('chrome-extension://otherotherotherotherotherothe/spp/x.js', EXT)
        .class,
    ).toBe('foreign-extension');
  });
});

describe('analyzeNdjsonText decisions', () => {
  it('returns ok when explicit markers and wasm-main only in WASM window', () => {
    const report = analyzeNdjsonText(okFixture(), { extensionId: EXT, inputLabel: 'ok.ndjson' });
    expect(report.schemaVersion).toBe(SCHEMA_VERSION);
    expect(report.verdict).toBe('ok');
    expect(report.phaseSource).toBe('explicit');
    expect(report.phaseConfidence).toBe('high');
    expect(report.phases?.T0.t).toBeTruthy();
    expect(report.limits).toContain(ABSENCE_LIMIT);
    expect(
      report.networkRequests.some((r) => r.class === 'wasm-main' && r.window === 'wasm'),
    ).toBe(true);
  });

  it('aborts on external traffic in WASM window', () => {
    const text = ndjson([
      ...markers(true),
      netEvent(
        'Network.requestWillBeSent',
        '2026-10-26T12:00:07.000Z',
        'W1',
        `chrome-extension://${EXT}/spp/dist/stellar_private_payments_web_bg.wasm`,
        'S_HOST',
      ),
      netEvent(
        'Network.responseReceived',
        '2026-10-26T12:00:07.100Z',
        'W1',
        `chrome-extension://${EXT}/spp/dist/stellar_private_payments_web_bg.wasm`,
        'S_HOST',
        { status: 200 },
      ),
      netEvent(
        'Network.requestWillBeSent',
        '2026-10-26T12:00:07.500Z',
        'E1',
        'https://horizon.example/rpc',
        'S_HOST',
      ),
    ]);
    const report = analyzeNdjsonText(text, { extensionId: EXT });
    expect(report.verdict).toBe('abort');
    expect(report.violations.some((v) => v.class === 'external')).toBe(true);
  });

  it('aborts on storage-worker resource in WASM window', () => {
    const text = ndjson([
      ...markers(true),
      netEvent(
        'Network.requestWillBeSent',
        '2026-10-26T12:00:07.000Z',
        'W1',
        `chrome-extension://${EXT}/spp/dist/stellar_private_payments_web_bg.wasm`,
        'S_HOST',
      ),
      netEvent(
        'Network.responseReceived',
        '2026-10-26T12:00:07.050Z',
        'W1',
        `chrome-extension://${EXT}/spp/dist/stellar_private_payments_web_bg.wasm`,
        'S_HOST',
        { status: 200 },
      ),
      netEvent(
        'Network.requestWillBeSent',
        '2026-10-26T12:00:07.200Z',
        'SW',
        `chrome-extension://${EXT}/spp/dist/workers/storage-worker.js`,
        'S_HOST',
      ),
    ]);
    const report = analyzeNdjsonText(text, { extensionId: EXT });
    expect(report.verdict).toBe('abort');
    expect(report.violations.some((v) => v.class === 'storage-worker')).toBe(true);
  });

  it('aborts on foreign-extension URL', () => {
    const text = ndjson([
      ...markers(true),
      netEvent(
        'Network.requestWillBeSent',
        '2026-10-26T12:00:07.000Z',
        'W1',
        `chrome-extension://${EXT}/spp/dist/stellar_private_payments_web_bg.wasm`,
        'S_HOST',
      ),
      netEvent(
        'Network.responseReceived',
        '2026-10-26T12:00:07.050Z',
        'W1',
        `chrome-extension://${EXT}/spp/dist/stellar_private_payments_web_bg.wasm`,
        'S_HOST',
        { status: 200 },
      ),
      netEvent(
        'Network.requestWillBeSent',
        '2026-10-26T12:00:07.200Z',
        'F',
        'chrome-extension://zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz/evil.js',
        'S_HOST',
      ),
    ]);
    const report = analyzeNdjsonText(text, { extensionId: EXT });
    expect(report.verdict).toBe('abort');
    expect(report.violations.some((v) => v.class === 'foreign-extension')).toBe(true);
  });

  it('diffs preexisting vs new targets after T1', () => {
    const text = ndjson([
      ...markers(true),
      {
        t: '2026-10-26T12:00:01.000Z',
        kind: 'event',
        method: 'Target.targetCreated',
        targetId: 'SW1',
        targetType: 'service_worker',
        targetUrl: `chrome-extension://${EXT}/background.js`,
        hostOpened: true,
        summary: {
          targetId: 'SW1',
          type: 'service_worker',
          url: `chrome-extension://${EXT}/background.js`,
        },
      },
      {
        t: '2026-10-26T12:00:07.500Z',
        kind: 'event',
        method: 'Target.targetCreated',
        targetId: 'WK1',
        targetType: 'worker',
        targetUrl: `chrome-extension://${EXT}/spp/dist/workers/storage-worker.js`,
        hostOpened: true,
        summary: {
          targetId: 'WK1',
          type: 'worker',
          url: `chrome-extension://${EXT}/spp/dist/workers/storage-worker.js`,
        },
      },
      netEvent(
        'Network.requestWillBeSent',
        '2026-10-26T12:00:07.000Z',
        'W1',
        `chrome-extension://${EXT}/spp/dist/stellar_private_payments_web_bg.wasm`,
        'S_HOST',
      ),
      netEvent(
        'Network.responseReceived',
        '2026-10-26T12:00:07.050Z',
        'W1',
        `chrome-extension://${EXT}/spp/dist/stellar_private_payments_web_bg.wasm`,
        'S_HOST',
        { status: 200 },
      ),
    ]);
    const report = analyzeNdjsonText(text, { extensionId: EXT });
    expect(report.targetDiff.preT1.some((t) => t.targetId === 'SW1')).toBe(true);
    expect(report.targetDiff.newTargetIdsPostT1.some((t) => t.targetId === 'WK1')).toBe(
      true,
    );
    expect(report.verdict).toBe('abort');
  });

  it('does not treat a new attach on a known targetId as a new targetId', () => {
    const text = ndjson([
      hostNetworkEnableOk(),
      ...markers(true),
      {
        t: '2026-10-26T12:00:01.000Z',
        kind: 'event',
        method: 'Target.targetCreated',
        targetId: 'SW1',
        targetType: 'service_worker',
        targetUrl: `chrome-extension://${EXT}/background.js`,
        hostOpened: true,
        summary: {
          targetId: 'SW1',
          type: 'service_worker',
          url: `chrome-extension://${EXT}/background.js`,
        },
      },
      {
        t: '2026-10-26T12:00:07.500Z',
        kind: 'event',
        method: 'Target.attachedToTarget',
        targetId: 'SW1',
        targetType: 'service_worker',
        targetUrl: `chrome-extension://${EXT}/background.js`,
        attachedSessionId: 'S_NEW',
        sessionId: null,
        hostOpened: true,
        summary: {
          targetId: 'SW1',
          type: 'service_worker',
          url: `chrome-extension://${EXT}/background.js`,
          sessionId: 'S_NEW',
        },
      },
      netEvent(
        'Network.requestWillBeSent',
        '2026-10-26T12:00:07.000Z',
        'W1',
        `chrome-extension://${EXT}/spp/dist/stellar_private_payments_web_bg.wasm`,
        'S_HOST',
      ),
      netEvent(
        'Network.responseReceived',
        '2026-10-26T12:00:07.050Z',
        'W1',
        `chrome-extension://${EXT}/spp/dist/stellar_private_payments_web_bg.wasm`,
        'S_HOST',
        { status: 200 },
      ),
    ]);
    const report = analyzeNdjsonText(text, { extensionId: EXT });
    expect(report.targetDiff.newTargetIdsPostT1.some((t) => t.targetId === 'SW1')).toBe(
      false,
    );
    expect(report.targetDiff.attachesPostT1.some((a) => a.knownTarget === true)).toBe(true);
    expect(report.verdict).toBe('ok');
  });

  it('accepts valid T0/T1/T2 markers', () => {
    const report = analyzeNdjsonText(okFixture(), { extensionId: EXT });
    expect(report.phases?.T0).toBeTruthy();
    expect(report.phases?.T1).toBeTruthy();
    expect(report.phases?.T2).toBeTruthy();
    expect(report.phaseSource).toBe('explicit');
  });

  it('returns abort on contradictory marker order', () => {
    const text = ndjson([
      {
        t: '2026-10-26T12:00:10.000Z',
        kind: 'phase-marker',
        phase: 'T0',
        targetId: 'HOST',
        sessionId: 'S',
      },
      {
        t: '2026-10-26T12:00:05.000Z',
        kind: 'phase-marker',
        phase: 'T1',
        targetId: 'HOST',
        sessionId: 'S',
      },
      {
        t: '2026-10-26T12:00:12.000Z',
        kind: 'phase-marker',
        phase: 'T2',
        targetId: 'HOST',
        sessionId: 'S',
        outcome: 'ready',
      },
    ]);
    const report = analyzeNdjsonText(text, { extensionId: EXT });
    expect(report.verdict).toBe('abort');
    expect(report.violations.some((v) => v.code === 'phase-marker-contradiction')).toBe(
      true,
    );
  });

  it('returns inconclusive when markers are missing', () => {
    const text = ndjson([
      netEvent(
        'Network.requestWillBeSent',
        '2026-10-26T12:00:07.000Z',
        'W1',
        `chrome-extension://${EXT}/spp/dist/stellar_private_payments_web_bg.wasm`,
        'S_HOST',
      ),
    ]);
    const report = analyzeNdjsonText(text, { extensionId: EXT });
    expect(report.verdict).toBe('inconclusive');
    expect(report.phaseSource).toBe('none');
  });

  it('returns inconclusive when extensionId is missing even with markers', () => {
    const text = ndjson([
      ...markers(true),
      netEvent(
        'Network.requestWillBeSent',
        '2026-10-26T12:00:07.000Z',
        'W1',
        `chrome-extension://${EXT}/spp/dist/stellar_private_payments_web_bg.wasm`,
        'S_HOST',
      ),
      netEvent(
        'Network.responseReceived',
        '2026-10-26T12:00:07.050Z',
        'W1',
        `chrome-extension://${EXT}/spp/dist/stellar_private_payments_web_bg.wasm`,
        'S_HOST',
        { status: 200 },
      ),
    ]);
    const report = analyzeNdjsonText(text);
    expect(report.verdict).toBe('inconclusive');
    expect(report.warnings.some((w) => w.code === 'extension-id-missing')).toBe(true);
  });

  it('aborts when sdkInitialized is true in UI evidence', () => {
    const badMarkers = markers(true);
    badMarkers[2].ui = {
      ...badMarkers[2].ui,
      sdkInitialized: true,
    };
    const text = ndjson([
      ...badMarkers,
      netEvent(
        'Network.requestWillBeSent',
        '2026-10-26T12:00:07.000Z',
        'W1',
        `chrome-extension://${EXT}/spp/dist/stellar_private_payments_web_bg.wasm`,
        'S_HOST',
      ),
      netEvent(
        'Network.responseReceived',
        '2026-10-26T12:00:07.050Z',
        'W1',
        `chrome-extension://${EXT}/spp/dist/stellar_private_payments_web_bg.wasm`,
        'S_HOST',
        { status: 200 },
      ),
    ]);
    const report = analyzeNdjsonText(text, { extensionId: EXT });
    expect(report.verdict).toBe('abort');
    expect(report.violations.some((v) => v.code === 'sdk-initialized-true')).toBe(true);
  });

  it('always includes limits and absence warning', () => {
    const report = analyzeNdjsonText('{"kind":"meta"}\n', { extensionId: EXT });
    expect(report.limits).toContain(ABSENCE_LIMIT);
    expect(report.limits.some((l) => /OPFS/i.test(l))).toBe(true);
    expect(report.limits.some((l) => /dedicated workers/i.test(l))).toBe(true);
  });

  it('surfaces parse errors into warnings without inventing events', () => {
    const text = '{"kind":"meta"}\nNOT_JSON\n';
    const report = analyzeNdjsonText(text, { extensionId: EXT });
    expect(report.parseErrors).toHaveLength(1);
    expect(report.warnings.some((w) => w.code === 'ndjson-parse-error')).toBe(true);
  });
});

function wasmSuccessPair() {
  const wasmUrl = `chrome-extension://${EXT}/spp/dist/stellar_private_payments_web_bg.wasm`;
  return [
    netEvent('Network.requestWillBeSent', '2026-10-26T12:00:07.000Z', 'W1', wasmUrl, 'S_HOST'),
    netEvent(
      'Network.responseReceived',
      '2026-10-26T12:00:07.100Z',
      'W1',
      wasmUrl,
      'S_HOST',
      { status: 200, mimeType: 'application/wasm' },
    ),
  ];
}

describe('5G.11 adversarial regressions (false ok hardening)', () => {
  it('1 aborts on Storage worker after T2', () => {
    const text = ndjson([
      ...markers(true),
      ...wasmSuccessPair(),
      netEvent(
        'Network.requestWillBeSent',
        '2026-10-26T12:00:11.000Z',
        'SW',
        `chrome-extension://${EXT}/spp/dist/workers/storage-worker.js`,
        'S_HOST',
      ),
    ]);
    const report = analyzeNdjsonText(text, { extensionId: EXT });
    expect(report.verdict).toBe('abort');
    expect(report.violations.some((v) => v.class === 'storage-worker')).toBe(true);
  });

  it('2 aborts on external traffic after T2', () => {
    const text = ndjson([
      ...markers(true),
      ...wasmSuccessPair(),
      netEvent(
        'Network.requestWillBeSent',
        '2026-10-26T12:00:11.000Z',
        'E1',
        'https://evil.example/rpc',
        'S_HOST',
      ),
    ]);
    const report = analyzeNdjsonText(text, { extensionId: EXT });
    expect(report.verdict).toBe('abort');
    expect(report.violations.some((v) => v.class === 'external')).toBe(true);
  });

  it('3 rejects duplicate T2 with later worker (no ok)', () => {
    const text = ndjson([
      {
        t: '2026-10-26T12:00:00.000Z',
        kind: 'phase-marker',
        phase: 'T0',
        targetId: 'H',
        sessionId: 'S',
        ui: { runDisabled: true },
      },
      {
        t: '2026-10-26T12:00:05.000Z',
        kind: 'phase-marker',
        phase: 'T1',
        targetId: 'H',
        sessionId: 'S',
        ui: { runDisabled: true },
      },
      {
        t: '2026-10-26T12:00:06.000Z',
        kind: 'phase-marker',
        phase: 'T2',
        targetId: 'H',
        sessionId: 'S',
        outcome: 'ready',
        ui: {
          wasm: 'ready',
          runDisabled: true,
          executionAuthorized: false,
          sdkInitialized: false,
        },
      },
      {
        t: '2026-10-26T12:00:10.000Z',
        kind: 'phase-marker',
        phase: 'T2',
        targetId: 'H',
        sessionId: 'S',
        outcome: 'ready',
        ui: {
          wasm: 'ready',
          runDisabled: true,
          executionAuthorized: false,
          sdkInitialized: false,
        },
      },
      netEvent(
        'Network.requestWillBeSent',
        '2026-10-26T12:00:05.500Z',
        'W1',
        `chrome-extension://${EXT}/spp/dist/stellar_private_payments_web_bg.wasm`,
        'S_HOST',
      ),
      netEvent(
        'Network.responseReceived',
        '2026-10-26T12:00:05.600Z',
        'W1',
        `chrome-extension://${EXT}/spp/dist/stellar_private_payments_web_bg.wasm`,
        'S_HOST',
        { status: 200 },
      ),
      netEvent(
        'Network.requestWillBeSent',
        '2026-10-26T12:00:07.000Z',
        'SW',
        `chrome-extension://${EXT}/spp/dist/workers/storage-worker.js`,
        'S_HOST',
      ),
    ]);
    const report = analyzeNdjsonText(text, { extensionId: EXT });
    expect(report.verdict).not.toBe('ok');
    expect(report.verdict).toBe('inconclusive');
    expect(report.phases).toBeNull();
  });

  it('4 opaque new target after T1 is not ok', () => {
    const text = ndjson([
      ...markers(true),
      ...wasmSuccessPair(),
      {
        t: '2026-10-26T12:00:08.000Z',
        kind: 'event',
        method: 'Target.targetCreated',
        targetId: 'X',
        targetType: null,
        targetUrl: null,
        hostOpened: true,
        summary: { targetId: 'X' },
      },
    ]);
    const report = analyzeNdjsonText(text, { extensionId: EXT });
    expect(report.verdict).not.toBe('ok');
    expect(report.verdict).toBe('inconclusive');
    expect(
      report.violations.some((v) => v.code === 'new-opaque-or-unclassified-target-post-t1'),
    ).toBe(true);
  });

  it('5 unrecognized worker path during WASM window is not ok', () => {
    const text = ndjson([
      ...markers(true),
      ...wasmSuccessPair(),
      netEvent(
        'Network.requestWillBeSent',
        '2026-10-26T12:00:07.500Z',
        'E',
        `chrome-extension://${EXT}/spp/dist/workers/store.js`,
        'S_HOST',
      ),
    ]);
    const report = analyzeNdjsonText(text, { extensionId: EXT });
    expect(report.verdict).not.toBe('ok');
    expect(report.verdict).toBe('inconclusive');
    expect(
      report.networkRequests.some((r) => r.class === 'unrecognized-worker-path'),
    ).toBe(true);
  });

  it('6 null URL / unknown-path in risk perimeter is not ok', () => {
    const text = ndjson([
      ...markers(true),
      ...wasmSuccessPair(),
      {
        t: '2026-10-26T12:00:07.500Z',
        kind: 'event',
        method: 'Network.requestWillBeSent',
        sessionId: 'S_HOST',
        targetId: 'HOST',
        hostOpened: true,
        summary: { requestId: 'U', url: null, method: 'GET' },
      },
    ]);
    const report = analyzeNdjsonText(text, { extensionId: EXT });
    expect(report.verdict).not.toBe('ok');
    expect(report.verdict).toBe('inconclusive');
  });

  it('7 worker exactly at T1 is treated as risk (abort)', () => {
    const text = ndjson([
      ...markers(true),
      netEvent(
        'Network.requestWillBeSent',
        '2026-10-26T12:00:05.000Z',
        'SW',
        `chrome-extension://${EXT}/spp/dist/workers/storage-worker.js`,
        'S_HOST',
      ),
      ...wasmSuccessPair(),
    ]);
    const report = analyzeNdjsonText(text, { extensionId: EXT });
    expect(report.verdict).toBe('abort');
    expect(report.networkRequests.find((r) => r.requestId === 'SW')?.window).toBe('probe');
  });

  it('8 Network.enable failure on a session blocks ok', () => {
    const text = ndjson([
      ...markers(true),
      ...wasmSuccessPair(),
      {
        t: '2026-10-26T12:00:01.000Z',
        kind: 'domain-setup',
        domain: 'Network.enable',
        ok: false,
        sessionId: 'S_HOST',
        targetId: 'HOST',
        type: 'page',
        url: `chrome-extension://${EXT}/spp-host.html`,
        error: 'failed',
      },
    ]);
    const report = analyzeNdjsonText(text, { extensionId: EXT });
    expect(report.verdict).not.toBe('ok');
    expect(report.verdict).toBe('inconclusive');
    expect(report.violations.some((v) => v.code === 'network-enable-failed')).toBe(true);
  });

  it('9 incomplete wasm-main with ready outcome is not ok', () => {
    const wasmUrl = `chrome-extension://${EXT}/spp/dist/stellar_private_payments_web_bg.wasm`;
    const text = ndjson([
      hostNetworkEnableOk(),
      ...markers(true),
      netEvent('Network.requestWillBeSent', '2026-10-26T12:00:07.000Z', 'W1', wasmUrl, 'S_HOST'),
    ]);
    const report = analyzeNdjsonText(text, { extensionId: EXT });
    expect(report.verdict).not.toBe('ok');
    expect(report.verdict).toBe('inconclusive');
    expect(report.violations.some((v) => v.code === 'wasm-main-incomplete-or-failed')).toBe(
      true,
    );
  });

  it('10 missing runDisabled is not ok', () => {
    const text = ndjson([
      hostNetworkEnableOk('S'),
      {
        t: '2026-10-26T12:00:00.000Z',
        kind: 'phase-marker',
        phase: 'T0',
        targetId: 'H',
        sessionId: 'S',
      },
      {
        t: '2026-10-26T12:00:05.000Z',
        kind: 'phase-marker',
        phase: 'T1',
        targetId: 'H',
        sessionId: 'S',
      },
      {
        t: '2026-10-26T12:00:10.000Z',
        kind: 'phase-marker',
        phase: 'T2',
        targetId: 'H',
        sessionId: 'S',
        outcome: 'ready',
        ui: { wasm: 'ready', executionAuthorized: false, sdkInitialized: false },
      },
      ...wasmSuccessPair(),
    ]);
    const report = analyzeNdjsonText(text, { extensionId: EXT });
    expect(report.verdict).not.toBe('ok');
    expect(report.verdict).toBe('inconclusive');
    expect(report.violations.some((v) => v.code === 'run-disabled-not-confirmed')).toBe(true);
  });

  it('11 missing executionAuthorized is not ok', () => {
    const text = ndjson([
      hostNetworkEnableOk('S'),
      {
        t: '2026-10-26T12:00:00.000Z',
        kind: 'phase-marker',
        phase: 'T0',
        targetId: 'H',
        sessionId: 'S',
      },
      {
        t: '2026-10-26T12:00:05.000Z',
        kind: 'phase-marker',
        phase: 'T1',
        targetId: 'H',
        sessionId: 'S',
      },
      {
        t: '2026-10-26T12:00:10.000Z',
        kind: 'phase-marker',
        phase: 'T2',
        targetId: 'H',
        sessionId: 'S',
        outcome: 'ready',
        ui: { wasm: 'ready', runDisabled: true, sdkInitialized: false },
      },
      ...wasmSuccessPair(),
    ]);
    const report = analyzeNdjsonText(text, { extensionId: EXT });
    expect(report.verdict).not.toBe('ok');
    expect(report.verdict).toBe('inconclusive');
    expect(
      report.violations.some((v) => v.code === 'execution-authorized-not-confirmed-false'),
    ).toBe(true);
  });

  it('12 equal timestamps / ambiguous markers are not ok', () => {
    const text = ndjson([
      {
        t: '2026-10-26T12:00:05.000Z',
        kind: 'phase-marker',
        phase: 'T0',
        targetId: 'H',
        sessionId: 'S',
        ui: { runDisabled: true },
      },
      {
        t: '2026-10-26T12:00:05.000Z',
        kind: 'phase-marker',
        phase: 'T1',
        targetId: 'H',
        sessionId: 'S',
        ui: { runDisabled: true },
      },
      {
        t: '2026-10-26T12:00:10.000Z',
        kind: 'phase-marker',
        phase: 'T2',
        targetId: 'H',
        sessionId: 'S',
        outcome: 'ready',
        ui: {
          wasm: 'ready',
          runDisabled: true,
          executionAuthorized: false,
          sdkInitialized: false,
        },
      },
      ...wasmSuccessPair(),
    ]);
    const report = analyzeNdjsonText(text, { extensionId: EXT });
    expect(report.verdict).not.toBe('ok');
    expect(report.verdict).toBe('abort');
  });
});

describe('5G.13 residual bypass regressions', () => {
  it('1 forbidden URL without timestamp → abort', () => {
    const text = ndjson([
      hostNetworkEnableOk(),
      ...markers(true),
      ...wasmSuccessPair(),
      {
        kind: 'event',
        method: 'Network.requestWillBeSent',
        sessionId: 'S_HOST',
        targetId: 'HOST',
        hostOpened: true,
        summary: {
          requestId: 'NO_TS_EXT',
          url: 'https://horizon.example/rpc',
          method: 'GET',
        },
      },
    ]);
    const report = analyzeNdjsonText(text, { extensionId: EXT });
    expect(report.verdict).toBe('abort');
    expect(report.violations.some((v) => v.code === 'forbidden-resource-untimestamped')).toBe(
      true,
    );
  });

  it('2 unknown URL without timestamp → inconclusive', () => {
    const text = ndjson([
      hostNetworkEnableOk(),
      ...markers(true),
      ...wasmSuccessPair(),
      {
        kind: 'event',
        method: 'Network.requestWillBeSent',
        sessionId: 'S_HOST',
        targetId: 'HOST',
        hostOpened: true,
        summary: {
          requestId: 'NO_TS_UNK',
          url: `chrome-extension://${EXT}/mystery/blob.bin`,
          method: 'GET',
        },
      },
    ]);
    const report = analyzeNdjsonText(text, { extensionId: EXT });
    expect(report.verdict).toBe('inconclusive');
    expect(
      report.violations.some((v) => v.code === 'untimestamped-or-orphan-network-event'),
    ).toBe(true);
  });

  it('3 safe UI only on T0/T1, absent on T2 → inconclusive', () => {
    const safe = {
      runDisabled: true,
      executionAuthorized: false,
      sdkInitialized: false,
    };
    const text = ndjson([
      hostNetworkEnableOk(),
      {
        t: '2026-10-26T12:00:00.000Z',
        kind: 'phase-marker',
        phase: 'T0',
        targetId: 'HOST',
        sessionId: 'S_HOST',
        ui: { ...safe, wasm: 'not-started' },
      },
      {
        t: '2026-10-26T12:00:05.000Z',
        kind: 'phase-marker',
        phase: 'T1',
        targetId: 'HOST',
        sessionId: 'S_HOST',
        ui: { ...safe, wasm: 'not-started' },
      },
      {
        t: '2026-10-26T12:00:10.000Z',
        kind: 'phase-marker',
        phase: 'T2',
        targetId: 'HOST',
        sessionId: 'S_HOST',
        outcome: 'ready',
        ui: { wasm: 'ready' },
      },
      ...wasmSuccessPair(),
    ]);
    const report = analyzeNdjsonText(text, { extensionId: EXT });
    expect(report.verdict).toBe('inconclusive');
    expect(report.uiEvidence.source).toBe('t2-marker-ui');
    expect(report.uiEvidence.runDisabled).toBeNull();
    expect(
      report.violations.some(
        (v) =>
          v.code === 'run-disabled-not-confirmed' ||
          v.code === 'execution-authorized-not-confirmed-false' ||
          v.code === 'sdk-initialized-not-confirmed-false',
      ),
    ).toBe(true);
  });

  it('4 contradictory terminal UI at T2 → not ok (abort)', () => {
    const ms = markers(true);
    ms[2].ui = {
      ...ms[2].ui,
      runDisabled: false,
      executionAuthorized: true,
      sdkInitialized: true,
    };
    const text = ndjson([hostNetworkEnableOk(), ...ms, ...wasmSuccessPair()]);
    const report = analyzeNdjsonText(text, { extensionId: EXT });
    expect(report.verdict).not.toBe('ok');
    expect(report.verdict).toBe('abort');
    expect(report.violations.some((v) => v.code === 'storage-run-enabled')).toBe(true);
  });

  it('5 capture without Network.enable success → inconclusive', () => {
    const text = ndjson([...markers(true), ...wasmSuccessPair()]);
    const report = analyzeNdjsonText(text, { extensionId: EXT });
    expect(report.verdict).toBe('inconclusive');
    expect(report.networkEnable.status).toBe('missing');
    expect(
      report.violations.some((v) => v.code === 'network-enable-success-not-observed'),
    ).toBe(true);
  });

  it('6 Network.enable failed → not ok', () => {
    const text = ndjson([
      {
        t: '2026-10-26T11:59:58.000Z',
        kind: 'domain-setup',
        domain: 'Network.enable',
        ok: false,
        sessionId: 'S_HOST',
        targetId: 'HOST',
        type: 'page',
        url: `chrome-extension://${EXT}/spp-host.html`,
        error: 'CDP rejected',
      },
      ...markers(true),
      ...wasmSuccessPair(),
    ]);
    const report = analyzeNdjsonText(text, { extensionId: EXT });
    expect(report.verdict).not.toBe('ok');
    expect(report.verdict).toBe('inconclusive');
    expect(report.networkEnable.status).toBe('failed');
    expect(report.violations.some((v) => v.code === 'network-enable-failed')).toBe(true);
  });

  it('7 command result that cannot be correlated with certainty → inconclusive', () => {
    const text = ndjson([
      {
        t: '2026-10-26T11:59:58.000Z',
        kind: 'cdp-command',
        method: 'Network.enable',
        commandId: 42,
        sessionId: 'S_HOST',
      },
      {
        t: '2026-10-26T11:59:58.100Z',
        kind: 'cdp-result',
        method: 'Network.enable',
        // missing commandId — cannot correlate
        ok: true,
        sessionId: 'S_HOST',
      },
      ...markers(true),
      ...wasmSuccessPair(),
    ]);
    const report = analyzeNdjsonText(text, { extensionId: EXT });
    expect(report.verdict).toBe('inconclusive');
    expect(report.networkEnable.status).toBe('uncorrelated');
    expect(
      report.violations.some((v) => v.code === 'network-enable-success-uncorrelated'),
    ).toBe(true);
  });

  it('8 ambiguous conflict/redirect at T1 boundary → not ok', () => {
    const wasmUrl = `chrome-extension://${EXT}/spp/dist/stellar_private_payments_web_bg.wasm`;
    const text = ndjson([
      hostNetworkEnableOk(),
      ...markers(true),
      // Two distinct requestWillBeSent for same requestId at T1 → conflict; window=probe
      netEvent(
        'Network.requestWillBeSent',
        '2026-10-26T12:00:05.000Z',
        'AMB',
        `chrome-extension://${EXT}/spp/js/index.js`,
        'S_HOST',
      ),
      netEvent(
        'Network.requestWillBeSent',
        '2026-10-26T12:00:05.001Z',
        'AMB',
        `chrome-extension://${EXT}/other/path.js`,
        'S_HOST',
      ),
      netEvent('Network.requestWillBeSent', '2026-10-26T12:00:07.000Z', 'W1', wasmUrl, 'S_HOST'),
      netEvent(
        'Network.responseReceived',
        '2026-10-26T12:00:07.100Z',
        'W1',
        wasmUrl,
        'S_HOST',
        { status: 200 },
      ),
    ]);
    const report = analyzeNdjsonText(text, { extensionId: EXT });
    expect(report.verdict).not.toBe('ok');
    expect(report.verdict).toBe('inconclusive');
    const amb = report.networkRequests.find((r) => r.requestId === 'AMB');
    expect(amb?.window).toBe('probe');
    expect(amb?.conflicts?.length).toBeGreaterThan(0);
    expect(
      report.violations.some((v) => v.code === 'ambiguous-network-in-risk-perimeter'),
    ).toBe(true);
  });

  it('9 incomplete request (no response, no failure) is not treated as success', () => {
    const wasmUrl = `chrome-extension://${EXT}/spp/dist/stellar_private_payments_web_bg.wasm`;
    const text = ndjson([
      hostNetworkEnableOk(),
      ...markers(true),
      netEvent('Network.requestWillBeSent', '2026-10-26T12:00:07.000Z', 'W1', wasmUrl, 'S_HOST'),
    ]);
    const report = analyzeNdjsonText(text, { extensionId: EXT });
    expect(report.verdict).not.toBe('ok');
    const w1 = report.networkRequests.find((r) => r.requestId === 'W1');
    expect(w1?.incomplete).toBe(true);
    expect(w1?.failed).toBe(false);
    expect(w1?.status).toBeNull();
    expect(report.violations.some((v) => v.code === 'wasm-main-incomplete-or-failed')).toBe(
      true,
    );
  });

  it('10 correlated Network.enable via commandId can satisfy positive evidence', () => {
    const text = ndjson([
      {
        t: '2026-10-26T11:59:58.000Z',
        kind: 'cdp-command',
        method: 'Network.enable',
        commandId: 7,
        sessionId: 'S_HOST',
      },
      {
        t: '2026-10-26T11:59:58.050Z',
        kind: 'cdp-result',
        method: 'Network.enable',
        commandId: 7,
        ok: true,
        sessionId: 'S_HOST',
      },
      ...markers(true),
      ...wasmSuccessPair(),
    ]);
    const report = analyzeNdjsonText(text, { extensionId: EXT });
    expect(report.networkEnable.status).toBe('ok');
    expect(report.verdict).toBe('ok');
  });
});

