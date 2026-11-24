/** Processing Layer: six selected algorithms, implemented without image-filter libraries. */
import {clampByte, mapIndex, histogram} from './pixels.js';

export const LOCAL_METHODS = new Set(['local-mean', 'niblack', 'sauvola']);

export function linearContrast(gray, lowPercent = 2, highPercent = 98) {
  if (!(lowPercent >= 0 && highPercent <= 100 && lowPercent < highPercent)) throw Error('Неверные процентили');
  const hist = histogram(gray), total = gray.length;
  const percentile = q => {
    const cutoff = Math.max(1, Math.ceil(q * total));
    let count = 0;
    for (let t = 0; t < 256; t++) { count += hist[t]; if (count >= cutoff) return t; }
    return 255;
  };
  const a = percentile(lowPercent / 100), b = percentile(highPercent / 100);
  const out = new Uint8ClampedArray(total);
  if (b <= a) out.set(gray);
  else for (let i = 0; i < total; i++) out[i] = clampByte(255 * (gray[i] - a) / (b - a));
  return {gray: out, info: {low: a, high: b}};
}

export function otsu(gray) {
  const hist = histogram(gray), n = gray.length;
  let total = 0;
  for (let t = 0; t < 256; t++) total += t * hist[t];
  let n0 = 0, sum0 = 0, maxVariance = -1, best = 0;
  for (let t = 0; t < 256; t++) {
    n0 += hist[t]; sum0 += t * hist[t];
    const n1 = n - n0;
    if (!n0 || !n1) continue;
    const m0 = sum0 / n0, m1 = (total - sum0) / n1;
    const variance = (n0 / n) * (n1 / n) * (m0 - m1) ** 2;
    if (variance > maxVariance) { maxVariance = variance; best = t; }
  }
  // If only one class exists, no between-class variance can be defined.
  if (maxVariance < 0) best = gray[0];
  const out = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) out[i] = gray[i] <= best ? 0 : 255;
  return {gray: out, info: {threshold: best, variance: Math.max(0, maxVariance)}};
}

/** Build a padded stripe, applying Reflect-101 or Clamp to both axes. */
export function paddedStripe(gray, width, height, startRow, endRow, radius, border) {
  const tileW = width + 2 * radius, tileH = endRow - startRow + 2 * radius;
  const tile = new Uint8ClampedArray(tileW * tileH);
  for (let y = 0; y < tileH; y++) {
    const sy = mapIndex(startRow + y - radius, height, border);
    for (let x = 0; x < tileW; x++) {
      const sx = mapIndex(x - radius, width, border);
      tile[y * tileW + x] = gray[sy * width + sx];
    }
  }
  return {tile, tileW, tileH};
}

/** SAT and SAT of squares, computed on full padded stripe (Float64 prevents overflow). */
export function integralTables(gray, width, height) {
  const stride = width + 1;
  const sum = new Float64Array(stride * (height + 1));
  const square = new Float64Array(stride * (height + 1));
  for (let y = 1; y <= height; y++) {
    let rowSum = 0, rowSquare = 0;
    for (let x = 1; x <= width; x++) {
      const v = gray[(y - 1) * width + x - 1];
      rowSum += v; rowSquare += v * v;
      const p = y * stride + x;
      sum[p] = sum[p - stride] + rowSum;
      square[p] = square[p - stride] + rowSquare;
    }
  }
  return {stride, sum, square};
}

export function rectangleSum(table, stride, x0, y0, x1, y1) {
  return table[y1 * stride + x1] - table[y0 * stride + x1]
    - table[y1 * stride + x0] + table[y0 * stride + x0];
}

/** Sliding-window threshold, with O(1) statistics per output pixel after O(N) SAT. */
export function localThreshold(gray, width, height, mode, params = {}, startRow = 0, endRow = height) {
  if (!LOCAL_METHODS.has(mode)) throw Error('Неизвестный локальный метод');
  if (gray.length !== width * height) throw Error('Неверный размер исходных данных');
  if (startRow < 0 || endRow > height || startRow >= endRow) throw Error('Неверные границы полосы');
  const windowSize = params.windowSize ?? 21;
  if (!Number.isInteger(windowSize) || windowSize < 3 || windowSize % 2 !== 1) throw Error('Окно должно быть нечётным >=3');
  const k = params.k ?? (mode === 'sauvola' ? .34 : -.2), R = params.R ?? 128;
  if (mode === 'sauvola' && R <= 0) throw Error('R должен быть > 0');
  const border = params.borderMode ?? 'reflect', r = (windowSize - 1) / 2;
  const {tile, tileW, tileH} = paddedStripe(gray, width, height, startRow, endRow, r, border);
  const {sum, square, stride} = integralTables(tile, tileW, tileH);
  const out = new Uint8ClampedArray(width * (endRow - startRow));
  const area = windowSize * windowSize;
  for (let yy = 0; yy < endRow - startRow; yy++) {
    for (let x = 0; x < width; x++) {
      const mean = rectangleSum(sum, stride, x, yy, x + windowSize, yy + windowSize) / area;
      const s2 = rectangleSum(square, stride, x, yy, x + windowSize, yy + windowSize) / area;
      const sd = Math.sqrt(Math.max(0, s2 - mean * mean));
      const threshold = mode === 'local-mean' ? mean : mode === 'niblack'
        ? mean + k * sd : mean * (1 + k * (sd / R - 1));
      const srcIndex = (startRow + yy) * width + x;
      out[yy * width + x] = gray[srcIndex] <= threshold ? 0 : 255;
    }
  }
  return {gray: out, info: {windowSize, k, R, borderMode: border, startRow, endRow}};
}

/** CLAHE: clipped histograms per tile, distributed overflow, bilinear interpolation. */
export function clahe(gray, width, height, tiles = 8, clipLimit = 2) {
  tiles = Math.max(2, Math.min(12, Math.round(tiles)));
  clipLimit = Math.max(.5, Number(clipLimit));
  const tileW = Math.ceil(width / tiles), tileH = Math.ceil(height / tiles);
  const nx = Math.ceil(width / tileW), ny = Math.ceil(height / tileH);
  const lookup = Array.from({length: nx * ny}, () => new Uint8ClampedArray(256));
  for (let ty = 0; ty < ny; ty++) for (let tx = 0; tx < nx; tx++) {
    const x0 = tx * tileW, x1 = Math.min(width, x0 + tileW);
    const y0 = ty * tileH, y1 = Math.min(height, y0 + tileH), area = (x1 - x0) * (y1 - y0);
    const hist = new Int32Array(256);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) hist[gray[y * width + x]]++;
    // Constant tiles should not create artificial contrast.
    let usedLevels = 0;
    for (let i = 0; i < 256; i++) if (hist[i]) usedLevels++;
    if (usedLevels <= 1) {
      const lut = lookup[ty * nx + tx];
      for (let i = 0; i < 256; i++) lut[i] = i;
      continue;
    }
    const limit = Math.max(1, Math.floor(clipLimit * area / 256));
    let extra = 0;
    for (let i = 0; i < 256; i++) if (hist[i] > limit) { extra += hist[i] - limit; hist[i] = limit; }
    const add = Math.floor(extra / 256), rem = extra % 256;
    for (let i = 0; i < 256; i++) hist[i] += add;
    for (let i = 0; i < rem; i++) hist[Math.floor((i + .5) * 256 / rem)]++;
    let accum = 0, first = 0, found = false;
    const lut = lookup[ty * nx + tx];
    for (let i = 0; i < 256; i++) {
      accum += hist[i];
      if (!found && hist[i] !== 0) { first = accum; found = true; }
      lut[i] = area <= first ? i : clampByte((accum - first) * 255 / (area - first));
    }
  }
  const out = new Uint8ClampedArray(gray.length);
  for (let y = 0; y < height; y++) {
    const gy = (y + .5) / tileH - .5;
    const ya = Math.max(0, Math.min(ny - 1, Math.floor(gy)));
    const yb = Math.max(0, Math.min(ny - 1, ya + 1));
    const fy = Math.max(0, Math.min(1, gy - ya));
    for (let x = 0; x < width; x++) {
      const gx = (x + .5) / tileW - .5;
      const xa = Math.max(0, Math.min(nx - 1, Math.floor(gx)));
      const xb = Math.max(0, Math.min(nx - 1, xa + 1));
      const fx = Math.max(0, Math.min(1, gx - xa));
      const v = gray[y * width + x];
      const a = lookup[ya * nx + xa][v] * (1 - fx) + lookup[ya * nx + xb][v] * fx;
      const b = lookup[yb * nx + xa][v] * (1 - fx) + lookup[yb * nx + xb][v] * fx;
      out[y * width + x] = clampByte(a * (1 - fy) + b * fy);
    }
  }
  return {gray: out, info: {tiles, clipLimit, tileW, tileH}};
}

export function processGray(gray, width, height, mode, params = {}) {
  if (!(gray instanceof Uint8ClampedArray) || gray.length !== width * height) throw Error('Неверный пиксельный буфер');
  switch (mode) {
    case 'linear': return linearContrast(gray, params.lowPercent ?? 2, params.highPercent ?? 98);
    case 'otsu': return otsu(gray);
    case 'local-mean': case 'niblack': case 'sauvola': return localThreshold(gray, width, height, mode, params);
    case 'clahe': return clahe(gray, width, height, params.tiles ?? 8, params.clipLimit ?? 2);
    default: throw Error(`Неизвестный алгоритм: ${mode}`);
  }
}
