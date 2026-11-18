/** Virtual raster. Coordinates are integer, mathematical Y points upwards. */
export class VirtualGrid {
  constructor(width = 43, height = 43, originX = Math.floor(width / 2), originY = Math.floor(height / 2)) {
    if (![width, height, originX, originY].every(Number.isInteger) || width < 1 || height < 1) {
      throw new RangeError('Invalid grid dimensions');
    }
    this.width = width;
    this.height = height;
    this.originX = originX;
    this.originY = originY;
    this.data = new Uint8Array(width * height);
    this.writes = 0;
    this.inBoundsWrites = 0;
  }

  clear() {
    this.data.fill(0);
    this.writes = 0;
    this.inBoundsWrites = 0;
  }

  /** IRasterTarget.SetPixel(x,y,intensity). Single algorithm -> raster interface. */
  setPixel(x, y, intensity = 1) {
    this.writes++;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(intensity)) return;
    const col = x + this.originX;
    const row = this.originY - y;
    if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0 || col >= this.width || row >= this.height) return;
    this.inBoundsWrites++;
    const pos = row * this.width + col;
    const alpha = Math.round(Math.max(0, Math.min(1, intensity)) * 255);
    // Taking the max prevents order-dependent alpha accumulation.
    if (alpha > this.data[pos]) this.data[pos] = alpha;
  }

  getPixel(x, y) {
    const col = x + this.originX;
    const row = this.originY - y;
    if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0 || col >= this.width || row >= this.height) return 0;
    return this.data[row * this.width + col] / 255;
  }

  pixelCount() {
    let n = 0;
    for (const c of this.data) if (c > 0) n++;
    return n;
  }
}
