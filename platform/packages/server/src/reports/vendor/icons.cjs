'use strict';
/*
 * The dashboard's stat-card pictograms, as embeddable Word images.
 *
 * Word has no vector-icon primitive, but it *does* embed SVG: an ImageRun of
 * type "svg" renders as true vector art in Word 2016+, with a raster fallback
 * for anything older. So the icons here are real stroked SVG paths — the same
 * 24x24 grid and 2px stroke the dashboard's own icon set uses — rather than
 * the coloured dot that used to stand in for them.
 *
 * Each icon is a body of paths drawn on a 24x24 viewBox with no colour of its
 * own; `iconSvg()` paints it, so one definition serves every tint.
 */
const { roundedSquarePng } = require('./png.cjs');

/* Path bodies only — stroke colour and width come from iconSvg(). */
const PATHS = {
  // Assignment — a card, for funds committed on paper.
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  // Expenditure — a stacked database, for money actually drawn down.
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5"/><path d="M3 12c0 1.7 4 3 9 3s9-1.3 9-3"/>',
  // Balance — scales, for what is still unspent.
  scale: '<path d="M12 3v18"/><path d="M7 21h10"/><path d="M3 7h18"/><path d="M6.5 7 3 14h7z"/><path d="M17.5 7 14 14h7z"/>',
  // Regional Centre — a building. Deliberately sparse: this one renders at
  // ~9px on every table row, and a denser window grid turns to mush there.
  building: '<path d="M4 21V4a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v17"/><path d="M2 21h20"/>'
    + '<path d="M9 8h2M14 8h2M9 12h2M14 12h2"/><path d="M10 21v-4h4v4"/>',
  // Section count — a layered stack.
  layers: '<path d="M12 3 3 8l9 5 9-5z"/><path d="m3 14 9 5 9-5"/>',
};

/**
 * One icon as a standalone SVG document.
 *
 * `fill="none"` with a stroked path is what makes these read as line art;
 * without it Word fills every subpath solid and the icons turn into blobs.
 */
function iconSvg(name, color, size = 24) {
  const body = PATHS[name] || PATHS.card;
  return '<?xml version="1.0" encoding="UTF-8"?>'
    + `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" `
    + `fill="none" stroke="#${String(color).replace('#', '')}" stroke-width="2" `
    + `stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

/*
 * The fallback raster is cached per colour: it is identical for every icon of
 * a given tint, and encoding it is pure CPU we would otherwise repeat on every
 * card of every run.
 */
const fallbackCache = new Map();
function fallbackPng(color) {
  const key = String(color);
  if (!fallbackCache.has(key)) fallbackCache.set(key, roundedSquarePng(key));
  return fallbackCache.get(key);
}

/**
 * Options for `new ImageRun(...)` — an SVG icon with its raster fallback.
 * @param {string} name   a key of PATHS
 * @param {string} color  hex, with or without "#"
 * @param {number} px     rendered size in pixels
 */
function iconImage(name, color, px = 14) {
  return {
    type: 'svg',
    // A Buffer, not the string: docx runs string image data through atob(),
    // so passing SVG markup as text fails with "Invalid character".
    data: Buffer.from(iconSvg(name, color), 'utf8'),
    transformation: { width: px, height: px },
    fallback: { type: 'png', data: fallbackPng(color) },
    altText: { name, description: `${name} icon`, title: name },
  };
}

module.exports = { iconSvg, iconImage, fallbackPng, PATHS };
