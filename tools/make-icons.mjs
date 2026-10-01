// PNG app icons without dependencies: a sealed parchment sheet on dark leather.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
const crcTable = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (buf) => { let c = -1; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
function png(size, paint) {
  const SS = 4, raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) { const [pr, pg, pb, pa] = paint(x + (sx + .5) / SS, y + (sy + .5) / SS, size); r += pr * pa; g += pg * pa; b += pb * pa; a += pa; }
    const i = y * (size * 4 + 1) + 1 + x * 4; raw[i] = a ? Math.round(r / a) : 0; raw[i + 1] = a ? Math.round(g / a) : 0; raw[i + 2] = a ? Math.round(b / a) : 0; raw[i + 3] = Math.round(a / (SS * SS));
  } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const BODY = [233, 231, 226], LCD = [18, 22, 26], BARS = [[255, 138, 61], [90, 162, 255], [63, 209, 139], [245, 197, 66]], KEY = [255, 106, 19];
function paint(x, y, s, bleed = false) {
  const c = s / 2, rad = s * .22;
  if (!bleed) { const dx = Math.max(Math.abs(x - c) - (c - rad), 0), dy = Math.max(Math.abs(y - c) - (c - rad), 0); if (Math.hypot(dx, dy) > rad) return [0, 0, 0, 0]; }
  // LCD window with four EQ bars
  const lx = s * .2, ly = s * .2, lw = s * .6, lh = s * .4;
  if (x > lx && x < lx + lw && y > ly && y < ly + lh) {
    const heights = [.55, .9, .4, .7];
    for (let i = 0; i < 4; i++) { const bx = lx + lw * (.12 + i * .2), bw = lw * .13; const top = ly + lh * (1 - heights[i]) * .9 + lh * .05; if (x > bx && x < bx + bw && y > top && y < ly + lh * .92) return [...BARS[i], 255]; }
    return [...LCD, 255];
  }
  // a round orange key
  if (Math.hypot(x - s * .5, y - s * .76) < s * .085) return [...KEY, 255];
  return [...BODY, 255];
}
mkdirSync(new URL('../app/icons/', import.meta.url), { recursive: true });
for (const size of [192, 512]) writeFileSync(new URL(`../app/icons/icon-${size}.png`, import.meta.url), png(size, paint));
writeFileSync(new URL('../app/icons/maskable-512.png', import.meta.url), png(512, (x, y, s) => paint((x - s * .1) / .8, (y - s * .1) / .8, s, true)));
console.log('icons written');
