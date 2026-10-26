/**
 * Fase 2.30 — Dedicated worker for local network capability probe.
 * Only contacts same-origin / explicit loopback URLs passed by the page.
 * Does NOT attempt public domains.
 */
/* eslint-disable no-restricted-globals */

self.onmessage = async (ev) => {
  const msg = ev.data || {};
  const report = {
    at: new Date().toISOString(),
    fetchAvailable: typeof self.fetch === 'function',
    xhrAvailable: typeof self.XMLHttpRequest === 'function',
    workerGlobal: self.constructor && self.constructor.name,
    results: [],
  };

  const targets = Array.isArray(msg.localUrls) ? msg.localUrls : [];

  for (const url of targets) {
    const entry = { url, fetch: null, xhr: null };
    if (typeof self.fetch === 'function') {
      try {
        const res = await self.fetch(url, { method: 'GET', cache: 'no-store' });
        entry.fetch = {
          status: 'observed_local',
          http: res.status,
          ok: res.ok,
        };
      } catch (e) {
        entry.fetch = {
          status: 'failed',
          message: e && e.message ? String(e.message) : String(e),
        };
      }
    } else {
      entry.fetch = { status: 'api_unavailable' };
    }

    if (typeof self.XMLHttpRequest === 'function') {
      entry.xhr = await new Promise((resolve) => {
        try {
          const xhr = new XMLHttpRequest();
          xhr.open('GET', url, true);
          xhr.onload = () =>
            resolve({ status: 'observed_local', http: xhr.status });
          xhr.onerror = () => resolve({ status: 'failed', message: 'xhr error' });
          xhr.send();
        } catch (e) {
          resolve({
            status: 'failed',
            message: e && e.message ? String(e.message) : String(e),
          });
        }
      });
    } else {
      entry.xhr = { status: 'api_unavailable' };
    }

    report.results.push(entry);
  }

  report.classification = {
    fetchMechanism: report.fetchAvailable ? 'available' : 'unavailable',
    xhrMechanism: report.xhrAvailable ? 'available' : 'unavailable',
    note:
      'Local attempts only. Absence of external attempts ≠ external blocked. Page fetch guard does not apply inside this worker.',
  };

  self.postMessage(report);
};
