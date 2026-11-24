/** Memory & Pixel Access Layer: all pixel access is direct typed-array indexing. */
export function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(Number.isFinite(value) ? value : 0)));
}
export function mapIndex(index, length, border = 'reflect') {
  if (length <= 1) return 0;
  if (border === 'clamp') return Math.max(0, Math.min(length - 1, index));
  if (border !== 'reflect') throw new Error(`Неизвестная стратегия: ${border}`);
  const period = 2 * length - 2;
  let k = ((index % period) + period) % period;
  return k < length ? k : period - k; // Reflect-101, без повторения крайних значений
}
export function rgbaToGray(rgba) {
  if (rgba.length % 4) throw new Error('Некорректная длина RGBA');
  const gray = new Uint8ClampedArray(rgba.length / 4);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = clampByte(.2126 * rgba[p] + .7152 * rgba[p + 1] + .0722 * rgba[p + 2]);
  }
  return gray;
}
export function grayToRgba(gray) {
  const rgba = new Uint8ClampedArray(gray.length * 4);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    rgba[p] = rgba[p + 1] = rgba[p + 2] = gray[i]; rgba[p + 3] = 255;
  }
  return rgba;
}
export function histogram(gray) {
  const h = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) h[gray[i]]++;
  return h;
}
export function statistics(gray) {
  const h = histogram(gray), n = gray.length;
  let mean = 0, square = 0, entropy = 0, min = 255, max = 0;
  for (let x = 0; x < 256; x++) if (h[x]) {
    mean += x * h[x]; square += x * x * h[x];
    const p = h[x] / n; entropy -= p * Math.log2(p);
    min = Math.min(min, x); max = Math.max(max, x);
  }
  mean /= n;
  const quantile = q => {
    const cutoff = Math.max(1, Math.ceil(q * n));
    let count = 0;
    for (let x = 0; x < 256; x++) { count += h[x]; if (count >= cutoff) return x; }
    return 255;
  };
  return {mean, sd: Math.sqrt(Math.max(0, square / n - mean ** 2)),
    entropy, min, max, p5: quantile(.05), p95: quantile(.95), range: quantile(.95) - quantile(.05)};
}
