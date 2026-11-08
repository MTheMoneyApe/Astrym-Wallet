const translations = {
  es: {
    nav_try:"Probar Astrym",nav_status:"Estado",
    hero_title:"Privacidad con ingeniería cuidadosa.",
    hero_lede:"Astrym es una wallet experimental de autocustodia construida sobre Stellar. Puedes explorar las distintas superficies de prueba y consultar el estado real del desarrollo.",
    hero_status:"EN DESARROLLO ACTIVO",hero_try:"Probar las versiones ↘",hero_code:"Explorar el código ↗",
    try_kicker:"01 · PRUEBA ASTRYM",try_title:"Elige cómo quieres probarlo",
    try_lede:"Son tres superficies distintas. La webapp y la PWA usan el preview experimental; la extensión se compila localmente desde el repositorio.",
    web_title:"Astrym Webapp",web_body:"Abre la wallet en una pestaña del navegador, en formato de aplicación completa. No necesitas instalar una extensión.",web_cta:"Probar Webapp ↗",web_note:"Preview experimental · Stellar Testnet",
    extension_title:"Extensión de navegador",extension_body:"Prepara la extensión MV3 para Chrome o Chromium. Descarga el código, instala dependencias y genera el paquete localmente.",
    extension_step1:"Descarga o clona el repositorio.",
    extension_step2:"Ejecuta <code>pnpm install</code>.",
    extension_step3:"Ejecuta <code>pnpm --filter @solanym/extension build</code>.",
    extension_step4:"Carga <code>packages/extension/dist</code> en <code>chrome://extensions</code> con el modo desarrollador.",
    extension_cta:"Código e instrucciones ↗",extension_note:"No hay todavía un instalador público de Chrome Web Store.",
    android_title:"Android · PWA",android_body:"Abre la Webapp en Chrome para Android y añádela a la pantalla de inicio. Se instala como PWA; no es un APK nativo.",
    android_step1:"Abre la Webapp desde tu móvil.",android_step2:"Abre el menú ⋮ de Chrome.",android_step3:"Selecciona «Instalar aplicación» o «Añadir a pantalla de inicio».",
    android_cta:"Abrir PWA en Android ↗",android_note:"Preview experimental · requiere navegador compatible.",
    try_warning:"Aviso: utiliza únicamente una wallet desechable de Stellar Testnet. No introduzcas frases semilla con fondos reales. Estas versiones son experimentales y no están certificadas para producción.",
    status_kicker:"02 · ESTADO HONESTO",status_title:"Investigación, implementación y validación",
    stellar_title:"Stellar first",stellar_body:"La arquitectura actual prioriza Stellar y el desarrollo controlado sobre Testnet.",
    privacy_title:"Privacidad de red",privacy_body:"La integración de transporte privado se valida por separado. No se presenta como anonimato garantizado ni como protección universal del tráfico.",
    payments_title:"Pagos privados",payments_body:"El runtime, los artefactos criptográficos y el flujo extremo a extremo siguen sujetos a validación reproducible antes de anunciar disponibilidad.",
    status_disclaimer:"Astrym sigue siendo software experimental. Esta página es informativa: no solicita claves ni habilita transacciones. No debe utilizarse con fondos reales.",
    footer_note:"Software experimental · Solo Stellar Testnet"
  },
  en: {
    nav_try:"Try Astrym",nav_status:"Status",
    hero_title:"Privacy, engineered with care.",
    hero_lede:"Astrym is an experimental self-custody wallet built on Stellar. Explore the available test surfaces and check the actual state of development.",
    hero_status:"ACTIVE DEVELOPMENT",hero_try:"Try the builds ↘",hero_code:"Explore the code ↗",
    try_kicker:"01 · TRY ASTRYM",try_title:"Choose how you want to try it",
    try_lede:"These are three distinct surfaces. The webapp and PWA use the experimental preview; the browser extension is built locally from the repository.",
    web_title:"Astrym Webapp",web_body:"Open the wallet in a browser tab as a full-page application. No browser extension required.",web_cta:"Try Webapp ↗",web_note:"Experimental preview · Stellar Testnet",
    extension_title:"Browser extension",extension_body:"Prepare the MV3 extension for Chrome or Chromium. Download the source, install dependencies and build the package locally.",
    extension_step1:"Download or clone the repository.",
    extension_step2:"Run <code>pnpm install</code>.",
    extension_step3:"Run <code>pnpm --filter @solanym/extension build</code>.",
    extension_step4:"Load <code>packages/extension/dist</code> in <code>chrome://extensions</code> with Developer mode enabled.",
    extension_cta:"Source & instructions ↗",extension_note:"There is no public Chrome Web Store installer yet.",
    android_title:"Android · PWA",android_body:"Open the Webapp in Chrome for Android and add it to your home screen. It installs as a PWA; it is not a native APK.",
    android_step1:"Open the Webapp on your phone.",android_step2:"Open Chrome's ⋮ menu.",android_step3:"Choose “Install app” or “Add to Home screen”.",
    android_cta:"Open Android PWA ↗",android_note:"Experimental preview · compatible browser required.",
    try_warning:"Important: use only a disposable Stellar Testnet wallet. Never enter a seed phrase holding real funds. These builds are experimental and are not production-certified.",
    status_kicker:"02 · HONEST STATUS",status_title:"Research, implementation and validation",
    stellar_title:"Stellar first",stellar_body:"The current architecture prioritizes Stellar and controlled development on Testnet.",
    privacy_title:"Network privacy",privacy_body:"Private transport integration is being validated separately. It is not presented as guaranteed anonymity or universal traffic protection.",
    payments_title:"Private payments",payments_body:"The runtime, cryptographic artifacts and end-to-end flow still require reproducible validation before availability is announced.",
    status_disclaimer:"Astrym remains experimental software. This page is informational: it does not request keys or enable transactions. Do not use it with real funds.",
    footer_note:"Experimental software · Stellar Testnet only"
  }
};
function setLanguage(language) {
  const selected = translations[language] ? language : "es";
  document.documentElement.lang = selected;
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    const key = element.getAttribute("data-i18n");
    const value = key ? translations[selected][key] : null;
    if (!value) return;
    if (["extension_step2","extension_step3","extension_step4"].includes(key)) element.innerHTML = value;
    else element.textContent = value;
  });
  document.querySelectorAll("[data-language]").forEach((button) => {
    const active = button.getAttribute("data-language") === selected;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  try { localStorage.setItem("astrym-site-language", selected); } catch {}
}
document.querySelectorAll("[data-language]").forEach((button) => {
  button.addEventListener("click", () => setLanguage(button.getAttribute("data-language")));
});
let initial = "es";
try {
  const saved = localStorage.getItem("astrym-site-language");
  if (saved === "es" || saved === "en") initial = saved;
  else if (navigator.language.toLowerCase().startsWith("en")) initial = "en";
} catch {}
setLanguage(initial);