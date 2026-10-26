# Plan — CDP / Chrome residual observation (NOT EXECUTED)

**Status:** design only. No attach, no close, no restart in this phase.

## Goal

Instrument an **already running** Chrome Desktop session to observe:

1. Post-close: Network + worker targets for ≥5s after host `emergencyClose`.
2. Nested workers: whether additional worker targets appear beyond host-registered `storage-worker` / `prover-worker`.

## Constraints

- Do **not** restart Chrome (would drop the operator session).
- Do **not** add npm dependencies (no Playwright/puppeteer install).
- Spike `manifest.json` has **no** `debugger` permission; enabling `chrome.debugger` would be a **spike-only** permission change requiring operator approval and would not by itself prove G9.

## Option A — Remote debugging on an already-debuggable Chrome

Requires Chrome to have been started with e.g. `--remote-debugging-port=9222`.

| Step | Impact |
|------|--------|
| `GET http://127.0.0.1:9222/json/list` | Read-only discovery of targets |
| Attach to extension host page target | Observational; can pause JS if misused — **avoid** Debugger.pause |
| `Target.getTargets` / worker targets | May be denied in some embedded browsers; Desktop Chrome usually allows |
| `Network.enable` + count requests after close | Observational |
| Trigger `emergencyClose` via page evaluate | **Closes SPP session / terminates workers** — describe before run; do not auto-run |

**Blocker if port not open:** cannot attach without restarting Chrome with the flag → **NOT AVAILABLE** without operator-launched debug Chrome.

## Option B — Manual DevTools (current runbook §8 / §11)

No process attach. Operator fills `postClose.proof` and `nestedWorkers` fields after observation. Safest for the existing session.

## Option C — `chrome.debugger` from the spike SW

Would need `"debugger"` permission + user gesture / attach to host tab. High friction; not prepared in manifest. Out of scope until authorized.

## Recommendation

1. Keep Node automation (static audit + containment lifecycle + residualDraftBuilder) as done.  
2. For the **current** Chrome session: use **Option B** + host fieldset **D** (`devtools-assisted-residual.md`). Do **not** enable remote debugging or `debugger` permission without a new authorization.  
3. Optional later: **separate** Chrome profile with `--remote-debugging-port` (does not kill the current session).  
4. Do **not** mark G9 PASS from this plan file.
