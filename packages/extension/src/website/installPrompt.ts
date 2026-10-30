/**
 * Android install affordance for the Astrym landing page.
 * Uses the browser prompt when Chrome/Brave offers it. Otherwise explains
 * the one-tap system menu path.
 */

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

let deferred: BeforeInstallPromptEvent | null = null;

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferred = event as BeforeInstallPromptEvent;
});

const button = document.getElementById('install-pwa');
const modal = document.getElementById('install-modal');

button?.addEventListener('click', () => {
  if (!deferred) {
    if (modal instanceof HTMLDialogElement) modal.showModal();
    return;
  }
  const prompt = deferred;
  deferred = null;
  void prompt.prompt().then(() => prompt.userChoice);
});
