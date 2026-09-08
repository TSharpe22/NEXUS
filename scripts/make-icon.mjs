/**
 * Regenerates build/icon.png — the desktop-entry icon electron-builder packs
 * into the AppImage and the .deb.
 *
 * The icon was originally drawn by hand at 512px, and every colour change since
 * has been a pixel remap of that one bitmap — which is why its neutrals still
 * traced DESIGN.md's pre-restyle greys through the emerald recolour, a shade
 * off the app they launch. Committing the drawing as a script means the next
 * palette change is `npm run icon` against the tokens, not another remap of a
 * remap.
 *
 * The colours below are the three tokens the mark uses, copied from tokens.css.
 * No dependencies: rasterised with 4x4 supersampling and written out through
 * node's own zlib, because pulling `sharp` or `canvas` in for one 512px square
 * would add a native build step to a repo that already fights one.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SIZE = 512;
const SAMPLES = 4; // per axis

// --- palette (src/renderer/design/tokens.css) ---------------------------
const BG = [0x0f, 0x11, 0x0f]; // --nx-bg             — the tile
const SUNKEN = [0x0b, 0x0c, 0x0b]; // --nx-surface-sunken — inside the diamond
const ACCENT = [0x69, 0xb4, 0x8a]; // --nx-accent         — the mark itself

// --- geometry (measured off the original 512px icon) --------------------
const RADIUS = 104; // rounded-square corner
const OUTER = 154.5; // diamond half-diagonal, outer edge
const INNER = 137.5; // diamond half-diagonal, inner edge (~12px stroke)
const HUB = 42; // centre disc radius
const CX = SIZE / 2 - 0.5;
const CY = SIZE / 2 - 0.5;

/** Colour of one subsample, or null where the tile isn't. */
function sample(x, y) {
  // Rounded square, clipped to the canvas.
  const dx = Math.max(RADIUS - x, x - (SIZE - RADIUS), 0);
  const dy = Math.max(RADIUS - y, y - (SIZE - RADIUS), 0);
  if (dx * dx + dy * dy > RADIUS * RADIUS) return null;

  const d = Math.abs(x - CX) + Math.abs(y - CY); // diamond = Manhattan distance
  const r = Math.hypot(x - CX, y - CY);
  if (r <= HUB) return ACCENT;
  if (d <= INNER) return SUNKEN;
  if (d <= OUTER) return ACCENT;
  return BG;
}

const pixels = Buffer.alloc(SIZE * SIZE * 4);
const step = 1 / SAMPLES;
const total = SAMPLES * SAMPLES;

for (let py = 0; py < SIZE; py++) {
  for (let px = 0; px < SIZE; px++) {
    let r = 0;
    let g = 0;
    let b = 0;
    let hits = 0;
    for (let sy = 0; sy < SAMPLES; sy++) {
      for (let sx = 0; sx < SAMPLES; sx++) {
        const c = sample(px + (sx + 0.5) * step, py + (sy + 0.5) * step);
        if (!c) continue;
        r += c[0];
        g += c[1];
        b += c[2];
        hits++;
      }
    }
    const o = (py * SIZE + px) * 4;
    if (hits === 0) continue; // leave fully transparent
    // Average over the covered subsamples only, so the edge keeps the colour
    // it would have at full coverage and fades through alpha instead of
    // darkening towards black.
    pixels[o] = Math.round(r / hits);
    pixels[o + 1] = Math.round(g / hits);
    pixels[o + 2] = Math.round(b / hits);
    pixels[o + 3] = Math.round((hits / total) * 255);
  }
}

// --- PNG container ------------------------------------------------------
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0; // filter: none
  pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // colour type: RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'build', 'icon.png');
writeFileSync(out, png);
console.log(`wrote ${out} — ${SIZE}x${SIZE}, ${png.length} bytes`);
