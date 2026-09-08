'use strict';
/*
 * A minimal PNG encoder — just enough to produce the raster fallback that Word
 * requires alongside every embedded SVG.
 *
 * Word 2016 and newer render the SVG itself, so this image is what *older*
 * Word shows instead. It only ever needs to be a flat tinted chip, which is
 * why a full raster library would be dead weight here: a PNG is a signature,
 * three chunks, and a zlib stream, and Node ships zlib already.
 */
const zlib = require('zlib');

/* CRC-32, table built once — every PNG chunk carries one. */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** length + type + data + crc(type+data) — the PNG chunk framing. */
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Encode raw RGBA pixels as a PNG.
 * @param {Buffer} rgba  width*height*4 bytes
 */
function encodePng(rgba, width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // colour type 6 = RGBA
  ihdr[10] = 0;   // deflate
  ihdr[11] = 0;   // adaptive filtering
  ihdr[12] = 0;   // no interlace

  // Each scanline is prefixed with its filter byte; 0 ("None") keeps this
  // simple and the images are tiny, so the lost compression costs nothing.
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const hexToRgb = hex => {
  const h = String(hex).replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};

/**
 * A solid rounded square — the fallback chip. Corners are cut with a simple
 * radius test rather than antialiased, which at 32px is indistinguishable
 * once Word scales it down to ~14px.
 */
function roundedSquarePng(hex, size = 32, radius = 8) {
  const [r, g, b] = hexToRgb(hex);
  const px = Buffer.alloc(size * size * 4);
  const inCorner = (x, y) => {
    const cx = x < radius ? radius : x >= size - radius ? size - radius - 1 : x;
    const cy = y < radius ? radius : y >= size - radius ? size - radius - 1 : y;
    return (x - cx) ** 2 + (y - cy) ** 2 > radius ** 2;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const outside = inCorner(x, y);
      px[i] = r; px[i + 1] = g; px[i + 2] = b;
      px[i + 3] = outside ? 0 : 255;
    }
  }
  return encodePng(px, size, size);
}

module.exports = { encodePng, roundedSquarePng };
