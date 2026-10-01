import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from '../app/js/synth.js';
import * as G from '../app/js/song.js';
import { encodeWav, decodeWav } from '../app/js/wav.js';

const SR = 44100;
// a one-note song on channel 0 with a chosen instrument and optional effect, held for `rows` rows
function oneNote(inst, note = 69, { rows = 16, fx = null, param = null, speed = 6, bpm = 125 } = {}) {
  const s = G.newSong(); s.bpm = bpm; s.speed = speed; s.instruments = [inst];
  s.patterns = [G.emptyPattern(rows)]; s.patterns[0].cells[0][0] = [note, 0, null, fx, param];
  if (fx != null) for (let r = 1; r < rows; r++) s.patterns[0].cells[r][0] = [null, null, null, fx, param];
  return s;
}
const flat = { wave: 'pulse', duty: 0.5, attack: 0, decay: 0, sustain: 15, release: 0, volume: 15, sweep: 0, vibDepth: 0, vibSpeed: 4, arp: null, noiseShort: false };
// raw oscillator output: bypass DC blocker / clip by reading the voice directly
function rawVoice(inst, note, n, fx = null, param = null) {
  const p = new Y.Player(oneNote(inst, note, { fx, param }), SR, { loop: false });
  const out = new Float32Array(n); let tickLeft = 0;
  for (let i = 0; i < n; i++) { if (tickLeft <= 0) { p.doTick(); tickLeft += p.tickSamples; } tickLeft -= 1; out[i] = p.voiceSample(p.voices[0]); }
  return { out, p };
}
const crossings = (a) => { let c = 0; for (let i = 1; i < a.length; i++) if (a[i - 1] < 0 && a[i] >= 0) c++; return c; };

test('note table: A4 = 440 Hz, octaves double, tick timing follows bpm', () => {
  assert.equal(Y.midiToFreq(69), 440);
  assert.ok(Math.abs(Y.midiToFreq(81) - 880) < 1e-9);
  assert.ok(Math.abs(Y.midiToFreq(60) - 261.6256) < 1e-3);
  assert.equal(Y.tickRate(125), 50);
  assert.equal(Y.samplesPerTick(125, SR), 882);
  assert.equal(G.noteName(60), 'C-4'); assert.equal(G.noteName(70), 'A#4'); assert.equal(G.noteName(Y.NOTE_OFF), '==='); assert.equal(G.noteName(null), '···');
});

test('pulse oscillator: right pitch and duty cycle', () => {
  for (const duty of Y.DUTIES) {
    const { out } = rawVoice({ ...flat, duty }, 69, SR); // one second
    assert.ok(Math.abs(crossings(out) - 440) <= 2, `crossings ${crossings(out)}`);
    const high = out.filter((x) => x > 0).length / out.length;
    assert.ok(Math.abs(high - duty) < 0.01, `duty ${duty} measured ${high}`);
  }
});

test('triangle is 4-bit stepped (16 levels), saw too; both at the right pitch', () => {
  const tri = rawVoice({ ...flat, wave: 'triangle' }, 57, SR).out;
  assert.equal(new Set(Array.from(tri, (x) => x.toFixed(5))).size, 16);
  assert.ok(Math.abs(crossings(tri) - 220) <= 2);
  assert.deepEqual(Y.TRI_STEPS.slice(0, 3), [15, 14, 13]);
  const saw = rawVoice({ ...flat, wave: 'saw' }, 57, SR).out;
  assert.ok(new Set(Array.from(saw, (x) => x.toFixed(5))).size <= 16);
  assert.ok(Math.abs(crossings(saw) - 220) <= 2);
});

test('noise LFSR: 32767-step long mode, 93-step short mode', () => {
  const period = (short) => { const start = 1; let r = Y.lfsrStep(start, short), n = 1; while (r !== start && n < 40000) { r = Y.lfsrStep(r, short); n++; } return n; };
  assert.equal(period(false), 32767);
  const r0 = Y.lfsrStep(Y.lfsrStep(1, true), true); let r = Y.lfsrStep(r0, true), n = 1; while (r !== r0 && n < 1000) { r = Y.lfsrStep(r, true); n++; }
  assert.equal(n, 93);
});

test('envelope: attack ramps, decay settles at sustain, note-off releases to silence', () => {
  const inst = { ...flat, attack: 4, decay: 4, sustain: 6, release: 5 };
  const s = oneNote(inst, 60, { rows: 8 }); s.patterns[0].cells[4][0] = [Y.NOTE_OFF, null, null, null, null];
  const p = new Y.Player(s, SR, { loop: false });
  const env = []; for (let t = 0; t < 48; t++) { p.doTick(); env.push(+p.voices[0].env.toFixed(3)); }
  assert.ok(env[0] > 0 && env[0] < env[2] && env[3] === 1, `attack ${env.slice(0, 5)}`);
  assert.equal(env[10], +(6 / 15).toFixed(3), 'sustain level');
  assert.equal(env[30], 0, 'released');
  assert.equal(p.voices[0].active, false);
});

test('effects: arpeggio cycles notes per tick, slides move pitch, Fxx changes speed and tempo', () => {
  const s = oneNote(flat, 60, { fx: 0x0, param: 0x47 });
  const p = new Y.Player(s, SR, { loop: false });
  const f = []; for (let t = 0; t < 6; t++) { p.doTick(); f.push(Math.round(p.voices[0].freq)); }
  assert.deepEqual(f.slice(0, 3), [262, 330, 392], 'C–E–G');
  const up = new Y.Player(oneNote(flat, 60, { fx: 0x1, param: 0x10 }), SR, { loop: false });
  for (let t = 0; t < 12; t++) up.doTick();
  assert.ok(Math.abs(up.voices[0].freq - Y.midiToFreq(72)) < 0.5, `slide up 12 ticks × 1 semitone: ${up.voices[0].freq}`);
  const dn = new Y.Player(oneNote(flat, 60, { fx: 0x2, param: 0x10 }), SR, { loop: false });
  for (let t = 0; t < 13; t++) dn.doTick();
  assert.ok(dn.voices[0].freq < Y.midiToFreq(60));
  const sp = oneNote(flat, 60); sp.patterns[0].cells[0][1] = [null, null, null, 0xf, 3];
  const ps = new Y.Player(sp, SR, { loop: false }); ps.doTick(); assert.equal(ps.speed, 3);
  sp.patterns[0].cells[0][1] = [null, null, null, 0xf, 150];
  const pt = new Y.Player(sp, SR, { loop: false }); pt.doTick(); assert.equal(pt.bpm, 150); assert.equal(pt.tickSamples, SR / 60);
});

test('instrument sweep drops a kick drum pitch', () => {
  const kick = { ...flat, wave: 'triangle', sweep: -2.2, decay: 6, sustain: 0 };
  const p = new Y.Player(oneNote(kick, 55), SR, { loop: false });
  p.doTick(); const f0 = p.voices[0].freq; for (let t = 0; t < 4; t++) p.doTick();
  assert.ok(p.voices[0].freq < f0 * 0.65, `${p.voices[0].freq} vs ${f0}`);
});

test('song length: rows × speed × samples per tick, honouring Fxx', () => {
  const s = G.newSong(); s.patterns = [G.emptyPattern(16)]; s.order = [0, 0];
  assert.equal(Y.songSamples(s, SR), 2 * 16 * 6 * 882);
  s.patterns[0].cells[0][0] = [null, null, null, 0xf, 3];
  assert.equal(Y.songSamples(s, SR), 2 * 16 * 3 * 882);
  const pcm = Y.renderSong(G.demoSong(), SR, { tail: 0 });
  assert.equal(pcm.length, Y.songSamples(G.demoSong(), SR));
});

test('rendering is deterministic, bounded, and mutes silence channels', () => {
  const a = Y.renderSong(G.demoSong(), SR), b = Y.renderSong(G.demoSong(), SR);
  assert.deepEqual(a.slice(0, 5000), b.slice(0, 5000));
  assert.equal(a.length, b.length);
  let peak = 0; for (const x of a) peak = Math.max(peak, Math.abs(x));
  assert.ok(peak > 0.2 && peak < 1, `peak ${peak}`);
  const silent = Y.renderSong(G.demoSong(), SR, { mute: [true, true, true, true] });
  assert.ok(silent.every((x) => Math.abs(x) < 1e-6));
});

test('the live player and the exporter produce the same samples', () => {
  const song = G.demoSong();
  const offline = Y.renderSong(song, SR, { tail: 0 });
  const live = new Y.Player(song, SR, { loop: true });
  const chunk = new Float32Array(128), got = [];
  for (let i = 0; i < 400; i++) { live.process(chunk); got.push(...chunk); }
  assert.deepEqual(got.slice(0, 51200), Array.from(offline.slice(0, 51200)));
});

test('loopPattern keeps playback inside one order slot; stop fades out', () => {
  const song = G.demoSong();
  const p = new Y.Player(song, SR); p.reset(1, 0); p.loopPattern = 1;
  for (let t = 0; t < 32 * 6 * 3; t++) p.doTick();
  assert.equal(p.order, 1);
  p.stop(); const buf = new Float32Array(SR); p.process(buf);
  assert.ok(Math.abs(buf[SR - 1]) < 0.01, 'silent after release');
});

test('WAV: valid header, round-trips samples within 16-bit precision', () => {
  const x = Float32Array.from({ length: 1000 }, (_, i) => Math.sin(i / 10) * 0.8);
  const bytes = encodeWav(x, SR);
  assert.equal(String.fromCharCode(...bytes.subarray(0, 4)), 'RIFF');
  assert.equal(bytes.length, 44 + 2000);
  const back = decodeWav(bytes);
  assert.equal(back.sampleRate, SR); assert.equal(back.bits, 16); assert.equal(back.channels, 1);
  for (let i = 0; i < x.length; i++) assert.ok(Math.abs(back.samples[i] - x[i]) < 1 / 16000);
});

test('song editing helpers and the tracker keyboard map', () => {
  const s = G.newSong();
  G.setCell(s, 0, 3, 1, 0, 60); assert.equal(s.patterns[0].cells[3][1][0], 60);
  G.transpose(s, 0, 1, 5); assert.equal(s.patterns[0].cells[3][1][0], 65);
  const p2 = G.clonePattern(s, 0); s.order = [0, 1, 0];
  assert.equal(s.patterns[p2].cells[3][1][0], 65);
  G.removePattern(s, 0); assert.deepEqual(s.order, [0]);
  assert.equal(G.removePattern(s, 0), false, 'last pattern stays');
  G.resizePattern(s, 0, 48); assert.equal(s.patterns[0].cells.length, 48);
  assert.equal(G.keyToNote('KeyZ', 4), 60); assert.equal(G.keyToNote('KeyQ', 4), 72); assert.equal(G.keyToNote('KeyS', 3), 49); assert.equal(G.keyToNote('KeyA', 4), null);
  assert.equal(G.hex(10), '0A'); assert.equal(G.hex(null, 1), '·');
});

test('save files and share links round-trip; bad input is rejected or sanitised', async () => {
  const s = G.demoSong();
  const back = G.deserialize(JSON.parse(JSON.stringify(G.serialize(s))));
  assert.deepEqual(back.patterns, s.patterns); assert.deepEqual(back.order, s.order); assert.equal(back.title, 'First Light');
  assert.throws(() => G.deserialize({ format: 'nope' }));
  const weird = G.deserialize({ format: 'chiptune-studio', version: 1, bpm: 9999, speed: 0, instruments: [{ wave: 'laser' }], patterns: [{ rows: 2, cells: [[[60, 0]]] }], order: [7] });
  assert.equal(weird.bpm, 255); assert.equal(weird.speed, 1); assert.equal(weird.instruments[0].wave, 'pulse'); assert.deepEqual(weird.order, [0]);
  assert.deepEqual(weird.patterns[0].cells[0][0], [60, 0, null, null, null]);
  const link = await G.encodeShare(s);
  assert.match(link, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual((await G.decodeShare(link)).patterns, s.patterns);
});

test('i18n: English and Turkish have the same keys', async () => {
  const { STRINGS } = await import('../app/js/i18n.js');
  assert.deepEqual(Object.keys(STRINGS.tr).sort(), Object.keys(STRINGS.en).sort());
});
