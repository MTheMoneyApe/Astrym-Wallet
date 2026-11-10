/** Markup fixtures for responsive visual audit (shared wallet.css classes). */

const LONG_STELLAR = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWX';
const LONG_HASH = 'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456';

export type ScreenId =
  | 'onboarding'
  | 'unlock'
  | 'dashboard'
  | 'send'
  | 'receive'
  | 'history'
  | 'nym'
  | 'spp'
  | 'settings'
  | 'modal-approve'
  | 'android-bar';

export const SCREEN_IDS: ScreenId[] = [
  'onboarding',
  'unlock',
  'dashboard',
  'send',
  'receive',
  'history',
  'nym',
  'spp',
  'settings',
  'modal-approve',
  'android-bar',
];

const screens: Record<ScreenId, string> = {
  'android-bar': `
    <div class="android-webapp-bar">
      <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='28'%3E%3Crect width='120' height='28' fill='%233CE894'/%3E%3Ctext x='8' y='19' font-family='sans-serif' font-size='12' fill='%23191A1C'%3EAstrym%3C/text%3E%3C/svg%3E" alt="Astrym" height="28" />
      <span class="text-secondary" style="font-size:0.75rem">Webapp</span>
    </div>`,

  onboarding: `
    <div class="onboarding-screen">
      <main class="onboarding-welcome" style="display:flex;flex-direction:column;align-items:center;text-align:center;padding:24px 0">
        <div class="unlock-logo" style="background:#3CE894;border-radius:22px;width:96px;height:96px"></div>
        <h1 class="onboarding-title" style="font-family:var(--font-display)">Welcome to Astrym</h1>
        <p class="text-secondary">Your privacy-first Stellar wallet.</p>
        <div class="stack-gap" style="width:min(320px,100%);margin-top:16px">
          <button class="btn-primary" type="button">Create New Wallet</button>
          <button class="btn-secondary" type="button">Import Wallet</button>
        </div>
      </main>
    </div>`,

  unlock: `
    <div class="unlock-screen">
      <div class="unlock-brand">
        <div class="unlock-logo" style="background:#3CE894"></div>
        <h2 class="unlock-title">Astrym</h2>
        <span class="unlock-tagline">PRIVATE BY DESIGN</span>
      </div>
      <form class="unlock-form">
        <div class="unlock-field">
          <input class="input-field" type="password" placeholder="Enter your password" value="" />
          <button type="button" class="unlock-toggle">Show</button>
        </div>
        <button type="submit" class="btn-primary" style="width:100%">Unlock</button>
      </form>
    </div>`,

  dashboard: `
    <div class="view-container">
      <div class="header">
        <div class="account-menu-wrap">
          <button type="button" class="btn-outline" style="width:100%;text-align:left">Main · GABC…UVWX</button>
        </div>
        <button type="button" class="btn-icon" aria-label="Settings">⚙</button>
      </div>
      <div class="card balance-card">
        <div class="balance-indicator" data-status="connected"></div>
        <p class="text-secondary" style="margin:0 0 8px">Available</p>
        <h2 style="margin:0;font-size:clamp(1.4rem,5vw,2rem)">12.4500000 XLM</h2>
        <p class="mono-ellipsis address-wrap text-secondary" style="margin:10px 0 0">${LONG_STELLAR}</p>
      </div>
      <div class="action-grid" style="margin-top:16px">
        <button class="btn-primary" type="button">Send</button>
        <button class="btn-secondary" type="button">Receive</button>
        <button class="btn-outline" type="button">History</button>
        <button class="btn-outline" type="button">Nym</button>
      </div>
    </div>`,

  send: `
    <div class="view-container">
      <div class="header">
        <button class="btn-icon" type="button">←</button>
        <h2>Send</h2>
        <span style="width:44px"></span>
      </div>
      <section class="card stack-gap">
        <label class="stack-gap">Destinatario
          <input class="input-field address-wrap" value="${LONG_STELLAR}" readonly />
        </label>
        <label class="stack-gap">Importe (XLM)
          <input class="input-field" value="1.25" readonly />
        </label>
        <p class="text-secondary" style="margin:0;font-size:0.8rem">Red: Stellar Testnet</p>
        <button class="btn-primary" type="button" style="width:100%">Continuar</button>
      </section>
    </div>`,

  receive: `
    <div class="view-container">
      <div class="header">
        <button class="btn-icon" type="button">←</button>
        <h2>Receive</h2>
        <span style="width:44px"></span>
      </div>
      <div class="card stack-gap" style="align-items:center;text-align:center">
        <div class="receive-qr" style="background:#fff;border-radius:12px"></div>
        <div style="width:100%;text-align:left">
          <p class="text-secondary" style="margin:0 0 8px;font-size:0.72rem">Public address</p>
          <div class="address-wrap" style="background:var(--bg-color);border:1px solid var(--border-dark);border-radius:10px;padding:10px 12px;font-size:0.76rem">${LONG_STELLAR}</div>
        </div>
        <button class="btn-primary" type="button" style="width:100%">Copy address</button>
      </div>
    </div>`,

  history: `
    <div class="view-container">
      <div class="header">
        <button class="btn-icon" type="button">←</button>
        <h2>History</h2>
        <span style="width:44px"></span>
      </div>
      <div class="stack-gap">
        <div class="card stack-gap">
          <div class="row-between">
            <strong>Sent · 1.00 XLM</strong>
            <span class="text-secondary">Hoy</span>
          </div>
          <p class="tx-hash text-secondary" style="margin:0;font-size:0.72rem">${LONG_HASH}</p>
        </div>
        <div class="card stack-gap">
          <div class="row-between">
            <strong>Received · 5.00 XLM</strong>
            <span class="text-secondary">Ayer</span>
          </div>
          <p class="mono-ellipsis text-secondary" style="margin:0;font-size:0.72rem">${LONG_STELLAR}</p>
        </div>
      </div>
    </div>`,

  nym: `
    <div class="view-container">
      <div class="header">
        <button class="btn-icon" type="button">←</button>
        <h2>Nym transport</h2>
        <span style="width:44px"></span>
      </div>
      <section class="card stack-gap">
        <div class="nym-status"><span class="text-accent">Mode: Direct</span></div>
        <p class="text-secondary" style="margin:0">Horizon by default. Connect enables MixFetch (fail-closed).</p>
        <button class="btn-primary" type="button" style="width:100%">Connect Nym</button>
        <p class="address-wrap text-secondary" style="margin:0;font-size:0.72rem">Gateway: ${LONG_STELLAR}</p>
      </section>
    </div>`,

  spp: `
    <div class="view-container">
      <div class="header">
        <button class="btn-icon" type="button">←</button>
        <h2>Private payment</h2>
        <span style="width:44px"></span>
      </div>
      <section class="card stack-gap">
        <label class="stack-gap">Pool contract
          <input class="input-field address-wrap" value="C${LONG_STELLAR.slice(1)}" readonly />
        </label>
        <label class="stack-gap">Amount
          <input class="input-field" value="2.5" readonly />
        </label>
        <p class="text-secondary" style="margin:0;font-size:0.8rem">Requires Nym connected · prepare: idle</p>
        <button class="btn-primary" type="button" style="width:100%">Send privately</button>
      </section>
    </div>`,

  settings: `
    <div class="view-container">
      <div class="header">
        <button class="btn-icon" type="button">←</button>
        <h2>Settings</h2>
        <span style="width:44px"></span>
      </div>
      <div class="card" style="margin-bottom:16px">
        <h3 style="margin-top:0">Recovery phrase</h3>
        <input class="input-field" type="password" placeholder="Password" />
        <button class="btn-secondary" type="button" style="width:100%;margin-top:12px">Reveal</button>
      </div>
      <div class="card">
        <h3 style="margin-top:0">Auto-lock</h3>
        <select class="input-field">
          <option>5 minutes</option>
          <option>15 minutes</option>
        </select>
      </div>
    </div>`,

  'modal-approve': `
    <div class="view-container" style="position:relative;min-height:70dvh">
      <div class="card"><p class="text-secondary">Dashboard behind modal</p></div>
      <div class="modal-sheet">
        <div class="modal-sheet__panel stack-gap">
          <h2 style="margin:0">Approve connection</h2>
          <p class="text-secondary" style="margin:0">example.dapp wants to see your public key.</p>
          <p class="address-wrap" style="font-size:0.78rem">${LONG_STELLAR}</p>
          <div class="action-grid">
            <button class="btn-secondary" type="button">Reject</button>
            <button class="btn-primary" type="button">Approve</button>
          </div>
        </div>
      </div>
    </div>`,
};

export function buildScreenDocument(css: string, screenId: ScreenId): string {
  const bar = screenId === 'android-bar' ? '' : screens['android-bar'];
  return `<!DOCTYPE html>
<html lang="es" class="astrym-webapp">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <style>${css}</style>
</head>
<body>
  <div id="root">
    <div class="wallet-shell" data-screen="${screenId}">
      ${bar}
      ${screens[screenId]}
    </div>
  </div>
</body>
</html>`;
}
