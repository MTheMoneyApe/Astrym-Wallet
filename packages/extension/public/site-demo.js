// Educational UI only: never contacts a provider, wallet, signer or network.
const form = document.getElementById('transfer-demo');
if (form) {
  const amount = document.getElementById('demo-amount');
  const total = document.getElementById('demo-total');
  const error = document.getElementById('demo-error');
  const approved = document.getElementById('demo-approved');
  const direct = document.getElementById('demo-direct');
  const nym = document.getElementById('demo-nym');
  const submit = form.querySelector('button[type="submit"]');
  const scale = 10000000n, fee = 100n, balance = 1250n * scale;
  function calculate() {
    const value = amount.value.trim().replace(',', '.');
    if (!/^\d+(?:\.\d{1,7})?$/.test(value)) return null;
    const [whole, fraction = ''] = value.split('.');
    const units = BigInt(whole) * scale + BigInt(fraction.padEnd(7, '0'));
    return units > 0n && units + fee <= balance ? units + fee : null;
  }
  function update() {
    const units = calculate();
    const valid = units !== null;
    total.textContent = valid ? String(units / scale) + '.' + String(units % scale).padStart(7,'0') + ' XLM' : '—';
    error.hidden = valid;
    amount.setAttribute('aria-invalid', String(!valid));
    submit.disabled = !valid;
    approved.hidden = true;
    const privateMode = form.elements.namedItem('demo-mode').value === 'nym';
    direct.hidden = privateMode;
    nym.hidden = !privateMode;
    return valid;
  }
  form.addEventListener('input', update);
  form.addEventListener('change', update);
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (update()) approved.hidden = false;
  });
  update();
}
