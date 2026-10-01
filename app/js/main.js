// Chiptune Studio UI: pattern editor, instruments, order list, transport, files.
import { CHANNELS, NOTE_OFF, WAVES, DUTIES, renderSong } from './synth.js';
import * as G from './song.js';
import { encodeWav } from './wav.js';
import { t, setLang, getLang, applyI18n, detectLang } from './i18n.js';

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const CH_COLORS = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)'];
const COLS = ['n', 'i', 'v', 'f', 'p'];

const ui = Object.assign({ lang: null, octave: 4, step: 1, follow: true }, loadJson('chiptune:ui'));
let song = null;
const cur = { order: 0, row: 0, ch: 0, col: 0, inst: 0 };
const mute = [false, false, false, false], solo = [false, false, false, false];
let playing = null, playPos = null; // 'song' | 'pattern'
const undo = [], redo = [];

function loadJson(k) { try { return JSON.parse(localStorage.getItem(k) || '{}'); } catch { return {}; } }
function saveUi() { try { localStorage.setItem('chiptune:ui', JSON.stringify(ui)); } catch { /* private mode */ } }
let saveTimer;
function persist() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { localStorage.setItem('chiptune:song', JSON.stringify(G.serialize(song))); } catch { /* quota */ } }, 400); }
let toastTimer;
function toast(msg) { const n = $('#toast'); n.textContent = msg; n.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { n.hidden = true; }, 2400); }

const patIndex = () => song.order[cur.order];
const pattern = () => song.patterns[patIndex()];

// ---------- edits with undo ----------
function edit(fn, { rerender = 'grid' } = {}) {
  undo.push(JSON.stringify(song)); if (undo.length > 200) undo.shift(); redo.length = 0;
  fn();
  changed(rerender);
}
function changed(what = 'grid') {
  persist(); sendSong();
  if (what === 'all') renderAll(); else if (what === 'grid') renderGrid(); else if (what === 'order') { renderOrder(); renderGrid(); } else if (what === 'inst') renderInstruments();
}
function undoStep(stack, other) { if (!stack.length) return; other.push(JSON.stringify(song)); song = JSON.parse(stack.pop()); clampCursor(); changed('all'); }
function clampCursor() {
  cur.order = Math.min(cur.order, song.order.length - 1);
  cur.row = Math.min(cur.row, pattern().rows - 1);
  cur.inst = Math.min(cur.inst, song.instruments.length - 1);
}

// ---------- audio ----------
const audio = { ctx: null, node: null, analyser: null, ready: null, failed: false };
function ensureAudio() {
  if (audio.ready) return audio.ready;
  audio.ready = (async () => {
    try {
      audio.ctx = new AudioContext({ latencyHint: 'interactive' });
      await audio.ctx.audioWorklet.addModule('js/worklet.js');
      audio.node = new AudioWorkletNode(audio.ctx, 'chip-processor', { outputChannelCount: [2] });
      audio.analyser = audio.ctx.createAnalyser(); audio.analyser.fftSize = 1024;
      audio.node.connect(audio.analyser); audio.analyser.connect(audio.ctx.destination);
      audio.node.port.onmessage = ({ data }) => { if (data.type === 'pos') onPos(data); else if (data.type === 'meter') onMeter(data); };
      sendSong(true); sendMute();
      requestAnimationFrame(drawScope);
    } catch { audio.failed = true; toast(t('msg.noaudio')); }
    return audio;
  })();
  return audio.ready;
}
let songTimer;
function sendSong(now = false) {
  if (!audio.node) return;
  const post = () => audio.node.port.postMessage({ type: 'song', song: JSON.parse(JSON.stringify(song)) });
  clearTimeout(songTimer); if (now) post(); else songTimer = setTimeout(post, 40);
}
function effectiveMute() { const anySolo = solo.some(Boolean); return mute.map((m, i) => m || (anySolo && !solo[i])); }
function sendMute() { audio.node?.port.postMessage({ type: 'mute', mute: effectiveMute() }); }
async function play(mode) {
  await ensureAudio(); if (audio.failed) return;
  await audio.ctx.resume();
  sendSong(true);
  playing = mode;
  audio.node.port.postMessage(mode === 'song' ? { type: 'play', order: 0, row: 0 } : { type: 'play', order: cur.order, row: 0, loopPattern: cur.order });
  renderTransport();
}
function stop() { audio.node?.port.postMessage({ type: 'stop' }); playing = null; playPos = null; renderTransport(); renderGrid(); renderOrder(); }
async function jam(note) { await ensureAudio(); if (audio.failed) return; await audio.ctx.resume(); audio.node.port.postMessage({ type: 'jam', note, inst: cur.inst }); }

function onPos({ order, row }) {
  if (!playing) return;
  const prev = playPos; playPos = { order, row };
  if (ui.follow && order !== cur.order) { cur.order = order; renderOrder(); renderGrid(); }
  else if (prev?.order !== order) renderOrder();
  for (const r of document.querySelectorAll('.grid .row.playing')) r.classList.remove('playing');
  if (order === cur.order) {
    const rowEl = $(`.grid .row[data-row="${row}"]`);
    if (rowEl) { rowEl.classList.add('playing'); if (ui.follow) scrollGridTo(rowEl, true); }
  }
}
function onMeter({ peaks }) {
  document.querySelectorAll('.ch-head').forEach((h, i) => { $('.vu i', h).style.width = `${Math.min(100, (peaks[i] / 0.22) * 100)}%`; });
}
function drawScope() {
  const cv = $('#scope'), ctx = cv.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  if (cv.width !== cv.clientWidth * dpr) { cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr; }
  const w = cv.width, h = cv.height, data = new Float32Array(audio.analyser.fftSize);
  audio.analyser.getFloatTimeDomainData(data);
  let start = 0; for (let i = 1; i < data.length / 2; i++) if (data[i - 1] < 0 && data[i] >= 0) { start = i; break; }
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = '#3fd18b'; ctx.lineWidth = 1.5 * dpr; ctx.shadowColor = '#3fd18b'; ctx.shadowBlur = 6 * dpr; ctx.beginPath();
  const n = data.length / 2;
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * w, y = h / 2 - data[start + i] * h * 0.9; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
  ctx.stroke();
  requestAnimationFrame(drawScope);
}

// ---------- rendering ----------
function renderHeads() {
  const box = $('#ch-heads'); box.replaceChildren(el('div'));
  for (let ch = 0; ch < CHANNELS; ch++) {
    const h = el('div', `ch-head${effectiveMute()[ch] ? ' muted' : ''}`); h.style.setProperty('--chc', CH_COLORS[ch]); h.dataset.ch = ch;
    const nm = el('div', 'nm'); nm.append(el('span', null, t('ch.name', { n: ch + 1 })));
    const bs = el('span');
    const mb = el('button', 'tb', 'M'); mb.title = t('ch.mute'); mb.setAttribute('aria-pressed', String(mute[ch])); mb.dataset.mute = ch;
    const sb = el('button', 'tb', 'S'); sb.title = t('ch.solo'); sb.setAttribute('aria-pressed', String(solo[ch])); sb.dataset.solo = ch;
    mb.addEventListener('click', () => { mute[ch] = !mute[ch]; sendMute(); renderHeads(); });
    sb.addEventListener('click', () => { solo[ch] = !solo[ch]; sendMute(); renderHeads(); });
    bs.append(mb, document.createTextNode(' '), sb); nm.append(bs);
    const vu = el('div', 'vu'); vu.append(el('i'));
    h.append(nm, vu); box.append(h);
  }
}
function cellSpans(c) {
  const [note, inst, vol, fx, param] = c;
  return [
    ['n', G.noteName(note), note != null, note === NOTE_OFF],
    ['i', G.hex(inst == null ? null : inst + 1), inst != null],
    ['v', G.hex(vol, 1), vol != null],
    ['f', G.hex(fx, 1), fx != null],
    ['p', G.hex(param), param != null],
  ];
}
function renderGrid() {
  const grid = $('#grid'), top = grid.scrollTop, p = pattern();
  const frag = document.createDocumentFragment();
  for (let r = 0; r < p.rows; r++) {
    const row = el('div', `row${r === cur.row ? ' cursor' : ''}${playing && playPos && playPos.order === cur.order && playPos.row === r ? ' playing' : ''}`); row.dataset.row = r;
    row.append(el('span', 'rn', G.hex(r)));
    for (let ch = 0; ch < CHANNELS; ch++) {
      const cell = el('div', 'cell'); cell.style.setProperty('--chc', CH_COLORS[ch]); cell.dataset.ch = ch;
      cellSpans(p.cells[r][ch]).forEach(([k, txt, on, off], ci) => {
        const s = el('span', `${k}${on ? ' on' : ''}${off ? ' off' : ''}${r === cur.row && ch === cur.ch && ci === cur.col ? ' cur' : ''}`, txt);
        s.dataset.col = ci; cell.append(s);
      });
      row.append(cell);
    }
    frag.append(row);
  }
  grid.replaceChildren(frag);
  grid.scrollTop = top;
  $('#rows').value = p.rows;
}
// scroll only the grid, never the page
function scrollGridTo(rowEl, center = false) {
  const grid = $('#grid'), top = rowEl.offsetTop, h = rowEl.offsetHeight; // the grid is the rows' offsetParent
  if (center) grid.scrollTop = top - grid.clientHeight / 2 + h / 2;
  else if (top < grid.scrollTop) grid.scrollTop = top;
  else if (top + h > grid.scrollTop + grid.clientHeight) grid.scrollTop = top + h - grid.clientHeight;
}
function scrollCursor() { const r = $(`.grid .row[data-row="${cur.row}"]`); if (r) scrollGridTo(r); }
function renderOrder() {
  const ol = $('#order'); ol.replaceChildren();
  song.order.forEach((pi, i) => {
    const li = el('li'); li.dataset.idx = i;
    li.setAttribute('aria-selected', String(i === cur.order));
    if (playing && playPos?.order === i) li.classList.add('playing');
    li.append(el('span', null, G.hex(i)), el('span', null, `P${G.hex(pi)}`));
    li.addEventListener('click', () => { cur.order = i; clampCursor(); renderOrder(); renderGrid(); });
    ol.append(li);
  });
}
function renderInstruments() {
  const ul = $('#inst-list'); ul.replaceChildren();
  song.instruments.forEach((ins, i) => {
    const li = el('li'); li.dataset.inst = i; li.setAttribute('aria-selected', String(i === cur.inst));
    li.append(el('b', null, G.hex(i + 1)), el('span', null, ins.name), el('small', null, t(`wave.${ins.wave}`)));
    li.addEventListener('click', () => { cur.inst = i; renderInstruments(); });
    ul.append(li);
  });
  const I = song.instruments[cur.inst], box = $('#inst-edit'); box.replaceChildren();
  const field = (key, label, input, wide = false) => { const f = el('label', `field${wide ? ' wide' : ''}`); f.append(el('span', null, t(label)), input); input.dataset.key = key; box.append(f); return input; };
  const num = (key, label, min, max, stepv = 1) => {
    const inp = Object.assign(el('input'), { type: 'range', min, max, step: stepv, value: I[key] });
    inp.addEventListener('input', () => { I[key] = Number(inp.value); changed('none'); });
    inp.addEventListener('change', () => edit(() => {}, { rerender: 'inst' }));
    return field(key, label, inp);
  };
  const nameIn = Object.assign(el('input'), { type: 'text', value: I.name, maxLength: 16 });
  nameIn.addEventListener('change', () => edit(() => { I.name = nameIn.value.trim() || I.name; }, { rerender: 'inst' }));
  field('name', 'inst.name', nameIn, true);
  const wave = el('select'); for (const w of WAVES) wave.append(Object.assign(el('option', null, t(`wave.${w}`)), { value: w }));
  wave.value = I.wave; wave.addEventListener('change', () => edit(() => { I.wave = wave.value; }, { rerender: 'inst' }));
  field('wave', 'inst.wave', wave);
  if (I.wave === 'pulse') {
    const duty = el('select'); for (const d of DUTIES) duty.append(Object.assign(el('option', null, `${d * 100}%`), { value: d }));
    duty.value = I.duty; duty.addEventListener('change', () => edit(() => { I.duty = Number(duty.value); }, { rerender: 'inst' }));
    field('duty', 'inst.duty', duty);
  } else if (I.wave === 'noise') {
    const sh = Object.assign(el('input'), { type: 'checkbox', checked: I.noiseShort });
    sh.addEventListener('change', () => edit(() => { I.noiseShort = sh.checked; }, { rerender: 'inst' }));
    field('noiseShort', 'inst.short', sh);
  } else box.append(el('span'));
  num('attack', 'inst.attack', 0, 32); num('decay', 'inst.decay', 0, 48); num('sustain', 'inst.sustain', 0, 15); num('release', 'inst.release', 0, 48);
  num('volume', 'inst.volume', 0, 15); num('sweep', 'inst.sweep', -6, 6, 0.1); num('vibDepth', 'inst.vib', 0, 1, 0.02); num('vibSpeed', 'inst.vibspeed', 1, 16);
  const arp = Object.assign(el('input'), { type: 'text', value: I.arp ? I.arp.join(' ') : '', placeholder: '0 4 7' });
  arp.addEventListener('change', () => edit(() => { const v = arp.value.trim().split(/[\s,]+/).map(Number).filter((x) => Number.isFinite(x) && Math.abs(x) <= 24).slice(0, 8); I.arp = v.length > 1 ? v : null; }, { rerender: 'inst' }));
  field('arp', 'inst.arp', arp, true);
  box.append(el('p', 'note', t('inst.preview')));
}
function renderTransport() {
  $('#btn-play').setAttribute('aria-pressed', String(playing === 'song'));
  $('#btn-pattern').setAttribute('aria-pressed', String(playing === 'pattern'));
}
function renderFields() {
  $('#song-title').value = song.title; $('#bpm').value = song.bpm; $('#speed').value = song.speed;
  $('#octave').value = ui.octave; $('#step').value = ui.step; $('#follow').checked = ui.follow;
}
function renderAll() { renderHeads(); renderOrder(); renderGrid(); renderInstruments(); renderFields(); renderTransport(); }

// ---------- pattern editing ----------
function moveCursor(dRow, dCh = 0, dCol = 0) {
  const p = pattern();
  if (dCol) { let c = cur.col + dCol, ch = cur.ch; if (c < 0) { ch -= 1; c = COLS.length - 1; } if (c >= COLS.length) { ch += 1; c = 0; } if (ch >= 0 && ch < CHANNELS) { cur.ch = ch; cur.col = c; } }
  if (dCh) { cur.ch = (cur.ch + dCh + CHANNELS) % CHANNELS; }
  if (dRow) cur.row = ((cur.row + dRow) % p.rows + p.rows) % p.rows;
  renderGrid(); scrollCursor();
}
const hexDigit = (code) => { const m = /^(?:Digit|Numpad)([0-9])$/.exec(code); if (m) return Number(m[1]); const k = /^Key([A-F])$/.exec(code); return k ? 10 + k[1].charCodeAt(0) - 65 : null; };
function onGridKey(e) {
  if (e.ctrlKey || e.metaKey) {
    if (e.code === 'KeyZ') { e.preventDefault(); undoStep(undo, redo); }
    else if (e.code === 'KeyY') { e.preventDefault(); undoStep(redo, undo); }
    else if (e.shiftKey && (e.code === 'ArrowUp' || e.code === 'ArrowDown')) { e.preventDefault(); edit(() => G.transpose(song, patIndex(), cur.ch, e.code === 'ArrowUp' ? 1 : -1)); }
    return;
  }
  const nav = { ArrowUp: [-1], ArrowDown: [1], PageUp: [-16], PageDown: [16], ArrowLeft: [0, 0, -1], ArrowRight: [0, 0, 1] };
  if (nav[e.code]) { e.preventDefault(); moveCursor(...nav[e.code]); return; }
  if (e.code === 'Tab') { e.preventDefault(); cur.col = 0; moveCursor(0, e.shiftKey ? -1 : 1); return; }
  if (e.code === 'Home') { e.preventDefault(); cur.row = 0; renderGrid(); scrollCursor(); return; }
  if (e.code === 'End') { e.preventDefault(); cur.row = pattern().rows - 1; renderGrid(); scrollCursor(); return; }
  if (e.code === 'Delete' || e.code === 'Backspace') {
    e.preventDefault();
    edit(() => { if (cur.col === 0) G.clearCell(song, patIndex(), cur.row, cur.ch); else G.setCell(song, patIndex(), cur.row, cur.ch, cur.col, null); });
    moveCursor(ui.step); return;
  }
  if (e.repeat) return;
  if (cur.col === 0) {
    if (e.code === 'Digit1' || e.code === 'Backquote') { e.preventDefault(); edit(() => { const c = pattern().cells[cur.row][cur.ch]; c[0] = NOTE_OFF; c[1] = null; }); moveCursor(ui.step); return; }
    const note = G.keyToNote(e.code, ui.octave);
    if (note != null) {
      e.preventDefault();
      edit(() => { const c = pattern().cells[cur.row][cur.ch]; c[0] = note; c[1] = cur.inst; });
      jam(note); moveCursor(ui.step); return;
    }
  } else {
    const d = hexDigit(e.code);
    if (d != null) {
      e.preventDefault();
      edit(() => {
        const c = pattern().cells[cur.row][cur.ch];
        if (cur.col === 1) { const disp = (((c[1] == null ? 0 : c[1] + 1) << 4) | d) & 0xff; c[1] = disp === 0 ? null : Math.min(disp, song.instruments.length) - 1; cur.inst = c[1] ?? cur.inst; }
        else if (cur.col === 2 || cur.col === 3) c[cur.col] = d;
        else c[4] = (((c[4] ?? 0) << 4) | d) & 0xff;
      });
      if (cur.col === 2 || cur.col === 3) moveCursor(ui.step);
    }
  }
}
function onGridKeyUp(e) { if (cur.col === 0 && G.keyToNote(e.code, ui.octave) != null) audio.node?.port.postMessage({ type: 'jam', note: NOTE_OFF, inst: cur.inst }); }

// ---------- files ----------
const slug = (s) => (s || 'song').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'song';
function download(bytes, name, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
}
function loadSong(s, msg) { stop(); song = s; Object.assign(cur, { order: 0, row: 0, ch: 0, col: 0, inst: 0 }); undo.length = 0; redo.length = 0; persist(); sendSong(true); renderAll(); if (msg) toast(msg); }

function init() {
  setLang(ui.lang || detectLang()); $('#set-lang').value = getLang(); applyI18n();
  $('#set-lang').addEventListener('change', (e) => { ui.lang = e.target.value; saveUi(); setLang(ui.lang); applyI18n(); renderAll(); });
  $('#btn-play').addEventListener('click', () => (playing === 'song' ? stop() : play('song')));
  $('#btn-pattern').addEventListener('click', () => (playing === 'pattern' ? stop() : play('pattern')));
  $('#btn-stop').addEventListener('click', stop);
  $('#follow').addEventListener('change', (e) => { ui.follow = e.target.checked; saveUi(); });
  $('#song-title').addEventListener('change', (e) => edit(() => { song.title = e.target.value.trim() || 'Untitled'; }, { rerender: 'none' }));
  $('#bpm').addEventListener('change', (e) => edit(() => { song.bpm = Math.max(32, Math.min(255, Number(e.target.value) || 125)); }, { rerender: 'all' }));
  $('#speed').addEventListener('change', (e) => edit(() => { song.speed = Math.max(1, Math.min(31, Number(e.target.value) || 6)); }, { rerender: 'all' }));
  $('#octave').addEventListener('change', (e) => { ui.octave = Math.max(0, Math.min(8, Number(e.target.value) || 4)); saveUi(); renderFields(); });
  $('#step').addEventListener('change', (e) => { ui.step = Math.max(0, Math.min(16, Number(e.target.value) || 0)); saveUi(); renderFields(); });
  $('#rows').addEventListener('change', (e) => edit(() => G.resizePattern(song, patIndex(), Number(e.target.value) || 32), { rerender: 'grid' }));
  // order list
  $('#ord-add').addEventListener('click', () => edit(() => { song.order.splice(cur.order + 1, 0, song.order[cur.order]); cur.order += 1; }, { rerender: 'order' }));
  $('#ord-del').addEventListener('click', () => edit(() => { if (song.order.length > 1) { song.order.splice(cur.order, 1); clampCursor(); } }, { rerender: 'order' }));
  $('#ord-inc').addEventListener('click', () => edit(() => { song.order[cur.order] = Math.min(song.patterns.length - 1, song.order[cur.order] + 1); clampCursor(); }, { rerender: 'order' }));
  $('#ord-dec').addEventListener('click', () => edit(() => { song.order[cur.order] = Math.max(0, song.order[cur.order] - 1); clampCursor(); }, { rerender: 'order' }));
  $('#pat-new').addEventListener('click', () => edit(() => { const i = G.addPattern(song, pattern().rows); song.order.splice(cur.order + 1, 0, i); cur.order += 1; cur.row = 0; }, { rerender: 'order' }));
  $('#pat-clone').addEventListener('click', () => edit(() => { const i = G.clonePattern(song, patIndex()); song.order.splice(cur.order + 1, 0, i); cur.order += 1; }, { rerender: 'order' }));
  $('#inst-add').addEventListener('click', () => edit(() => { if (song.instruments.length < 32) { song.instruments.push(G.blankInstrument(song.instruments.length + 1)); cur.inst = song.instruments.length - 1; } }, { rerender: 'inst' }));
  // grid
  const grid = $('#grid');
  grid.addEventListener('keydown', onGridKey);
  grid.addEventListener('keyup', onGridKeyUp);
  grid.addEventListener('mousedown', (e) => {
    const span = e.target.closest('.cell span'), row = e.target.closest('.row');
    if (!span || !row) return;
    e.preventDefault(); // the clicked span is replaced by the re-render; keep focus on the grid ourselves
    cur.row = Number(row.dataset.row); cur.ch = Number(span.parentElement.dataset.ch); cur.col = Number(span.dataset.col);
    renderGrid(); grid.focus({ preventScroll: true });
  });
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
    e.preventDefault(); if (playing) stop(); else play('pattern');
  });
  // files
  $('#btn-new').addEventListener('click', () => { if (confirm(t('msg.confirmnew'))) loadSong(G.newSong()); });
  $('#btn-demo').addEventListener('click', () => loadSong(G.demoSong()));
  $('#btn-save').addEventListener('click', () => { download(JSON.stringify(G.serialize(song), null, 1), `${slug(song.title)}.json`, 'application/json'); toast(t('msg.saved')); });
  $('#btn-open').addEventListener('click', () => $('#file-open').click());
  $('#file-open').addEventListener('change', async () => {
    const f = $('#file-open').files[0]; $('#file-open').value = '';
    if (!f) return;
    try { loadSong(G.deserialize(JSON.parse(await f.text())), t('msg.loaded')); } catch { toast(t('msg.badfile')); }
  });
  $('#btn-wav').addEventListener('click', async () => {
    toast(t('msg.rendering'));
    await new Promise((r) => setTimeout(r, 30));
    const pcm = renderSong(song, 44100, { mute: effectiveMute() });
    download(encodeWav(pcm, 44100), `${slug(song.title)}.wav`, 'audio/wav');
    toast(t('msg.exported', { s: (pcm.length / 44100).toFixed(1) }));
  });
  $('#btn-share').addEventListener('click', async () => {
    const url = `${location.origin}${location.pathname}#s=${await G.encodeShare(song)}`;
    history.replaceState(null, '', url);
    try { await navigator.clipboard.writeText(url); } catch { /* clipboard blocked */ }
    toast(t('msg.copied'));
  });
  if ('serviceWorker' in navigator && location.protocol !== 'file:' && !new URLSearchParams(location.search).has('nosw')) navigator.serviceWorker.register('sw.js').catch(() => {});
  window.__chip = { get song() { return song; }, cur, ui, audio, get playing() { return playing; }, get playPos() { return playPos; }, G, renderSong, play, stop, mute, solo };
}

async function boot() {
  init();
  const hash = new URLSearchParams(location.hash.slice(1)).get('s');
  let msg = null;
  if (hash) { try { song = await G.decodeShare(hash); msg = t('msg.sharedsong'); } catch { song = null; } }
  if (!song) { const saved = loadJson('chiptune:song'); try { song = saved.format ? G.deserialize(saved) : null; } catch { song = null; } }
  if (!song) song = G.demoSong();
  renderAll();
  if (msg) toast(msg);
  window.__chip.ready = true;
}
boot();
