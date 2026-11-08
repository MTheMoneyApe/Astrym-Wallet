type Language = 'es' | 'en';

const translations: Record<Language, Record<string, string>> = {
  es: {
    nav_status: 'Estado', nav_wallet: 'Abrir wallet',
    hero_lede: 'Billetera Stellar de autocustodia. Conecta Nym MixFetch cuando quieras ocultar tu tráfico de red, y usa Stellar Private Payments (SPP) sobre el pool público Nethermind Testnet cuando el mixnet esté verificado.',
    hero_open: 'Abrir Astrym Webapp', hero_install: 'Instalar PWA (Android / iOS)',
    hero_note: 'Extensión de escritorio, webapp y móvil son superficies distintas: el popup MV3 no muestra el modo Android; la PWA vive aquí.',
    product_kicker: '01 · PRODUCTO', product_title: 'Qué hace Astrym hoy',
    custody_title: 'Autocustodia', custody_body: 'Frase de 24 palabras y claves en el dispositivo. Astrym no custodia tu cuenta.',
    stellar_title: 'Stellar (Testnet / Mainnet lecturas)', stellar_body: 'Saldos, envíos públicos y Friendbot Testnet con el cliente Stellar endurecido.',
    nym_title: 'Nym MixFetch (opcional)', nym_body: 'Horizon y Soroban pueden salir por el mixnet. Si el modo Nym está activo y falla, Astrym se detiene: sin fallback silencioso a clearnet.',
    spp_title: 'SPP privado (Testnet)', spp_body: 'Depósito, transferencia y retiro contra el pool Nethermind cuando Nym + write_pool_ready están verificados.',
    status_kicker: '02 · ESTADO HONESTO', status_title: 'Implementado · En curso · Futuro',
    done_title: 'Implementado', done_1: 'Vault local, onboarding y firma Stellar', done_2: 'MixFetch 1.4.2 con gateway/NR verificados', done_3: 'HTTP smoke + Horizon-over-Nym (Ankr remap documentado)', done_4: 'SPP SDK 0.2.1, WASM, 16 proving keys, PrivatePool + write_pool_ready', done_5: 'Host SPP embebido en webapp (sin depender de popups bloqueados)',
    wip_title: 'En curso', wip_1: 'Registro on-chain de claves + discovery de destinatarios', wip_2: 'Pago privado Testnet extremo a extremo (requiere aprobación explícita antes de broadcast)', wip_3: 'UX de notas / saldo privado y reconciliación',
    next_title: 'Futuro', next_1: 'Auditorías de seguridad independientes', next_2: 'Claims de anonimato / producción Mainnet SPP', next_3: 'Pools propios o políticas ASP adicionales',
    status_disclaimer: 'Astrym no afirma anonimato criptográfico, auditorías completadas ni readiness de producción. Nym reduce la visibilidad de red; SPP aporta notas privadas en Stellar Testnet cuando el stack está listo.',
    workflow_kicker: '03 · FLUJO', workflow_title: 'Flujo técnico', workflow_1: 'Bóveda cifrada, cuenta Stellar y firma local en extensión o webapp.', workflow_2: 'MixFetch en offscreen (extensión) o bridge in-page (Android / navegador).', workflow_3: 'Horizon/Soroban por Nym cuando está activo; SPP solo con prepare.phase = ready y gate de broadcast.',
    surfaces_kicker: '04 · SUPERFICIES', surfaces_title: 'Cómo usar Astrym', extension_title: 'Extensión de escritorio', extension_body: 'Popup 400×600 centrado en la wallet. Sin barra Android. Ideal para Chrome/Chromium.',
    webapp_title: 'Webapp / PWA', webapp_body: 'Misma wallet a pantalla completa, responsive, instalable. CTA de instalación solo aquí.',
    host_title: 'SPP Host', host_body: 'Laboratorio de sesión SPP', host_note: 'En la webapp se embebe en proceso; no abras runtimes duplicados.',
    founder_kicker: '05 · FUNDADOR', founder_title: 'Fundador', footer_wallet: 'Abrir webapp',
    install_title: 'Instalar en Android / iOS', install_body: 'Pulsa el menú ⋮ del navegador → Añadir a pantalla de inicio / Instalar app', install_close: 'Entendido',
  },
  en: {
    nav_status: 'Status', nav_wallet: 'Open wallet',
    hero_lede: 'A self-custody Stellar wallet. Connect Nym MixFetch when you want to shield your network traffic, and use Stellar Private Payments (SPP) on the public Nethermind Testnet pool once the mixnet is verified.',
    hero_open: 'Open Astrym Webapp', hero_install: 'Install PWA (Android / iOS)',
    hero_note: 'The desktop extension, webapp, and mobile experience are distinct surfaces: the MV3 popup does not show Android mode; the PWA lives here.',
    product_kicker: '01 · PRODUCT', product_title: 'What Astrym does today',
    custody_title: 'Self-custody', custody_body: 'A 24-word recovery phrase and keys stay on your device. Astrym never takes custody of your account.',
    stellar_title: 'Stellar (Testnet / Mainnet reads)', stellar_body: 'Balances, public transfers, and Testnet Friendbot through the hardened Stellar client.',
    nym_title: 'Nym MixFetch (optional)', nym_body: 'Horizon and Soroban traffic can travel through the mixnet. If Nym mode is enabled and fails, Astrym stops—there is no silent fallback to clearnet.',
    spp_title: 'Private SPP (Testnet)', spp_body: 'Deposit, transfer, and withdrawal through the Nethermind pool when Nym and write_pool_ready have been verified.',
    status_kicker: '02 · HONEST STATUS', status_title: 'Implemented · In progress · Future',
    done_title: 'Implemented', done_1: 'Local vault, onboarding, and Stellar signing', done_2: 'MixFetch 1.4.2 with verified gateway/NR', done_3: 'HTTP smoke + Horizon-over-Nym (documented Ankr remap)', done_4: 'SPP SDK 0.2.1, WASM, 16 proving keys, PrivatePool + write_pool_ready', done_5: 'SPP host embedded in the webapp (no reliance on blocked popups)',
    wip_title: 'In progress', wip_1: 'On-chain key registration + recipient discovery', wip_2: 'End-to-end private Testnet payment (explicit approval required before broadcast)', wip_3: 'Note / private-balance UX and reconciliation',
    next_title: 'Future', next_1: 'Independent security audits', next_2: 'Anonymity claims / SPP Mainnet production', next_3: 'Custom pools or additional ASP policies',
    status_disclaimer: 'Astrym does not claim cryptographic anonymity, completed audits, or production readiness. Nym reduces network visibility; SPP provides private notes on Stellar Testnet when the stack is ready.',
    workflow_kicker: '03 · WORKFLOW', workflow_title: 'Technical workflow', workflow_1: 'Encrypted vault, Stellar account, and local signing in the extension or webapp.', workflow_2: 'MixFetch offscreen (extension) or through an in-page bridge (Android / browser).', workflow_3: 'Horizon/Soroban over Nym when enabled; SPP only when prepare.phase = ready and the broadcast gate is satisfied.',
    surfaces_kicker: '04 · SURFACES', surfaces_title: 'How to use Astrym', extension_title: 'Desktop extension', extension_body: 'A 400×600 wallet-focused popup. No Android bar. Ideal for Chrome/Chromium.',
    webapp_title: 'Webapp / PWA', webapp_body: 'The same wallet in a full-screen, responsive, installable experience. The install CTA appears here only.',
    host_title: 'SPP Host', host_body: 'SPP session laboratory', host_note: 'It is embedded in the webapp flow; do not open duplicate runtimes.',
    founder_kicker: '05 · FOUNDER', founder_title: 'Founder', footer_wallet: 'Open webapp',
    install_title: 'Install on Android / iOS', install_body: 'Open your browser menu ⋮ → Add to Home Screen / Install app', install_close: 'Got it',
  },
};

const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-language]'));

function applyLanguage(language: Language): void {
  const dictionary = translations[language];
  document.documentElement.lang = language;
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((element) => {
    const key = element.dataset.i18n;
    const value = key ? dictionary[key] : undefined;
    if (value !== undefined) element.textContent = value;
  });

  const description = language === 'en'
    ? 'Astrym — self-custody Stellar wallet with optional Nym Mixnet transport and SPP private payments on Testnet.'
    : 'Astrym — billetera Stellar de autocustodia con transporte opcional Nym Mixnet y pagos privados SPP en Testnet.';
  const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  if (meta) meta.content = description;
  document.title = language === 'en'
    ? 'Astrym — Stellar self-custody · Nym · SPP'
    : 'Astrym — Autocustodia Stellar · Nym · SPP';

  buttons.forEach((button) => {
    const active = button.dataset.language === language;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });

  try { localStorage.setItem('astrym-site-language', language); } catch { /* Storage may be unavailable. */ }
}

let initialLanguage: Language = 'es';
try {
  const saved = localStorage.getItem('astrym-site-language');
  if (saved === 'es' || saved === 'en') initialLanguage = saved;
  else if (navigator.language.toLowerCase().startsWith('en')) initialLanguage = 'en';
} catch {
  if (navigator.language.toLowerCase().startsWith('en')) initialLanguage = 'en';
}

buttons.forEach((button) => {
  button.addEventListener('click', () => {
    const language = button.dataset.language;
    if (language === 'es' || language === 'en') applyLanguage(language);
  });
});

applyLanguage(initialLanguage);
