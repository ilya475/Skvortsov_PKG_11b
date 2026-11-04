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

// Если DPI отсутствует, точное физическое разрешение невозможно вывести
// только из числа пикселей. Для единообразного результата лабораторной
// используется явно помеченная условная оценка 96 dpi (экранный стандарт).
// Она не выдаётся за значение, прочитанное из файла.
function fallbackDpi() { return "≈96 × 96 dpi (условно)"; }
function fallbackDpiNote() { return "DPI в метаданных отсутствует; условно принято 96 dpi"; }

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
  let dpiNote = "";
  if (phys) {
    const x = u32(phys, 0, false), y = u32(phys, 4, false), unit = phys[8];
    if (unit === 1 && x > 0 && y > 0) {
      r.resolution = fmtDpi(x * 0.0254, y * 0.0254);
      dpiNote = "pHYs: pixels/m → DPI";
    } else {
      r.resolution = fallbackDpi();
      dpiNote = `pHYs без физической единицы (${x} × ${y}); ${fallbackDpiNote()}`;
    }
  } else {
    r.resolution = fallbackDpi();
    dpiNote = `pHYs отсутствует; ${fallbackDpiNote()}`;
  }
  r.details = `IHDR; Color type ${ct}; bit depth ${bit}; ${dpiNote}; IEND + CRC подтверждены`;
  return r;
}

// ---------------- JPEG ----------------
async function parseJPEG(f, r) {
  r.format = "JPEG";
  const head = await read(f, 0, Math.min(f.size, 65536));
  need(head.length >= 4 && head[0] === 0xff && head[1] === 0xd8, "Неверная JPEG сигнатура");
  let pos = 2, found = false, dpiX = 0, dpiY = 0, dpiSource = "", sawSOS = false;

  while (pos + 3 < head.length) {
    while (pos < head.length && head[pos] !== 0xff) pos++;
    if (pos >= head.length) break;
    while (pos < head.length && head[pos] === 0xff) pos++;
    if (pos >= head.length) break;
    const marker = head[pos++];
    if (marker === 0xd9) break;
    if (marker === 0xda) { sawSOS = true; break; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    need(pos + 2 <= head.length, "Неполный JPEG segment");
    const len = u16(head, pos, false);
    need(len >= 2 && pos + len <= head.length, "Повреждённый JPEG segment");

    const sof = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
    if (sof) {
      const precision = head[pos + 2];
      const h = u16(head, pos + 3, false), w = u16(head, pos + 5, false), comps = head[pos + 7];
      need(w > 0 && h > 0, "Некорректные размеры JPEG");
      r.width = w; r.height = h;
      r.colorDepth = `${precision} bit на компоненту (${comps} компонент)`;
      found = true;
    }
    if (marker === 0xe0 && len >= 16 && str(head, pos + 2, 5) === "JFIF\0") {
      const units = head[pos + 9], x = u16(head, pos + 10, false), y = u16(head, pos + 12, false);
      if (units === 1 && x > 0 && y > 0) { dpiX = x; dpiY = y; dpiSource = "JFIF"; }
      else if (units === 2 && x > 0 && y > 0) { dpiX = x * 2.54; dpiY = y * 2.54; dpiSource = "JFIF dots/cm"; }
    }
    if (marker === 0xe1 && !dpiSource) {
      const exif = parseJPEGExifDpi(head, pos, len);
      if (exif) { dpiX = exif.x; dpiY = exif.y; dpiSource = "EXIF"; }
    }
    pos += len;
  }

  // Если заголовки необычно большие, пробуем следующий кусок, не читая весь JPEG.
  if (!found && f.size > 65536) {
    const extra = await read(f, 65536, Math.min(f.size - 65536, 1024 * 1024));
    const combined = new Uint8Array(head.length + extra.length); combined.set(head); combined.set(extra, head.length);
    // Рекурсивный повтор на объединённом префиксе не читает файл целиком.
    const tmp = await parseJPEGPrefix(combined, r);
    found = tmp.found;
    if (!dpiSource && tmp.dpiX > 0 && tmp.dpiY > 0) {
      dpiX = tmp.dpiX; dpiY = tmp.dpiY; dpiSource = tmp.dpiSource || "метаданные";
    }
  }

  const tail = await read(f, Math.max(0, f.size - 2), 2);
  need(found, "JPEG SOF не найден в заголовочной области");
  need(tail.length === 2 && tail[0] === 0xff && tail[1] === 0xd9, "Отсутствует маркер EOI (FF D9)");
  if (dpiX > 0 && dpiY > 0) {
    r.resolution = fmtDpi(dpiX, dpiY);
  } else {
    r.resolution = fallbackDpi();
    dpiSource = fallbackDpiNote();
  }
  r.compression = "JPEG DCT";
  r.details = `SOF; DPI: ${dpiSource || "не определён"}; EOI FF D9 подтверждён${sawSOS ? "; SOS найден" : ""}`;
  return r;
}

async function parseJPEGPrefix(a, r) {
  let pos = 2, found = false, dpiX = 0, dpiY = 0, dpiSource = "";
  while (pos + 3 < a.length) {
    while (pos < a.length && a[pos] !== 0xff) pos++;
    if (pos + 1 >= a.length) break;
    while (pos < a.length && a[pos] === 0xff) pos++;
    if (pos >= a.length) break;
    const marker = a[pos++];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (pos + 2 > a.length) break;
    const len = u16(a, pos, false);
    if (len < 2 || pos + len > a.length) break;
    const sof = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
    if (sof) { r.width = u16(a, pos + 5, false); r.height = u16(a, pos + 3, false); r.colorDepth = `${a[pos + 2]} bit на компоненту (${a[pos + 7]} компонент)`; found = true; }
    if (marker === 0xe0 && len >= 16 && str(a, pos + 2, 5) === "JFIF\0") {
      const units = a[pos + 9], x = u16(a, pos + 10, false), y = u16(a, pos + 12, false);
      if (units === 1 && x > 0 && y > 0) { dpiX = x; dpiY = y; dpiSource = "JFIF"; }
      else if (units === 2 && x > 0 && y > 0) { dpiX = x * 2.54; dpiY = y * 2.54; dpiSource = "JFIF dots/cm"; }
    }
    if (marker === 0xe1 && !dpiSource) {
      const exif = parseJPEGExifDpi(a, pos, len);
      if (exif) { dpiX = exif.x; dpiY = exif.y; dpiSource = "EXIF"; }
    }
    pos += len;
  }
  return { found, dpiX, dpiY, dpiSource };
}

// Читает EXIF APP1 вручную: TIFF IFD0 теги 282/283/296.
function parseJPEGExifDpi(a, pos, len) {
  try {
    const dataStart = pos + 2;
    const dataEnd = pos + len;
    if (len < 16 || dataEnd > a.length || str(a, dataStart, 6) !== "Exif\0\0") return null;

    const tiff = dataStart + 6;
    if (tiff + 8 > dataEnd) return null;
    const little = a[tiff] === 0x49 && a[tiff + 1] === 0x49;
    const big = a[tiff] === 0x4d && a[tiff + 1] === 0x4d;
    if (!little && !big) return null;
    if (u16(a, tiff + 2, little) !== 42) return null;

    const ifd = tiff + u32(a, tiff + 4, little);
    if (ifd + 2 > dataEnd) return null;
    const n = u16(a, ifd, little);
    if (ifd + 2 + n * 12 > dataEnd) return null;

    let x = 0, y = 0, unit = 2;
    const rational = (entry) => {
      const type = u16(a, entry + 2, little);
      const count = u32(a, entry + 4, little);
      if (type !== 5 || count < 1) return 0;
      const rel = u32(a, entry + 8, little);
      const o = tiff + rel;
      if (o + 8 > dataEnd) return 0;
      const num = u32(a, o, little), den = u32(a, o + 4, little);
      return den ? num / den : 0;
    };

    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      const tag = u16(a, e, little);
      if (tag === 282) x = rational(e);
      else if (tag === 283) y = rational(e);
      else if (tag === 296 && u16(a, e + 2, little) === 3) unit = u16(a, e + 8, little);
    }
    if (x <= 0 && y > 0) x = y;
    if (y <= 0 && x > 0) y = x;
    if (x <= 0 || y <= 0) return null;
    if (unit === 3) { x *= 2.54; y *= 2.54; }
    return { x, y };
  } catch {
    return null;
  }
}

// ---------------- GIF ----------------
async function parseGIF(f, r) {
  r.format = "GIF";
  const a = await read(f, 0, 13);
  need(a.length >= 13 && (str(a,0,6) === "GIF87a" || str(a,0,6) === "GIF89a"), "Неверный GIF заголовок");
  r.width = u16(a, 6, true); r.height = u16(a, 8, true); need(r.width > 0 && r.height > 0, "Некорректные размеры GIF");
  const packed = a[10], gct = !!(packed & 0x80), gctSize = 2 ** ((packed & 7) + 1);
  r.colorDepth = `${(packed & 7) + 1} bit (глобальная палитра: ${gct ? gctSize : "нет"} цветов)`;
  r.compression = "LZW"; r.resolution = fallbackDpi();
  const tail = await read(f, Math.max(0, f.size - 1), 1);
  need(tail[0] === 0x3b, "Отсутствует GIF Trailer");
  r.details = `Версия ${str(a,0,6)}; глобальная палитра: ${gct ? "да" : "нет"}; стандартного поля DPI в GIF нет; ${fallbackDpiNote()}; Trailer подтверждён`;
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
  const bmpHasDpi = xppm > 0 && yppm > 0;
  r.resolution = bmpHasDpi ? fmtDpi(xppm * 0.0254, yppm * 0.0254) : fallbackDpi();
  const maxPalette = bpp <= 8 ? 2 ** bpp : 0;
  const actualPalette = colorsUsed || maxPalette;
  r.details = `DIB ${dib} B; planes=${planes}; палитра=${actualPalette || "нет"} цветов; pixel offset=${off}; ориентация=${hRaw < 0 ? "top-down" : "bottom-up"}; ${bmpHasDpi ? "DPI из X/Y pixels per meter" : fallbackDpiNote()}`;
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
  const pcxHasDpi = hdpi > 0 && vdpi > 0;
  r.resolution = pcxHasDpi ? fmtDpi(hdpi, vdpi) : fallbackDpi();
  r.colorDepth = `${bppPlane * planes} bit (${planes} plane${planes > 1 ? "s" : ""})`;
  r.compression = "RLE";
  let palette = "";
  if (bppPlane === 8 && planes === 1 && f.size >= 769) {
    const tail = await read(f, f.size - 769, 769);
    if (tail[0] === 0x0c) palette = "; 256-цветная палитра найдена в конце файла";
  }
  r.details = `Version ${a[1]}; encoding=RLE; bytes/line=${bpl}; ${pcxHasDpi ? "DPI из HDPI/VDPI" : fallbackDpiNote()}${palette}`;
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
  } else r.resolution=fallbackDpi();
  const shown = Object.entries(tags).slice(0,16).map(([k,v])=>`${names[k]||("Tag "+k)}=${Array.isArray(v.value)?v.value.join(","):v.value}`).join("; ");
  r.details=`IFD entries: ${n}; ${shown}; ${xr && yr ? "DPI из XResolution/YResolution" : fallbackDpiNote()}${next ? "; следующий IFD есть" : "; следующий IFD отсутствует"}`;
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
