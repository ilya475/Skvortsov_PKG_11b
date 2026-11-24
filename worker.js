import {localThreshold, processGray} from './src/algorithms.js';

self.onmessage = event => {
  const {id, width, height, grayBuffer, mode, params, startRow = 0, endRow = height} = event.data;
  try {
    const gray = new Uint8ClampedArray(grayBuffer);
    const t0 = performance.now();
    const result = startRow === 0 && endRow === height
      ? processGray(gray, width, height, mode, params)
      : localThreshold(gray, width, height, mode, params, startRow, endRow);
    self.postMessage({id, startRow, endRow, grayBuffer: result.gray.buffer,
      info: result.info, elapsed: performance.now() - t0}, [result.gray.buffer]);
  } catch (error) {
    self.postMessage({id, error: error?.message || String(error)});
  }
};
