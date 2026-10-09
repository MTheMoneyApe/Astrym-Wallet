import browser from 'webextension-polyfill';

// Inject the provider script into the page
const script = document.createElement('script');
script.src = browser.runtime.getURL('provider.js'); // Assuming vite builds it to provider.js
script.onload = () => script.remove();
(document.head || document.documentElement).appendChild(script);

// Listen for messages from the provider (page context) and forward them to background
window.addEventListener('message', async (event) => {
  // Only accept messages from the same window and from our provider
  if (event.source !== window || !event.data || event.data.source !== 'solanym-provider') {
    return;
  }

  try {
    // Forward to background
    const response = await browser.runtime.sendMessage(event.data.message);
    
    // Send response back to provider
    window.postMessage({
      source: 'solanym-content',
      message: response
    }, window.location.origin);
  } catch (error: any) {
    // Handle message passing errors (e.g. extension context invalidated)
    window.postMessage({
      source: 'solanym-content',
      message: {
        id: event.data.message.id,
        type: 'ERROR',
        error: { name: 'ContentScriptError', message: error.message }
      }
    }, window.location.origin);
  }
});
