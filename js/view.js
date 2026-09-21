export const MODEL_CONFIG = {
  rgb: [
    { key: 'R', label: 'R', min: 0, max: 255, step: 1, unit: '' },
    { key: 'G', label: 'G', min: 0, max: 255, step: 1, unit: '' },
    { key: 'B', label: 'B', min: 0, max: 255, step: 1, unit: '' }
  ],
  xyz: [
    { key: 'X', label: 'X', min: -20, max: 150, step: 0.001, unit: '' },
    { key: 'Y', label: 'Y', min: -20, max: 150, step: 0.001, unit: '' },
    { key: 'Z', label: 'Z', min: -20, max: 150, step: 0.001, unit: '' }
  ],
  hsv: [
    { key: 'H', label: 'H', min: 0, max: 360, step: 0.1, unit: '°' },
    { key: 'S', label: 'S', min: 0, max: 100, step: 0.1, unit: '%' },
    { key: 'V', label: 'V', min: 0, max: 100, step: 0.1, unit: '%' }
  ]
};

export function createChannels(container, model) {
  container.innerHTML = '';
  for (const c of MODEL_CONFIG[model]) {
    const wrapper = document.createElement('div');
    wrapper.className = 'channel';
    wrapper.innerHTML = `
      <div class="channel-top">
        <div>
          <span class="channel-name">${c.label}</span>
          <span class="channel-range">${c.min}…${c.max}${c.unit}</span>
        </div>
        <input class="number-input" data-model="${model}" data-channel="${c.key}" type="number"
          min="${c.min}" max="${c.max}" step="${c.step}" aria-label="${model} ${c.key}">
      </div>
      <input class="range" data-model="${model}" data-channel="${c.key}" type="range"
        min="${c.min}" max="${c.max}" step="${c.step}" aria-label="Ползунок ${model} ${c.key}">
    `;
    container.appendChild(wrapper);
  }
}

export function setModelValues(model, values) {
  MODEL_CONFIG[model].forEach((c, i) => {
    document.querySelector(`input.number-input[data-model="${model}"][data-channel="${c.key}"]`).value = formatInput(values[i], c.step);
    document.querySelector(`input.range[data-model="${model}"][data-channel="${c.key}"]`).value = values[i];
  });
}

function formatInput(value, step) {
  return step < 1 ? Number(value).toFixed(step === 0.001 ? 3 : 1) : Math.round(value);
}

export function setRangeGradients(model, gradients) {
  MODEL_CONFIG[model].forEach((c, i) => {
    const input = document.querySelector(`input.range[data-model="${model}"][data-channel="${c.key}"]`);
    if (!input || !gradients[i]?.length) return;
    const stops = gradients[i].map((color, index) => {
      const percent = (index / (gradients[i].length - 1)) * 100;
      return `${color} ${percent}%`;
    }).join(', ');
    input.style.background = `linear-gradient(90deg, ${stops})`;
  });
}

export function updatePicker(id, hex) {
  document.getElementById(id).value = hex;
}

export function setPreview(hex) {
  document.getElementById('mainPreview').style.background = hex;
  document.getElementById('headerPreview').style.background = hex;
  document.getElementById('hexValue').textContent = hex;
  document.getElementById('rgbSummary').textContent = `RGB ${hexToRgb(hex).join(', ')}`;
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function setStatus(message, warning = false) {
  const text = document.getElementById('statusText');
  const dot = document.querySelector('.toolbar-info .dot');
  text.textContent = message;
  dot.classList.toggle('warn', warning);
}

export function setMatrices(forward, inverse) {
  document.getElementById('matrixForward').textContent = forward;
  document.getElementById('matrixInverse').textContent = inverse;
}

export function setWhitePoint(name) {
  document.getElementById('whitePoint').textContent = name;
}
