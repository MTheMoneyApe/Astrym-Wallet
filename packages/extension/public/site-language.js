// Local, dependency-free site translations; no wallet storage or network access.
const nodes = [...document.querySelectorAll('[data-en]')];
const original = new Map(nodes.map(node => [node, node.tagName === 'META' ? node.content : node.textContent]));
const buttons = [...document.querySelectorAll('[data-language]')];
function setLanguage(lang) {
  document.documentElement.lang = lang;
  for (const node of nodes) {
    const value = lang === 'en' ? node.dataset.en : original.get(node);
    if (node.tagName === 'META') node.content = value;
    else node.textContent = value;
  }
  for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.language === lang));
  try { localStorage.setItem('astrym-site-language', lang); } catch {}
}
let lang = 'es';
try { const saved = localStorage.getItem('astrym-site-language'); if (saved === 'es' || saved === 'en') lang = saved; else if (navigator.language.startsWith('en')) lang = 'en'; } catch {}
buttons.forEach(button => button.addEventListener('click', () => setLanguage(button.dataset.language)));
setLanguage(lang);
document.addEventListener('click', event => { for (const menu of document.querySelectorAll('.nav details[open]')) if (!menu.contains(event.target)) menu.open = false; });
document.addEventListener('keydown', event => { if (event.key === 'Escape') for (const menu of document.querySelectorAll('.nav details[open]')) { menu.open = false; menu.querySelector('summary')?.focus(); } });
