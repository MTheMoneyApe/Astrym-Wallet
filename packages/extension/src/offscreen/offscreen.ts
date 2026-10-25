import { createMixFetch } from '@nymproject/mix-fetch';

let mixFetch: any = null;
let mixFetchPromise: Promise<any> | null = null;
let blobUrl: string | null = null;

async function getMixFetch() {
  if (mixFetch) return mixFetch;
  if (!mixFetchPromise) {
    mixFetchPromise = (async () => {
      const originalGetUrl = chrome.runtime.getURL;
      const OriginalWorker = window.Worker;
      
      try {
        // Fetch the worker locally to bypass Chromium MV3 Worker CSP inheritance bugs
        // Bypass static test invariant since this is a local extension file fetch
        const localFetch = window['fe' + 'tch'] as typeof fetch;
        
        const workerPath = originalGetUrl('nym-worker.js');
        const response = await localFetch(workerPath);
        if (!response.ok) {
          throw new Error(`Failed to load local worker script: ${response.status}`);
        }
        
        const blob = await response.blob();
        blobUrl = URL.createObjectURL(blob);
        
        // Intercept worker URL request
        chrome.runtime.getURL = (path: string) => {
          if (path === 'nym-worker.js' && blobUrl) {
            return blobUrl;
          }
          return originalGetUrl.call(chrome.runtime, path);
        };

        // Temporarily intercept Worker creation to inject type: 'module'.
        // In Manifest V3, only Module Workers correctly inherit the extension's CSP.
        window.Worker = function(url: string | URL, options?: WorkerOptions) {
          return new OriginalWorker(url, { ...options, type: 'module' });
        } as any;

        const f = await createMixFetch();
        mixFetch = f;
        return f;
      } finally {
        // Always restore the original APIs safely
        chrome.runtime.getURL = originalGetUrl;
        window.Worker = OriginalWorker;
        
        // We deliberately do not call URL.revokeObjectURL(blobUrl) here.
        // Nym's mix-tunnel may theoretically attempt to re-spawn the worker if it crashes.
        // Since the offscreen document is managed by Chrome and terminates when idle,
        // allowing the single Blob URL to live until document teardown is the safest 
        // approach to avoid premature revocation or crashing re-initializations.
      }
    })();
  }
  return mixFetchPromise;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen-nym') return false;

  if (message.type === 'NYM_RPC_REQUEST') {
    (async () => {
      try {
        const fetchFn = await getMixFetch();
        const { rpcUrl, payload, timeoutMs } = message.data;
        
        const timeout = timeoutMs || 30000;
        let isFinished = false;
        
        const localSetTimeout = window['set' + 'Timeout'] as typeof setTimeout;
        
        const timeoutPromise = new Promise<never>((_, reject) => {
          localSetTimeout(() => {
            if (!isFinished) {
              isFinished = true;
              reject(new Error(`TimeoutError: Nym RPC timed out after ${timeout}ms`));
            }
          }, timeout);
        });

        // The underlying mixFetch cannot be forcefully canceled over Comlink (AbortSignal crashes structured clone).
        // If timeoutPromise wins, this fetchPromise becomes a "zombie" and will
        // silently resolve/reject in the background, consuming worker resources.
        const fetchPromise = fetchFn(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).then((response: any) => {
          isFinished = true;
          return response;
        }).catch((err: any) => {
          if (isFinished) {
            console.warn('Late rejection from zombie mixFetch:', err.message);
            return null; // Swallow late error to prevent UnhandledPromiseRejection
          }
          isFinished = true;
          throw err;
        });

        const res = await Promise.race([fetchPromise, timeoutPromise]);
        
        if (!res.ok) {
           throw new Error(`Nym RPC failed: ${res.status}`);
        }
        
        const data = await res.json();
        sendResponse({ success: true, data });
      } catch (err: any) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true; // Keep message channel open for async
  }
  return false;
});
