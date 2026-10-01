import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { decodeWav } from '../../app/js/wav.js';

async function fresh(page) {
  await page.goto('/?nosw=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => window.__chip?.ready);
}
const cell = (page, row, ch, col) => page.locator(`.grid .row[data-row="${row}"] .cell[data-ch="${ch}"] span[data-col="${col}"]`);
const song = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__chip.song)));

test.beforeEach(async ({ page }) => { await fresh(page); });

test('opens the demo song with four channels, eight instruments and an order list', async ({ page }) => {
  await expect(page).toHaveTitle('Chiptune Studio');
  await expect(page.locator('#song-title')).toHaveValue('First Light');
  await expect(page.locator('.ch-head')).toHaveCount(4);
  await expect(page.locator('#inst-list li')).toHaveCount(8);
  await expect(page.locator('#order li')).toHaveCount(4);
  await expect(page.locator('.grid .row')).toHaveCount(32);
  await expect(cell(page, 0, 0, 0)).toHaveText('E-5');
});

test('play runs the AudioWorklet and advances rows; stop halts it', async ({ page }) => {
  await page.click('#btn-play');
  await expect.poll(() => page.evaluate(() => window.__chip.audio.ctx?.state)).toBe('running');
  await expect.poll(() => page.evaluate(() => window.__chip.playPos?.row ?? -1), { timeout: 8000 }).toBeGreaterThan(4);
  await expect(page.locator('.grid .row.playing')).toHaveCount(1);
  await page.click('#btn-stop');
  expect(await page.evaluate(() => window.__chip.playing)).toBeNull();
  await expect(page.locator('.grid .row.playing')).toHaveCount(0);
});

test('keyboard note entry writes notes with the current instrument and advances by step', async ({ page }) => {
  await page.click('#btn-new');
  page.on('dialog', (d) => d.accept());
  await page.click('#btn-new');
  await page.locator('#octave').fill('4'); await page.locator('#octave').press('Enter');
  await cell(page, 0, 1, 0).click();
  await page.keyboard.press('z');   // C-4
  await page.keyboard.press('e');   // E-5 (upper row, +16)
  await page.keyboard.press('1');   // note off
  await expect(cell(page, 0, 1, 0)).toHaveText('C-4');
  await expect(cell(page, 0, 1, 1)).toHaveText('01');
  await expect(cell(page, 1, 1, 0)).toHaveText('E-5');
  await expect(cell(page, 2, 1, 0)).toHaveText('===');
  const s = await song(page);
  expect(s.patterns[0].cells[0][1]).toEqual([60, 0, null, null, null]);
  await page.keyboard.press('Control+z');
  await expect(cell(page, 2, 1, 0)).toHaveText('···');
  await page.keyboard.press('Control+y');
  await expect(cell(page, 2, 1, 0)).toHaveText('===');
});

test('hex entry in the volume and effect columns, delete clears', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await page.click('#btn-new');
  await cell(page, 4, 0, 0).click();
  await page.keyboard.press('x'); // D-4 at row 4
  await cell(page, 4, 0, 2).click();
  await page.keyboard.press('a'); // volume A
  await cell(page, 4, 0, 3).click();
  await page.keyboard.press('0'); // fx 0 = arpeggio
  await cell(page, 4, 0, 4).click();
  await page.keyboard.press('3'); await page.keyboard.press('7'); // param 37
  await expect(cell(page, 4, 0, 2)).toHaveText('A');
  await expect(cell(page, 4, 0, 3)).toHaveText('0');
  await expect(cell(page, 4, 0, 4)).toHaveText('37');
  expect((await song(page)).patterns[0].cells[4][0]).toEqual([62, 0, 10, 0, 0x37]);
  await cell(page, 4, 0, 0).click();
  await page.keyboard.press('Delete');
  expect((await song(page)).patterns[0].cells[4][0]).toEqual([null, null, null, null, null]);
});

test('order list: new pattern, clone, pattern number, remove', async ({ page }) => {
  await page.click('#pat-new');
  await expect(page.locator('#order li')).toHaveCount(5);
  await expect(page.locator('#order li[aria-selected="true"]')).toContainText('P03');
  await expect(cell(page, 0, 0, 0)).toHaveText('···');
  await page.click('#ord-dec');
  await expect(page.locator('#order li[aria-selected="true"]')).toContainText('P02');
  await page.click('#ord-del');
  await expect(page.locator('#order li')).toHaveCount(4);
  await page.locator('#rows').fill('16'); await page.locator('#rows').press('Enter');
  await expect(page.locator('.grid .row')).toHaveCount(16);
});

test('instrument editor changes the selected instrument', async ({ page }) => {
  await page.click('#inst-list li[data-inst="1"]');
  await expect(page.locator('#inst-edit [data-key="name"]')).toHaveValue('Square');
  await page.selectOption('#inst-edit [data-key="wave"]', 'saw');
  expect((await song(page)).instruments[1].wave).toBe('saw');
  await expect(page.locator('#inst-list li[data-inst="1"] small')).toHaveText('Saw');
  await page.locator('#inst-edit [data-key="arp"]').fill('0 3 7');
  await page.locator('#inst-edit [data-key="arp"]').press('Enter');
  expect((await song(page)).instruments[1].arp).toEqual([0, 3, 7]);
  await page.click('#inst-add');
  await expect(page.locator('#inst-list li')).toHaveCount(9);
});

test('WAV export matches the song length; mute and solo shape the mix', async ({ page }) => {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-wav')]);
  expect(dl.suggestedFilename()).toBe('first-light.wav');
  const wav = decodeWav(new Uint8Array(fs.readFileSync(await dl.path())));
  expect(wav.sampleRate).toBe(44100);
  const expected = await page.evaluate(() => window.__chip.renderSong(window.__chip.song, 44100).length);
  expect(wav.samples.length).toBe(expected);
  let peak = 0; for (const x of wav.samples) peak = Math.max(peak, Math.abs(x));
  expect(peak).toBeGreaterThan(0.2);
  await page.click('.ch-head [data-solo="2"]');
  await expect(page.locator('.ch-head.muted')).toHaveCount(3);
  await page.click('.ch-head [data-solo="2"]');
  await page.click('.ch-head [data-mute="0"]');
  await expect(page.locator('.ch-head.muted')).toHaveCount(1);
});

test('save and open a song file; share link restores the song in a new page', async ({ page, context }) => {
  await page.locator('#song-title').fill('My Tune'); await page.locator('#song-title').press('Enter');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-save')]);
  expect(dl.suggestedFilename()).toBe('my-tune.json');
  const buf = fs.readFileSync(await dl.path());
  await page.click('#btn-demo');
  await expect(page.locator('#song-title')).toHaveValue('First Light');
  await page.locator('#file-open').setInputFiles({ name: 'my-tune.json', mimeType: 'application/json', buffer: buf });
  await expect(page.locator('#song-title')).toHaveValue('My Tune');
  await page.locator('#file-open').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"a":1}') });
  await expect(page.locator('#toast')).toHaveText('That file is not a Chiptune Studio song.');
  await page.click('#btn-share');
  await expect(page).toHaveURL(/#s=[A-Za-z0-9_-]+/);
  const url = page.url();
  const other = await context.newPage();
  await other.goto(url.replace('/#', '/?nosw=1#'));
  await other.evaluate(() => localStorage.clear());
  await other.waitForFunction(() => window.__chip?.ready);
  await expect(other.locator('#song-title')).toHaveValue('My Tune');
});

test('Turkish interface, tempo fields, no console errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.selectOption('#set-lang', 'tr');
  await expect(page.locator('#btn-play')).toHaveText('Şarkıyı çal');
  await expect(page.locator('#inst-list li[data-inst="0"] small')).toHaveText('Kare');
  await page.locator('#bpm').fill('150'); await page.locator('#bpm').press('Enter');
  expect((await song(page)).bpm).toBe(150);
  await page.click('#btn-pattern');
  await expect.poll(() => page.evaluate(() => window.__chip.playPos?.row ?? -1), { timeout: 8000 }).toBeGreaterThan(2);
  await page.keyboard.press('Space');
  expect(await page.evaluate(() => window.__chip.playing)).toBeNull();
  expect(errors).toEqual([]);
});
