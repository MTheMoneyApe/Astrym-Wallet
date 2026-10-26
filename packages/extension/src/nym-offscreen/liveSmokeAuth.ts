/**
 * Hard gate for the dedicated live createMixFetch smoke path.
 *
 * Default: unauthorized. Enable only for a single rebuild/session via:
 *   VITE_NYM_LIVE_SMOKE_AUTHORIZED=true
 * when building (`pnpm build:nym-live-smoke`).
 *
 * Never leave the flag permanently true in source. Asset probing does not
 * require this flag; createMixFetch does.
 */

export const NYM_LIVE_SMOKE_EXECUTION_AUTHORIZED =
  import.meta.env.VITE_NYM_LIVE_SMOKE_AUTHORIZED === 'true';

export function assertNymLiveSmokeAuthorized(): void {
  if (!NYM_LIVE_SMOKE_EXECUTION_AUTHORIZED) {
    throw Object.assign(
      new Error(
        'Nym live smoke is not authorized (NYM_LIVE_SMOKE_EXECUTION_AUTHORIZED=false). Asset checks may still run; createMixFetch will not. Rebuild with VITE_NYM_LIVE_SMOKE_AUTHORIZED=true for a one-shot session only.',
      ),
      { code: 'SMOKE_NOT_AUTHORIZED' as const },
    );
  }
}
