// Song model: instruments, patterns (rows × 4 channels of [note, inst, vol, fx, param]), order list.
// Pure helpers for editing, note names, the tracker keyboard map, save files and share links.
import { CHANNELS, NOTE_OFF } from './synth.js';

export const NAMES = ['C-', 'C#', 'D-', 'D#', 'E-', 'F-', 'F#', 'G-', 'G#', 'A-', 'A#', 'B-'];
export const noteName = (n) => (n == null ? '···' : n === NOTE_OFF ? '===' : `${NAMES[n % 12]}${Math.floor(n / 12) - 1}`);
export const hex = (v, w = 2) => (v == null ? '·'.repeat(w) : v.toString(16).toUpperCase().padStart(w, '0'));

// Physical key → semitone offset from the current octave (works on any layout: uses KeyboardEvent.code)
export const KEYMAP = {
  KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6, KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11, Comma: 12, KeyL: 13, Period: 14, Semicolon: 15, Slash: 16,
  KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17, Digit5: 18, KeyT: 19, Digit6: 20, KeyY: 21, Digit7: 22, KeyU: 23, KeyI: 24, Digit9: 25, KeyO: 26, Digit0: 27, KeyP: 28,
};
export const keyToNote = (code, octave) => (code in KEYMAP ? Math.min(119, (octave + 1) * 12 + KEYMAP[code]) : null);

export const DEFAULT_INSTRUMENTS = [
  { name: 'Lead', wave: 'pulse', duty: 0.25, attack: 0, decay: 6, sustain: 10, release: 6, volume: 12, sweep: 0, vibDepth: 0.12, vibSpeed: 4, arp: null, noiseShort: false },
  { name: 'Square', wave: 'pulse', duty: 0.5, attack: 0, decay: 10, sustain: 8, release: 4, volume: 11, sweep: 0, vibDepth: 0, vibSpeed: 4, arp: null, noiseShort: false },
  { name: 'Bass', wave: 'triangle', duty: 0.5, attack: 0, decay: 0, sustain: 15, release: 3, volume: 15, sweep: 0, vibDepth: 0, vibSpeed: 4, arp: null, noiseShort: false },
  { name: 'Arp', wave: 'pulse', duty: 0.125, attack: 0, decay: 14, sustain: 6, release: 4, volume: 9, sweep: 0, vibDepth: 0, vibSpeed: 4, arp: null, noiseShort: false },
  { name: 'Kick', wave: 'triangle', duty: 0.5, attack: 0, decay: 6, sustain: 0, release: 0, volume: 15, sweep: -2.2, vibDepth: 0, vibSpeed: 4, arp: null, noiseShort: false },
  { name: 'Snare', wave: 'noise', duty: 0.5, attack: 0, decay: 7, sustain: 0, release: 0, volume: 12, sweep: 0, vibDepth: 0, vibSpeed: 4, arp: null, noiseShort: false },
  { name: 'Hat', wave: 'noise', duty: 0.5, attack: 0, decay: 2, sustain: 0, release: 0, volume: 7, sweep: 0, vibDepth: 0, vibSpeed: 4, arp: null, noiseShort: true },
  { name: 'Saw', wave: 'saw', duty: 0.5, attack: 1, decay: 10, sustain: 9, release: 8, volume: 10, sweep: 0, vibDepth: 0.08, vibSpeed: 3, arp: null, noiseShort: false },
];
export const blankInstrument = (n) => ({ ...DEFAULT_INSTRUMENTS[1], name: `Inst ${n}` });

export const emptyCell = () => [null, null, null, null, null];
export const emptyPattern = (rows = 32) => ({ rows, cells: Array.from({ length: rows }, () => Array.from({ length: CHANNELS }, emptyCell)) });

export function newSong() {
  return { title: 'Untitled', bpm: 125, speed: 6, instruments: structuredClone(DEFAULT_INSTRUMENTS), patterns: [emptyPattern()], order: [0] };
}

// The demo tune: A minor, Am–F–C–G, four channels (lead, arpeggio chords, triangle bass, drums).
export function demoSong() {
  const s = newSong();
  s.title = 'First Light';
  const P = () => emptyPattern(32);
  const put = (p, ch, row, note, inst, vol = null, fx = null, param = null) => { p.cells[row][ch] = [note, inst, vol, fx, param]; };
  const melodies = [
    [[0, 76], [4, 74], [6, 72], [8, 69], [12, 72], [14, 74], [16, 72], [20, 69], [22, 67], [24, 65], [28, 64], [30, NOTE_OFF]],
    [[0, 67], [4, 72], [6, 74], [8, 76], [12, 79], [14, 76], [16, 74], [20, 71], [22, 74], [24, 79], [28, 74], [30, NOTE_OFF]],
    [[0, 79], [2, 81], [4, 79], [6, 76], [8, 74], [12, 72], [14, 74], [16, 76], [20, 74], [24, 71], [26, 69], [28, 71], [30, NOTE_OFF]],
  ];
  const chords = [[[45, 0x37], [41, 0x47]], [[48, 0x47], [43, 0x47]], [[48, 0x47], [43, 0x47]]]; // root, arp 0xy
  s.patterns = melodies.map((mel, pi) => {
    const p = P();
    for (const [row, n] of mel) put(p, 0, row, n, n === NOTE_OFF ? null : 0);
    chords[pi].forEach(([root, arp], half) => {
      for (let r = 0; r < 16; r++) {
        const row = half * 16 + r;
        // arpeggio chord: a note on the downbeat, the arp effect held on every row
        p.cells[row][1] = [r === 0 ? root + 24 : null, r === 0 ? 3 : null, null, 0x0, arp];
        if (r % 2 === 0) put(p, 2, row, (r % 4 === 2 ? root + 12 : root), 2);
      }
    });
    const drums = ['K', null, 'H', null, 'S', null, 'H', null, 'K', null, 'K', null, 'S', null, 'H', 'H'];
    for (let r = 0; r < 32; r++) {
      const d = drums[r % 16];
      if (d === 'K') put(p, 3, r, 55, 4); else if (d === 'S') put(p, 3, r, 70, 5); else if (d === 'H') put(p, 3, r, 96, 6);
    }
    return p;
  });
  s.order = [0, 1, 0, 2];
  return s;
}

// ---- editing helpers (pure: return nothing, mutate the song passed in) ----
export function setCell(song, pat, row, ch, col, value) { song.patterns[pat].cells[row][ch][col] = value; }
export function clearCell(song, pat, row, ch) { song.patterns[pat].cells[row][ch] = emptyCell(); }
export function transpose(song, pat, ch, semis) {
  for (const row of song.patterns[pat].cells) { const c = row[ch]; if (c[0] != null && c[0] !== NOTE_OFF) c[0] = Math.max(0, Math.min(119, c[0] + semis)); }
}
export function addPattern(song, rows = 32) { song.patterns.push(emptyPattern(rows)); return song.patterns.length - 1; }
export function clonePattern(song, pat) { song.patterns.push(structuredClone(song.patterns[pat])); return song.patterns.length - 1; }
export function resizePattern(song, pat, rows) {
  const p = song.patterns[pat];
  rows = Math.max(1, Math.min(128, rows));
  while (p.cells.length < rows) p.cells.push(Array.from({ length: CHANNELS }, emptyCell));
  p.cells.length = rows; p.rows = rows;
}
// removing a pattern renumbers the order list; at least one pattern always remains
export function removePattern(song, pat) {
  if (song.patterns.length <= 1) return false;
  song.patterns.splice(pat, 1);
  song.order = song.order.filter((i) => i !== pat).map((i) => (i > pat ? i - 1 : i));
  if (!song.order.length) song.order = [0];
  return true;
}

// ---- files ----
const WAVE_SET = new Set(['pulse', 'saw', 'triangle', 'noise']);
export function serialize(song) { return { format: 'chiptune-studio', version: 1, ...structuredClone(song) }; }
export function deserialize(o) {
  if (!o || o.format !== 'chiptune-studio' || o.version !== 1) throw new Error('not a chiptune-studio song');
  const s = { title: String(o.title ?? 'Untitled').slice(0, 60), bpm: clampInt(o.bpm, 32, 255, 125), speed: clampInt(o.speed, 1, 31, 6), instruments: [], patterns: [], order: [] };
  s.instruments = (o.instruments ?? []).slice(0, 32).map((i) => ({ ...DEFAULT_INSTRUMENTS[1], ...i, wave: WAVE_SET.has(i.wave) ? i.wave : 'pulse' }));
  if (!s.instruments.length) s.instruments = structuredClone(DEFAULT_INSTRUMENTS);
  s.patterns = (o.patterns ?? []).map((p) => {
    const rows = clampInt(p.rows, 1, 128, 32);
    const cells = Array.from({ length: rows }, (_, r) => Array.from({ length: CHANNELS }, (_, ch) => {
      const c = p.cells?.[r]?.[ch];
      return Array.isArray(c) ? [0, 1, 2, 3, 4].map((k) => (c[k] == null ? null : Number(c[k]))) : emptyCell();
    }));
    return { rows, cells };
  });
  if (!s.patterns.length) s.patterns = [emptyPattern()];
  s.order = (o.order ?? [0]).map((i) => clampInt(i, 0, s.patterns.length - 1, 0));
  if (!s.order.length) s.order = [0];
  return s;
}
const clampInt = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };

// ---- share links: JSON → deflate-raw → base64url, decoded back in the browser or Node ----
const b64url = (bytes) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''); };
const unb64url = (str) => { const s = atob(str.replaceAll('-', '+').replaceAll('_', '/')); return Uint8Array.from(s, (c) => c.charCodeAt(0)); };
async function pipe(bytes, stream) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()); }
export async function encodeShare(song) { return b64url(await pipe(new TextEncoder().encode(JSON.stringify(serialize(song))), new CompressionStream('deflate-raw'))); }
export async function decodeShare(str) { return deserialize(JSON.parse(new TextDecoder().decode(await pipe(unb64url(str), new DecompressionStream('deflate-raw'))))); }
