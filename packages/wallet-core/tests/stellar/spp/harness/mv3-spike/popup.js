import { BROKER_V, mintRequestId } from './broker/envelope.mjs';

const out = document.getElementById('out');
const sessionId = `popup-${chrome.runtime.id}`;

function show(v) {
  out.textContent = JSON.stringify(v, null, 2);
}

function send(type, extra = {}) {
  const msg = {
    v: BROKER_V,
    kind: 'req',
    sessionId,
    requestId: mintRequestId(type),
    type,
    ...extra,
  };
  chrome.runtime.sendMessage(msg, show);
}

document.getElementById('open').addEventListener('click', () => send('RO1_OPEN_HOST'));
document.getElementById('ping').addEventListener('click', () => send('RO1_PING'));
document.getElementById('close').addEventListener('click', () => send('RO1_EMERGENCY_CLOSE'));
document.getElementById('bad').addEventListener('click', () => {
  chrome.runtime.sendMessage(
    { v: 1, kind: 'req', sessionId, requestId: mintRequestId('bad'), type: 'HACK_SYNC', args: {} },
    show,
  );
});
