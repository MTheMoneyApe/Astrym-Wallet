type Language = 'es' | 'en';

const HTML_KEYS = new Set(['extension_step2', 'extension_step3', 'extension_step4']);

export const translations: Record<Language, Record<string, string>> = {
  es: {
    nav_menu: 'Menú',
    nav_label: 'Navegación principal',
    nav_try: 'Probar Astrym',
    nav_status: 'Estado',
    nav_wallet: 'Abrir wallet',
    hero_title: 'Privacidad con ingeniería cuidadosa.',
    hero_lede: 'Astrym es una wallet experimental de autocustodia construida sobre Stellar. Puedes explorar las distintas superficies de prueba y consultar el estado real del desarrollo.',
    hero_status: 'EN DESARROLLO ACTIVO',
    hero_open: 'Abrir Astrym Webapp',
    hero_try: 'Probar las versiones ↘',
    hero_code: 'Explorar el código ↗',
    try_kicker: '01 · PRUEBA ASTRYM',
    try_title: 'Elige cómo quieres probarlo',
    try_lede: 'Son tres superficies distintas. La webapp y la PWA usan el preview experimental; la extensión se compila localmente desde el repositorio.',
    web_title: 'Astrym Webapp',
    web_body: 'Abre la wallet en una pestaña del navegador, en formato de aplicación completa. No necesitas instalar una extensión.',
    web_cta: 'Probar Webapp ↗',
    web_note: 'Preview experimental · Stellar Testnet',
    extension_title: 'Extensión de navegador',
    extension_body: 'Prepara la extensión MV3 para Chrome o Chromium. Descarga el código, instala dependencias y genera el paquete localmente.',
    extension_step1: 'Descarga o clona el repositorio.',
    extension_step2: 'Ejecuta <code>pnpm install</code>.',
    extension_step3: 'Ejecuta <code>pnpm --filter @solanym/extension build</code>.',
    extension_step4: 'Carga <code>packages/extension/dist</code> en <code>chrome://extensions</code> con el modo desarrollador.',
    extension_cta: 'Código e instrucciones ↗',
    extension_note: 'No hay todavía un instalador público de Chrome Web Store.',
    android_title: 'Android · PWA',
    android_body: 'Abre la Webapp en Chrome para Android y añádela a la pantalla de inicio. Se instala como PWA; no es un APK nativo.',
    android_step1: 'Abre la Webapp desde tu móvil.',
    android_step2: 'Abre el menú ⋮ de Chrome.',
    android_step3: 'Selecciona «Instalar aplicación» o «Añadir a pantalla de inicio».',
    android_cta: 'Abrir PWA en Android ↗',
    android_note: 'Preview experimental · requiere navegador compatible.',
    hero_install: 'Instalar PWA (Android / iOS)',
    try_warning: 'Aviso: utiliza únicamente una wallet desechable de Stellar Testnet. No introduzcas frases semilla con fondos reales. Estas versiones son experimentales y no están certificadas para producción.',
    status_kicker: '02 · ESTADO HONESTO',
    status_title: 'Investigación, implementación y validación',
    stellar_title: 'Stellar first',
    stellar_body: 'La arquitectura actual prioriza Stellar y el desarrollo controlado sobre Testnet.',
    privacy_title: 'Privacidad de red',
    privacy_body: 'La integración de transporte privado se valida por separado. No se presenta como anonimato garantizado ni como protección universal del tráfico.',
    payments_title: 'Pagos privados',
    payments_body: 'El runtime, los artefactos criptográficos y el flujo extremo a extremo siguen sujetos a validación reproducible antes de anunciar disponibilidad.',
    status_disclaimer: 'Astrym sigue siendo software experimental. Esta página es informativa: no solicita claves ni habilita transacciones. No debe utilizarse con fondos reales.',
    footer_note: 'Software experimental · Solo Stellar Testnet',
    footer_wallet: 'Abrir webapp',
    install_title: 'Instalar en Android / iOS',
    install_body: 'Pulsa el menú ⋮ del navegador → Añadir a pantalla de inicio / Instalar app',
    install_close: 'Entendido',
  },
  en: {
    nav_menu: 'Menu',
    nav_label: 'Main',
    nav_try: 'Try Astrym',
    nav_status: 'Status',
    nav_wallet: 'Open wallet',
    hero_title: 'Privacy, engineered with care.',
    hero_lede: 'Astrym is an experimental self-custody wallet built on Stellar. Explore the available test surfaces and check the actual state of development.',
    hero_status: 'ACTIVE DEVELOPMENT',
    hero_open: 'Open Astrym Webapp',
    hero_try: 'Try the builds ↘',
    hero_code: 'Explore the code ↗',
    try_kicker: '01 · TRY ASTRYM',
    try_title: 'Choose how you want to try it',
    try_lede: 'These are three distinct surfaces. The webapp and PWA use the experimental preview; the browser extension is built locally from the repository.',
    web_title: 'Astrym Webapp',
    web_body: 'Open the wallet in a browser tab as a full-page application. No browser extension required.',
    web_cta: 'Try Webapp ↗',
    web_note: 'Experimental preview · Stellar Testnet',
    extension_title: 'Browser extension',
    extension_body: 'Prepare the MV3 extension for Chrome or Chromium. Download the source, install dependencies and build the package locally.',
    extension_step1: 'Download or clone the repository.',
    extension_step2: 'Run <code>pnpm install</code>.',
    extension_step3: 'Run <code>pnpm --filter @solanym/extension build</code>.',
    extension_step4: 'Load <code>packages/extension/dist</code> in <code>chrome://extensions</code> with Developer mode enabled.',
    extension_cta: 'Source & instructions ↗',
    extension_note: 'There is no public Chrome Web Store installer yet.',
    android_title: 'Android · PWA',
    android_body: 'Open the Webapp in Chrome for Android and add it to your home screen. It installs as a PWA; it is not a native APK.',
    android_step1: 'Open the Webapp on your phone.',
    android_step2: "Open Chrome's ⋮ menu.",
    android_step3: 'Choose “Install app” or “Add to Home screen”.',
    android_cta: 'Open Android PWA ↗',
    android_note: 'Experimental preview · compatible browser required.',
    hero_install: 'Install PWA (Android / iOS)',
    try_warning: 'Important: use only a disposable Stellar Testnet wallet. Never enter a seed phrase holding real funds. These builds are experimental and are not production-certified.',
    status_kicker: '02 · HONEST STATUS',
    status_title: 'Research, implementation and validation',
    stellar_title: 'Stellar first',
    stellar_body: 'The current architecture prioritizes Stellar and controlled development on Testnet.',
    privacy_title: 'Network privacy',
    privacy_body: 'Private transport integration is being validated separately. It is not presented as guaranteed anonymity or universal traffic protection.',
    payments_title: 'Private payments',
    payments_body: 'The runtime, cryptographic artifacts and end-to-end flow still require reproducible validation before availability is announced.',
    status_disclaimer: 'Astrym remains experimental software. This page is informational: it does not request keys or enable transactions. Do not use it with real funds.',
    footer_note: 'Experimental software · Stellar Testnet only',
    footer_wallet: 'Open webapp',
    install_title: 'Install on Android / iOS',
    install_body: 'Open your browser menu ⋮ → Add to Home Screen / Install app',
    install_close: 'Got it',
  },
};

export function resolveInitialLanguage(saved: string | null, navigatorLanguage: string): Language {
  if (saved === 'es' || saved === 'en') return saved;
  if (navigatorLanguage.toLowerCase().startsWith('en')) return 'en';
  return 'es';
}

function pageMeta(language: Language): { title: string; description: string } {
  switch (language) {
    case 'es':
      return {
        title: 'Astrym — Stellar · Privacidad',
        description: 'Astrym — wallet experimental de autocustodia Stellar con opciones de prueba para web, navegador y Android.',
      };
    case 'en':
      return {
        title: 'Astrym — Stellar · Privacy',
        description: 'Astrym — an experimental self-custody Stellar wallet with test builds for web, browser, and Android.',
      };
    default: {
      const unreachable: never = language;
      return unreachable;
    }
  }
}

export function applyLanguage(language: Language): void {
  const dictionary = translations[language];
  document.documentElement.lang = language;
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((element) => {
    const key = element.dataset['i18n'];
    const value = key ? dictionary[key] : undefined;
    if (value === undefined) return;
    if (key && HTML_KEYS.has(key)) element.innerHTML = value;
    else element.textContent = value;
  });
  document.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach((element) => {
    const key = element.dataset['i18nAria'];
    const value = key ? dictionary[key] : undefined;
    if (value !== undefined) element.setAttribute('aria-label', value);
  });
  const meta = pageMeta(language);
  const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  if (description) description.content = meta.description;
  document.title = meta.title;
  document.querySelectorAll<HTMLButtonElement>('[data-language]').forEach((button) => {
    const active = button.dataset['language'] === language;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  try {
    localStorage.setItem('astrym-site-language', language);
  } catch {
    /* Storage may be unavailable. */
  }
}

function readSavedLanguage(): string | null {
  try {
    return localStorage.getItem('astrym-site-language');
  } catch {
    return null;
  }
}

let wired = false;

export function initSiteLanguage(): void {
  const navigatorLanguage = typeof navigator === 'undefined' ? 'es' : navigator.language;
  applyLanguage(resolveInitialLanguage(readSavedLanguage(), navigatorLanguage || 'es'));
  if (wired) return;
  wired = true;
  document.querySelectorAll<HTMLButtonElement>('[data-language]').forEach((button) => {
    button.addEventListener('click', () => {
      const language = button.dataset['language'];
      if (language === 'es' || language === 'en') applyLanguage(language);
    });
  });
  const toggle = document.querySelector<HTMLButtonElement>('[data-nav-toggle]');
  const nav = document.getElementById('site-nav');
  toggle?.addEventListener('click', () => {
    const open = nav?.classList.toggle('is-open') ?? false;
    toggle.setAttribute('aria-expanded', String(open));
  });
  nav?.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      nav.classList.remove('is-open');
      toggle?.setAttribute('aria-expanded', 'false');
    });
  });
}

if (typeof document !== 'undefined') initSiteLanguage();
