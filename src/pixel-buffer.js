/**
 * Memory & Pixel Access Layer.
 * RGBA is held in a contiguous Uint8ClampedArray (4 bytes per pixel).
 * No per-pixel browser API calls are used in image processing.
 */
export const clampByte = value => Math.max(0, Math.min(255, Math.round(Number.isFinite(value) ? value : 0)));

/** Clamp or reflect-101 boundary mapping. Reflect does not duplicate the edge sample. */
export function mapIndex(index, length, strategy = 'reflect') {
  if (length <= 1) return 0;
  if (strategy === 'clamp') return Math.max(0, Math.min(length - 1, index));
  if (strategy !== 'reflect') throw new Error(`Неизвестная стратегия границ: ${strategy}`);
  const period = 2 * length - 2;
  let i = ((index % period) + period) % period;
  return i < length ? i : period - i;
}

export class PixelBuffer {
  constructor(width, height, bytes) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw new Error('Недопустимые размеры изображения');
    }
    if (width * height > 32_000_000) throw new Error('Размер изображения превышает предел в 32 Мп');
    this.width = width;
    this.height = height;
    this.data = bytes ?? new Uint8ClampedArray(width * height * 4);
    if (this.data.length !== width * height * 4) throw new Error('Неправильная длина RGBA-буфера');
  }
  static fromImageData(imageData) {
    return new PixelBuffer(imageData.width, imageData.height, new Uint8ClampedArray(imageData.data));
  }
  static blank(width, height) {
    const out = new PixelBuffer(width, height);
    for (let i = 3; i < out.data.length; i += 4) out.data[i] = 255;
    return out;
  }
  sample(x, y, channel = 0, border = 'reflect') {
    return this.data[(mapIndex(y, this.height, border) * this.width + mapIndex(x, this.width, border)) * 4 + channel];
  }
  pixelIndex(x, y) { return (y * this.width + x) * 4; }
  clone() { return new PixelBuffer(this.width, this.height, new Uint8ClampedArray(this.data)); }
}

export function luminance(r, g, b) { return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
export function grayPlane(buffer) {
  const n = buffer.width * buffer.height, src = buffer.data;
  const out = new Float64Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) out[i] = luminance(src[p], src[p+1], src[p+2]);
  return out;
}
export function grayImage(width, height, plane) {
  const out = PixelBuffer.blank(width, height), dst = out.data;
  for (let i = 0, p = 0; i < plane.length; i++, p += 4) {
    const v = clampByte(plane[i]); dst[p] = dst[p+1] = dst[p+2] = v;
  }
  return out;
}
export function rgbaImage(width, height, channels) {
  const out = PixelBuffer.blank(width, height), dst = out.data;
  for (let i = 0, p = 0, k = 0; i < width * height; i++, p += 4, k += 3) {
    dst[p] = clampByte(channels[k]); dst[p+1] = clampByte(channels[k+1]); dst[p+2] = clampByte(channels[k+2]);
  }
  return out;
}
