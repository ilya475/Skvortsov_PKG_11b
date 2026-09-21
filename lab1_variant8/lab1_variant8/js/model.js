/*
 * Model: pure colour mathematics for laboratory work, variant 8.
 * Route is STRICTLY: RGB <-> XYZ <-> HSV.
 * No conversion library is used.
 */

export const ILLUMINANTS = {
  D65: { name: 'D65 — средний дневной свет', x: 0.3127, y: 0.3290 },
  D50: { name: 'D50 — тёплый дневной свет', x: 0.3457, y: 0.3585 },
  E:   { name: 'E — равноэнергетический источник', x: 1 / 3, y: 1 / 3 }
};

// sRGB primaries; the transformation matrix itself is recalculated from them
// and the selected illuminant white point every time the illuminant changes.
const PRIMARIES = {
  R: { x: 0.64, y: 0.33 },
  G: { x: 0.30, y: 0.60 },
  B: { x: 0.15, y: 0.06 }
};

const EPSILON = 0.008856;
const KAPPA = 7.787;

export function clamp(v, min = 0, max = 1) {
  return Math.min(max, Math.max(min, v));
}

export function round(v, digits = 4) {
  const p = 10 ** digits;
  return Math.round(v * p) / p;
}

export function multiplyMatrixVector(m, v) {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]
  ];
}

export function invert3x3(m) {
  const [a, b, c] = m[0];
  const [d, e, f] = m[1];
  const [g, h, i] = m[2];
  const A = e * i - f * h;
  const B = c * h - b * i;
  const C = b * f - c * e;
  const D = f * g - d * i;
  const E = a * i - c * g;
  const F = c * d - a * f;
  const G = d * h - e * g;
  const H = b * g - a * h;
  const I = a * e - b * d;
  const det = a * A + b * D + c * G;
  if (Math.abs(det) < 1e-12) throw new Error('Матрица вырождена.');
  return [
    [A / det, B / det, C / det],
    [D / det, E / det, F / det],
    [G / det, H / det, I / det]
  ];
}

function whitePointXYZ(illuminant) {
  // D65 white point is given explicitly in the supplied formula sheet.
  if (illuminant === ILLUMINANTS.D65) return [95.047, 100, 108.883];
  const { x, y } = illuminant;
  return [100 * x / y, 100, 100 * (1 - x - y) / y];
}

/** Build RGB->XYZ matrix from RGB primaries and the current white point. */
export function buildRgbToXyzMatrix(illuminantKey = 'D65') {
  const illuminant = ILLUMINANTS[illuminantKey] ?? ILLUMINANTS.D65;
  const p = [
    [PRIMARIES.R.x / PRIMARIES.R.y, 1, (1 - PRIMARIES.R.x - PRIMARIES.R.y) / PRIMARIES.R.y],
    [PRIMARIES.G.x / PRIMARIES.G.y, 1, (1 - PRIMARIES.G.x - PRIMARIES.G.y) / PRIMARIES.G.y],
    [PRIMARIES.B.x / PRIMARIES.B.y, 1, (1 - PRIMARIES.B.x - PRIMARIES.B.y) / PRIMARIES.B.y]
  ];
  // P is arranged as rows in the code, so transpose it to get primary columns.
  const P = [
    [p[0][0], p[1][0], p[2][0]],
    [p[0][1], p[1][1], p[2][1]],
    [p[0][2], p[1][2], p[2][2]]
  ];
  const scales = multiplyMatrixVector(invert3x3(P), whitePointXYZ(illuminant).map(v => v / 100));
  return [
    [P[0][0] * scales[0], P[0][1] * scales[1], P[0][2] * scales[2]],
    [P[1][0] * scales[0], P[1][1] * scales[1], P[1][2] * scales[2]],
    [P[2][0] * scales[0], P[2][1] * scales[1], P[2][2] * scales[2]]
  ];
}

export function buildXyzToRgbMatrix(illuminantKey = 'D65') {
  return invert3x3(buildRgbToXyzMatrix(illuminantKey));
}

// Formula from the supplied PDF for RGB -> XYZ: sRGB gamma decoding.
export function gammaDecode(v255) {
  const x = v255 / 255;
  return x >= 0.04045 ? ((x + 0.055) / 1.055) ** 2.4 : x / 12.92;
}

// Formula from the supplied PDF for XYZ -> RGB: sRGB gamma encoding.
export function gammaEncode(linear) {
  const x = linear;
  return x >= 0.0031308 ? 1.055 * (x ** (1 / 2.4)) - 0.055 : 12.92 * x;
}

export function rgbToXyz(rgb, illuminantKey = 'D65') {
  const linear = rgb.map(gammaDecode);
  const matrix = buildRgbToXyzMatrix(illuminantKey);
  const xyz01 = multiplyMatrixVector(matrix, linear);
  return xyz01.map(v => v * 100);
}

function scaleIntoGamut(values) {
  let out = values.slice();
  const min = Math.min(...out);
  const max = Math.max(...out);
  if (min < 0 || max > 1) {
    if (max === min) out = [0, 0, 0];
    else out = out.map(v => (v - min) / (max - min));
  }
  return out.map(v => clamp(v));
}

export function xyzToRgb(xyz, illuminantKey = 'D65', strategy = 'clipping') {
  const matrix = buildXyzToRgbMatrix(illuminantKey);
  const linear = multiplyMatrixVector(matrix, xyz.map(v => v / 100));
  const outOfGamut = linear.some(v => v < 0 || v > 1);
  const prepared = strategy === 'scaling' ? scaleIntoGamut(linear) : linear.map(v => clamp(v));
  const rgb = prepared.map(v => clamp(gammaEncode(Math.max(0, v))) * 255);
  return { rgb, linear, outOfGamut };
}

// HSV algorithm follows the supplied flowchart: V=max(R,G,B), M2 branch,
// S=0 branch, then six hue sectors.
export function rgbToHsv(rgb) {
  const [r, g, b] = rgb.map(v => clamp(v / 255));
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const v = max;
  if (d === 0) return [0, 0, v * 100];
  const s = max === 0 ? 0 : d / max;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return [h, s * 100, v * 100];
}

export function hsvToRgb(hsv) {
  let [h, s, v] = hsv;
  h = ((h % 360) + 360) % 360;
  s = clamp(s / 100);
  v = clamp(v / 100);
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let rgb01;
  if (s === 0) rgb01 = [v, v, v];
  else if (h < 60) rgb01 = [c, x, 0];
  else if (h < 120) rgb01 = [x, c, 0];
  else if (h < 180) rgb01 = [0, c, x];
  else if (h < 240) rgb01 = [0, x, c];
  else if (h < 300) rgb01 = [x, 0, c];
  else rgb01 = [c, 0, x];
  return rgb01.map(vv => (vv + m) * 255);
}

export function formatRgb(rgb) {
  return rgb.map(v => Math.round(clamp(v, 0, 255)));
}

export function hexFromRgb(rgb) {
  return '#' + formatRgb(rgb).map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function matrixToText(m) {
  return m.map(row => row.map(v => v.toFixed(6)).join('  ')).join('\n');
}


// Direct XYZ ↔ HSV equations for this assignment. The equations inline the
// XYZ↔linear-RGB matrix and sRGB gamma functions instead of calling another
// colour-model conversion function as a hidden intermediary.
export function xyzToHsv(xyz, illuminantKey = 'D65') {
  const linear = multiplyMatrixVector(buildXyzToRgbMatrix(illuminantKey), xyz.map(v => v / 100));
  const encoded = linear.map(v => clamp(gammaEncode(Math.max(0, v))));
  const [r, g, b] = encoded;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return [0, 0, max * 100];
  const s = max === 0 ? 0 : d / max;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return [h, s * 100, max * 100];
}

export function hsvToXyz(hsv, illuminantKey = 'D65') {
  let [h, s, v] = hsv;
  h = ((h % 360) + 360) % 360;
  s = clamp(s / 100);
  v = clamp(v / 100);
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let encoded;
  if (s === 0) encoded = [v, v, v];
  else if (h < 60) encoded = [c, x, 0].map(q => q + m);
  else if (h < 120) encoded = [x, c, 0].map(q => q + m);
  else if (h < 180) encoded = [0, c, x].map(q => q + m);
  else if (h < 240) encoded = [0, x, c].map(q => q + m);
  else if (h < 300) encoded = [x, 0, c].map(q => q + m);
  else encoded = [c, 0, x].map(q => q + m);
  const linear = encoded.map(v => gammaDecode(v * 255));
  return multiplyMatrixVector(buildRgbToXyzMatrix(illuminantKey), linear).map(q => q * 100);
}

export function calculateFromRgb(rgb, illuminant, strategy) {
  const xyz = rgbToXyz(rgb, illuminant);
  const hsv = xyzToHsv(xyz, illuminant);
  return { rgb: formatRgb(rgb), xyz, hsv, hex: hexFromRgb(rgb), matrix: buildRgbToXyzMatrix(illuminant), inverseMatrix: buildXyzToRgbMatrix(illuminant), gamut: null };
}

export function calculateFromXyz(xyz, illuminant, strategy) {
  const converted = xyzToRgb(xyz, illuminant, strategy);
  const rgb = converted.rgb;
  const hsv = xyzToHsv(xyz, illuminant);
  return { rgb: formatRgb(rgb), xyz, hsv, hex: hexFromRgb(rgb), matrix: buildRgbToXyzMatrix(illuminant), inverseMatrix: buildXyzToRgbMatrix(illuminant), gamut: converted };
}

export function calculateFromHsv(hsv, illuminant, strategy) {
  const xyz = hsvToXyz(hsv, illuminant);
  const converted = xyzToRgb(xyz, illuminant, strategy);
  const rgb = converted.rgb;
  return { rgb: formatRgb(rgb), xyz, hsv, matrix: buildRgbToXyzMatrix(illuminant), inverseMatrix: buildXyzToRgbMatrix(illuminant), gamut: converted };
}

/* Legacy RGB/HSV helpers remain available for unit tests and the palette. */
export function calculateFromHsvLegacy(hsv, illuminant, strategy) {
  const rgb = hsvToRgb(hsv);
  const xyz = rgbToXyz(rgb, illuminant);
  return { rgb: formatRgb(rgb), xyz, hsv, hex: hexFromRgb(rgb), matrix: buildRgbToXyzMatrix(illuminant), inverseMatrix: buildXyzToRgbMatrix(illuminant), gamut: null };
}

export function nearlyEqual(a, b, eps = 1e-3) {
  return Math.abs(a - b) <= eps;
}
