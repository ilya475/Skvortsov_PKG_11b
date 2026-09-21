import {
  ILLUMINANTS,
  calculateFromHsv,
  calculateFromRgb,
  calculateFromXyz,
  hexFromRgb,
  matrixToText,
  round
} from './model.js';
import { createChannels, setMatrices, setModelValues, setPreview, setStatus, updatePicker } from './view.js';

const state = {
  source: 'rgb',
  illuminant: 'D65',
  gamutStrategy: 'clipping',
  rgb: [255, 0, 0],
  xyz: [41.2453, 21.2627, 1.9334],
  hsv: [0, 100, 100]
};

const presets = [
  '#FF0000','#00FF00','#0000FF','#00FFFF','#FF00FF','#FFFF00','#000000','#FFFFFF',
  '#808080','#FF8000','#8000FF','#008080','#800000','#008000','#000080','#FFD1DC',
  '#F5F5DC','#A52A2A','#F4A460','#FFD700','#4B0082','#EE82EE','#00A86B','#1E90FF',
  '#FF6B6B','#6BCB77','#4D96FF','#845EC2','#FFC75F','#F9F871','#2C3E50','#E67E22',
  '#16A085','#2980B9','#8E44AD','#C0392B','#D35400','#27AE60','#2ECC71','#3498DB',
  '#9B59B6','#34495E','#F1C40F','#E74C3C','#1ABC9C','#ECF0F1','#95A5A6','#2D3436'
];

function setup() {
  createChannels(document.getElementById('rgbChannels'), 'rgb');
  createChannels(document.getElementById('xyzChannels'), 'xyz');
  createChannels(document.getElementById('hsvChannels'), 'hsv');
  buildPalette();
  bindEvents();
  recalculate('rgb', state.rgb);
}

function buildPalette() {
  const container = document.getElementById('swatches');
  container.innerHTML = '';
  presets.forEach(hex => {
    const button = document.createElement('button');
    button.className = 'swatch';
    button.style.background = hex;
    button.title = hex;
    button.setAttribute('aria-label', `Выбрать ${hex}`);
    button.addEventListener('click', () => recalculate('rgb', hexToRgb(hex)));
    container.appendChild(button);
  });
}

function bindEvents() {
  document.getElementById('illuminant').addEventListener('change', e => {
    state.illuminant = e.target.value;
    // Same current RGB is the stable physical colour representation for recalculation.
    recalculate('rgb', state.rgb);
  });

  document.getElementById('gamutStrategy').addEventListener('change', e => {
    state.gamutStrategy = e.target.value;
    // Re-run from the last source so a strategy change is visible immediately.
    recalculate(state.source, state[state.source]);
  });

  document.querySelectorAll('input.number-input, input.range').forEach(input => {
    input.addEventListener('input', e => {
      const model = e.target.dataset.model;
      const channel = e.target.dataset.channel;
      const config = { rgb: ['R','G','B'], xyz: ['X','Y','Z'], hsv: ['H','S','V'] }[model];
      const values = state[model].slice();
      values[config.indexOf(channel)] = Number(e.target.value);
      recalculate(model, values);
    });
  });

  document.querySelectorAll('.model-color-picker').forEach(picker => {
    picker.addEventListener('input', e => recalculate('rgb', hexToRgb(e.target.value)));
  });

  document.querySelectorAll('.reset-model').forEach(button => {
    button.addEventListener('click', () => {
      const model = button.dataset.reset;
      const defaults = { rgb: [255, 0, 0], xyz: [41.2453, 21.2627, 1.9334], hsv: [0, 100, 100] };
      recalculate(model, defaults[model]);
    });
  });
}

function recalculate(source, values) {
  state.source = source;
  let result;
  if (source === 'rgb') result = calculateFromRgb(values, state.illuminant, state.gamutStrategy);
  if (source === 'xyz') result = calculateFromXyz(values, state.illuminant, state.gamutStrategy);
  if (source === 'hsv') result = calculateFromHsv(values, state.illuminant, state.gamutStrategy);

  state.rgb = result.rgb.slice();
  state.xyz = result.xyz.slice();
  state.hsv = result.hsv.slice();

  setModelValues('rgb', state.rgb);
  setModelValues('xyz', state.xyz);
  setModelValues('hsv', state.hsv);

  const hex = hexFromRgb(state.rgb);
  setPreview(hex);
  updatePicker('pickerRgb', hex);
  updatePicker('pickerXyz', hex);
  updatePicker('pickerHsv', hex);
  setWhitePoint(state.illuminant);
  setMatrices(matrixToText(result.matrix), matrixToText(result.inverseMatrix));

  if (result.gamut?.outOfGamut) {
    const method = state.gamutStrategy === 'clipping' ? 'Clipping' : 'Scaling';
    setStatus(`XYZ → RGB вышел за границы [0;255]. Применено: ${method}.`, true);
  } else {
    setStatus(`Пересчёт выполнен: ${source.toUpperCase()} → XYZ → HSV / обратно по цепочке варианта 8.`, false);
  }
}

function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  const n = parseInt(clean, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Expose a tiny read-only API for the browser micro-tests.
window.__lab8 = { state, recalculate };

setup();
