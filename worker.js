/*
 * Data / Parsing Layer
 * Все метаданные извлекаются вручную из байтов File/Blob.
 * Сторонние библиотеки не используются.
 */

self.postMessage({ type: "ready" });

self.onmessage = async (e) => {
  if (e.data?.type !== "parse") return;
  const { file, index } = e.data;
  let result;
  try {
    result = await parseFile(file);
  } catch (err) {
    result = base(file, "Файл поврежден", err?.message || "ошибка разбора");
  }
  self.postMessage({ type: "result", index, result });
};

function base(f, status = "OK", details = "") {
  return {
    name: f.name,
    fileSize: f.size,
    format: "UNKNOWN",
    width: 0,
    height: 0,
    resolution: "—",
    colorDepth: "—",
    compression: "—",
    status,
    details
  };
}

async function read(f, start, len) {
  if (start < 0 || len < 0 || start > f.size) throw Error("Выход за границы файла");
  const end = Math.min(f.size, start + len);
  return new Uint8Array(await f.slice(start, end).arrayBuffer());
}

function u16(a, o, little = true) {
  if (o + 2 > a.length) throw Error("Недостаточно байтов для uint16");
  return little ? a[o] | (a[o + 1] << 8) : (a[o] << 8) | a[o + 1];
}
function u32(a, o, little = true) {
  if (o + 4 > a.length) throw Error("Недостаточно байтов для uint32");
  return little
    ? (a[o] | (a[o + 1] << 8) | (a[o + 2] << 16) | (a[o + 3] * 16777216)) >>> 0
    : ((a[o] * 16777216) + (a[o + 1] << 16) + (a[o + 2] << 8) + a[o + 3]) >>> 0;
}
function s32(a, o, little = true) {
  const v = u32(a, o, little);
  return v >= 0x80000000 ? v - 0x100000000 : v;
}
function str(a, o, n) { return new TextDecoder().decode(a.slice(o, o + n)); }
function need(ok, msg) { if (!ok) throw Error(msg); }
function fmtDpi(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || x <= 0 || y <= 0) return "не задано";
  return `${Math.round(x)} × ${Math.round(y)} dpi`;
}

async function parseFile(f) {
  const r = base(f);
  const h = await read(f, 0, Math.min(32, f.size));
  if (h.length < 2) return base(f, "Файл поврежден", "Файл слишком короткий");

  if (h.length >= 8 && h[0] === 137 && h[1] === 80 && h[2] === 78 && h[3] === 71 && h[4] === 13 && h[5] === 10 && h[6] === 26 && h[7] === 10) return parsePNG(f, r);
  if (h[0] === 0xff && h[1] === 0xd8) return parseJPEG(f, r);
  if (h.length >= 6 && h[0] === 0x47 && h[1] === 0x49 && h[2] === 0x46) return parseGIF(f, r);
  if (h[0] === 0x42 && h[1] === 0x4d) return parseBMP(f, r);
  if (h.length >= 4 && ((h[0] === 0x49 && h[1] === 0x49 && h[2] === 42 && h[3] === 0) || (h[0] === 0x4d && h[1] === 0x4d && h[2] === 0 && h[3] === 42))) return parseTIFF(f, r);
  if (h[0] === 0x0a) return parsePCX(f, r);
  return base(f, "Файл поврежден", "Неизвестная сигнатура / подмена расширения");
}

// ---------------- PNG ----------------
async function parsePNG(f, r) {
  r.format = "PNG";
  const first = await read(f, 0, Math.min(f.size, 65536));
  need(first.length >= 33, "Слишком короткий PNG");
  const sig = [137,80,78,71,13,10,26,10];
  need(sig.every((v, i) => first[i] === v), "Неверная PNG сигнатура");

  let p = 8, ihdr = null, phys = null, sawIDAT = false;
  while (p + 12 <= first.length) {
    const len = u32(first, p, false);
    const type = str(first, p + 4, 4);
    need(len <= 0x7fffffff && p + 12 + len <= first.length, "Чанк PNG выходит за область заголовка");
    const data = first.slice(p + 8, p + 8 + len);
    const crcStored = u32(first, p + 8 + len, false);

    if (type === "IHDR") {
      need(len === 13, "Некорректный IHDR");
      need(crc32(first.slice(p + 4, p + 8 + len)) === crcStored, "Неверная CRC у IHDR");
      ihdr = data;
    } else if (type === "pHYs" && len === 9) {
      phys = data;
    } else if (type === "IDAT") {
      sawIDAT = true;
      break;
    }
    p += 12 + len;
  }

  need(ihdr, "Отсутствует IHDR");
  need(sawIDAT || f.size <= 33, "PNG не содержит IDAT");

  const tail = await read(f, Math.max(0, f.size - 12), 12);
  need(tail.length === 12 && str(tail, 4, 4) === "IEND", "Отсутствует IEND в конце PNG");
  need(crc32(tail.slice(4, 8)) === u32(tail, 8, false), "Неверная CRC у IEND");

  r.width = u32(ihdr, 0, false);
  r.height = u32(ihdr, 4, false);
  need(r.width > 0 && r.height > 0, "Некорректные размеры PNG");
  const bit = ihdr[8], ct = ihdr[9];
  const channels = {0:1,2:3,3:1,4:2,6:4}[ct] || 0;
  need([0,2,3,4,6].includes(ct), "Неподдерживаемый PNG color type");
  r.colorDepth = `${bit} bit${channels ? ` (${channels} канал${channels > 1 ? "а" : ""})` : ""}`;
  r.compression = `Deflate (zlib); фильтр ${ihdr[11]}; interlace ${ihdr[12]}`;
  if (phys) {
    const x = u32(phys, 0, false), y = u32(phys, 4, false), unit = phys[8];
    r.resolution = unit === 1 ? fmtDpi(x * 0.0254, y * 0.0254) : `${x} × ${y} px/m`;
  } else r.resolution = "не задано";
  r.details = `IHDR; Color type ${ct}; bit depth ${bit}; IEND + CRC подтверждены`;
  return r;
}

// ---------------- JPEG ----------------
async function parseJPEG(f, r) {
  r.format = "JPEG";
  const sig = await read(f, 0, Math.min(f.size, 2));
  need(sig.length === 2 && sig[0] === 0xff && sig[1] === 0xd8, "Неверная JPEG сигнатура");

  // JPEG segments are walked by their declared lengths. Read only the small
  // segment headers/payload fields we need, instead of treating a fixed-size
  // prefix as the complete header (which incorrectly rejected large APP/EXIF
  // segments when they crossed the 64 KiB boundary).
  let pos = 2, found = false, dpiX = 0, dpiY = 0, sawSOS = false;
  const sofMarkers = new Set([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf]);
  let segments = 0;
  while (pos + 1 < f.size && segments++ < 10000) {
    const markerStart = pos;
    const b = await read(f, pos, 1);
    if (!b.length) break;
    if (b[0] !== 0xff) {
      // Outside entropy-coded data, a marker must begin with FF. Be tolerant
      // of occasional padding bytes, but don't scan arbitrarily through data.
      pos++;
      continue;
    }
    while (pos < f.size) {
      const ff = await read(f, pos, 1);
      if (!ff.length || ff[0] !== 0xff) break;
      pos++;
    }
    if (pos >= f.size) break;
    const mb = await read(f, pos, 1);
    if (!mb.length) break;
    const marker = mb[0];
    pos++;
    if (marker === 0x00) continue; // byte-stuffed FF in entropy data
    if (marker === 0xd9) break;     // EOI
    if (marker === 0xda) { sawSOS = true; break; } // image scan starts
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;

    const lb = await read(f, pos, 2);
    need(lb.length === 2, "Неполная длина JPEG segment");
    const len = u16(lb, 0, false);
    need(len >= 2, "Некорректная длина JPEG segment");
    need(pos + len <= f.size, "JPEG segment выходит за границы файла");
    const payloadStart = pos + 2;
    const payloadLen = len - 2;

    if (sofMarkers.has(marker)) {
      need(payloadLen >= 6, "Неполный JPEG SOF segment");
      const d = await read(f, payloadStart, Math.min(payloadLen, 6));
      const precision = d[0], h = u16(d, 1, false), w = u16(d, 3, false), comps = d[5];
      need(w > 0 && h > 0 && comps > 0, "Некорректные размеры JPEG");
      r.width = w; r.height = h;
      r.colorDepth = `${precision} bit на компоненту (${comps} компонент)`;
      found = true;
    } else if (marker === 0xe0 && payloadLen >= 14) {
      const d = await read(f, payloadStart, 14);
      if (str(d, 0, 5) === "JFIF\0") {
        const units = d[7], x = u16(d, 8, false), y = u16(d, 10, false);
        if (units === 1) { dpiX = x; dpiY = y; }
        else if (units === 2) { dpiX = x * 2.54; dpiY = y * 2.54; }
      }
    }
    pos += len;
    if (found && (sawSOS || pos >= f.size)) break;
    // Prevent malformed files from causing an unbounded scan.
    if (pos <= markerStart) break;
  }

  need(found, "JPEG SOF не найден до начала изображения");
  // EOI may be followed by harmless trailing bytes in real-world files.
  // Search a bounded tail rather than requiring EOI to be exactly the last 2 bytes.
  const tailLen = Math.min(f.size, 65536);
  const tail = await read(f, f.size - tailLen, tailLen);
  let hasEOI = false;
  for (let i = tail.length - 2; i >= 0; i--) {
    if (tail[i] === 0xff && tail[i + 1] === 0xd9) { hasEOI = true; break; }
  }
  need(hasEOI, "Отсутствует маркер EOI (FF D9) в конце JPEG");
  r.resolution = dpiX > 0 && dpiY > 0 ? fmtDpi(dpiX, dpiY) : "не задано";
  r.compression = "JPEG DCT";
  r.details = `SOF найден; ${sawSOS ? "SOS найден" : "заголовок разобран"}; EOI ${hasEOI ? "найден" : "не найден"}`;
  return r;
}

// ---------------- GIF ----------------
async function parseGIF(f, r) {
  r.format = "GIF";
  const a = await read(f, 0, 13);
  need(a.length >= 13 && (str(a,0,6) === "GIF87a" || str(a,0,6) === "GIF89a"), "Неверный GIF заголовок");
  r.width = u16(a, 6, true); r.height = u16(a, 8, true); need(r.width > 0 && r.height > 0, "Некорректные размеры GIF");
  const packed = a[10], gct = !!(packed & 0x80), gctSize = 2 ** ((packed & 7) + 1);
  r.colorDepth = `${(packed & 7) + 1} bit (глобальная палитра: ${gct ? gctSize : "нет"} цветов)`;
  r.compression = "LZW"; r.resolution = "не задано";
  const tail = await read(f, Math.max(0, f.size - 1), 1);
  need(tail[0] === 0x3b, "Отсутствует GIF Trailer");
  r.details = `Версия ${str(a,0,6)}; глобальная палитра: ${gct ? "да" : "нет"}; Trailer подтверждён`;
  return r;
}

// ---------------- BMP ----------------
async function parseBMP(f, r) {
  r.format = "BMP";
  const a = await read(f, 0, 64);
  need(a.length >= 54 && a[0] === 66 && a[1] === 77, "Неверный BMP заголовок");
  const bfSize = u32(a,2,true), off = u32(a,10,true), dib = u32(a,14,true);
  need([12,40,52,56,108,124].includes(dib), `Неподдерживаемый DIB ${dib}`);
  const wRaw = s32(a,18,true), hRaw = s32(a,22,true), planes = u16(a,26,true), bpp = u16(a,28,true), comp = u32(a,30,true);
  const xppm = s32(a,38,true), yppm = s32(a,42,true), colorsUsed = dib >= 40 ? u32(a,46,true) : 0;
  need(wRaw > 0 && hRaw !== 0 && planes === 1, "Некорректные BMP размеры/planes");
  need(off >= 14 + dib && off < f.size, "Некорректный pixel offset");
  r.width = wRaw; r.height = Math.abs(hRaw); r.colorDepth = `${bpp} bit`;
  const cm = {0:"BI_RGB (без сжатия)",1:"BI_RLE8",2:"BI_RLE4",3:"BI_BITFIELDS",4:"BI_JPEG",5:"BI_PNG"};
  r.compression = cm[comp] || `Код ${comp}`;
  r.resolution = (xppm > 0 && yppm > 0) ? fmtDpi(xppm * 0.0254, yppm * 0.0254) : "не задано";
  const maxPalette = bpp <= 8 ? 2 ** bpp : 0;
  const actualPalette = colorsUsed || maxPalette;
  r.details = `DIB ${dib} B; planes=${planes}; палитра=${actualPalette || "нет"} цветов; pixel offset=${off}; ориентация=${hRaw < 0 ? "top-down" : "bottom-up"}`;
  need(bfSize === 0 || bfSize <= f.size, "Размер в заголовке больше фактического файла");
  return r;
}

// ---------------- PCX ----------------
async function parsePCX(f, r) {
  r.format = "PCX";
  const a = await read(f, 0, 128);
  need(a.length === 128 && a[0] === 10, "Неверный PCX заголовок");
  need([0,2,3,4,5].includes(a[1]), "Неподдерживаемая версия PCX");
  need(a[2] === 1, "PCX должен использовать RLE encoding=1");
  const bppPlane = a[3];
  need([1,2,4,8].includes(bppPlane), "Неподдерживаемая глубина PCX на plane");
  const xmin=u16(a,4,true), ymin=u16(a,6,true), xmax=u16(a,8,true), ymax=u16(a,10,true);
  const hdpi=u16(a,12,true), vdpi=u16(a,14,true), planes=a[65], bpl=u16(a,66,true);
  r.width=xmax-xmin+1; r.height=ymax-ymin+1;
  need(r.width > 0 && r.height > 0 && planes > 0 && bpl > 0, "Некорректные размеры PCX");
  r.resolution = fmtDpi(hdpi, vdpi);
  r.colorDepth = `${bppPlane * planes} bit (${planes} plane${planes > 1 ? "s" : ""})`;
  r.compression = "RLE";
  let palette = "";
  if (bppPlane === 8 && planes === 1 && f.size >= 769) {
    const tail = await read(f, f.size - 769, 769);
    if (tail[0] === 0x0c) palette = "; 256-цветная палитра найдена в конце файла";
  }
  r.details = `Version ${a[1]}; encoding=RLE; bytes/line=${bpl}${palette}`;
  return r;
}

// ---------------- TIFF / IFD ----------------
async function parseTIFF(f, r) {
  r.format = "TIFF";
  const h = await read(f,0,8);
  need(h.length === 8, "Короткий TIFF");
  const little = h[0] === 0x49 && h[1] === 0x49;
  need(little || (h[0] === 0x4d && h[1] === 0x4d), "Неверный byte order");
  need(u16(h,2,little) === 42, "Поддерживается Classic TIFF (magic 42)");
  const ifdOff = u32(h,4,little);
  need(ifdOff >= 8 && ifdOff + 2 <= f.size, "Некорректный IFD offset");
  const nbuf = await read(f, ifdOff, 2), n = u16(nbuf,0,little);
  need(n > 0 && n <= 4096 && ifdOff + 2 + n*12 + 4 <= f.size, "IFD выходит за пределы файла");
  const a = await read(f, ifdOff, 2+n*12+4), tags = {};
  const types = {1:1,2:1,3:2,4:4,5:8,6:1,7:1,8:2,9:4,10:8,11:4,12:8};
  const names = {256:"ImageWidth",257:"ImageLength",258:"BitsPerSample",259:"Compression",262:"PhotometricInterpretation",273:"StripOffsets",277:"SamplesPerPixel",278:"RowsPerStrip",279:"StripByteCounts",282:"XResolution",283:"YResolution",296:"ResolutionUnit",338:"ExtraSamples"};
  for (let i=0;i<n;i++) {
    const o=2+i*12, tag=u16(a,o,little), type=u16(a,o+2,little), count=u32(a,o+4,little), unit=types[type]||0;
    if (!unit) continue;
    const total=unit*count;
    let off;
    if (total <= 4) off=o+8; else { off=u32(a,o+8,little); need(off+total<=f.size, `TIFF tag ${tag} выходит за файл`); }
    const b=total<=4 ? a.slice(o+8,o+8+total) : await read(f,off,total);
    tags[tag]={type,count,value:readTIFFValue(b,type,count,little)};
  }
  const next = u32(a, 2+n*12, little);
  need(next === 0 || (next >= 8 && next < f.size), "Некорректный следующий IFD offset");
  const get=t=>tags[t]?.value;
  r.width=Number(get(256)||0); r.height=Number(get(257)||0); need(r.width>0&&r.height>0,"TIFF ImageWidth/ImageLength отсутствуют");
  const bits=get(258), spp=Number(get(277)||1); r.colorDepth=`${Array.isArray(bits)?bits.join("+"):bits} bit${spp>1?` × ${spp} samples`:""}`;
  const comp=get(259), cmap={1:"None",2:"CCITT Group 3",3:"CCITT Group 3 Fax",4:"CCITT Group 4 Fax",5:"LZW",6:"JPEG",7:"JPEG",8:"Deflate",32773:"PackBits"}; r.compression=cmap[comp]||`TIFF compression ${comp}`;
  const unit=get(296) ?? 2, xr=get(282), yr=get(283);
  if (xr && yr) {
    const x=Number(xr), y=Number(yr);
    r.resolution = unit === 3 ? fmtDpi(x*2.54,y*2.54) : (unit === 2 ? fmtDpi(x,y) : `неизвестная единица ResolutionUnit=${unit}`);
  } else r.resolution="не задано";
  const shown = Object.entries(tags).slice(0,16).map(([k,v])=>`${names[k]||("Tag "+k)}=${Array.isArray(v.value)?v.value.join(","):v.value}`).join("; ");
  r.details=`IFD entries: ${n}; ${shown}${next ? "; следующий IFD есть" : "; следующий IFD отсутствует"}`;
  return r;
}

function readTIFFValue(b,type,count,little) {
  const unit={1:1,2:1,3:2,4:4,5:8,6:1,7:1,8:2,9:4,10:8,11:4,12:8}[type]||1;
  const one=(x)=>{
    if(type===1||type===6||type===7)return x[0];
    if(type===2)return new TextDecoder().decode(x).replace(/\0/g,"");
    if(type===3)return u16(x,0,little);
    if(type===4)return u32(x,0,little);
    if(type===5)return u32(x,0,little)/(u32(x,4,little)||1);
    if(type===8)return u16(x,0,little);
    if(type===9)return s32(x,0,little);
    if(type===10)return s32(x,0,little)/(s32(x,4,little)||1);
    if(type===11)return new DataView(x.buffer,x.byteOffset,4).getFloat32(0,!little);
    if(type===12)return new DataView(x.buffer,x.byteOffset,8).getFloat64(0,!little);
    return 0;
  };
  if(count===1)return one(b);
  const out=[]; for(let i=0;i<count;i++)out.push(one(b.slice(i*unit,(i+1)*unit))); return out;
}

// Standard CRC-32 used by PNG chunks.
let crcTable = null;
function crc32(data) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n=0;n<256;n++) { let c=n; for(let k=0;k<8;k++) c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1); crcTable[n]=c>>>0; }
  }
  let c=0xffffffff;
  for(const b of data)c=crcTable[(c^b)&255]^(c>>>8);
  return (c^0xffffffff)>>>0;
}
