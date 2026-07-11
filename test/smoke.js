// End-to-end smoke test for Multiply. Drives the real app in headless
// Chromium via playwright-core: practice flow, retype mode, summary stats,
// history, sandbox, challenge codes, export/import, and mastery decay.
//
// Run:  cd test && npm install && npm test
// Pass --shots to also save screenshots (home/practice/summary) next to
// this script.
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const os = require('os');

const APP = 'file://' + path.resolve(__dirname, '..', 'index.html');
const SHOTS = process.argv.includes('--shots');

// playwright-core ships no browser. Use $CHROMIUM_PATH, else the newest
// Chromium from Playwright's cache, else fall back to system Chrome.
function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const roots = [
    path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'),
    path.join(os.homedir(), '.cache', 'ms-playwright'),
    path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright'),
  ];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const dirs = fs.readdirSync(root)
      .filter((d) => /^chromium(_headless_shell)?-\d+$/.test(d))
      .sort((a, b) => Number(b.match(/\d+$/)[0]) - Number(a.match(/\d+$/)[0]));
    for (const dir of dirs) {
      const candidates = [
        path.join(root, dir, 'chrome-mac', 'headless_shell'),
        path.join(root, dir, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
        path.join(root, dir, 'chrome-linux', 'headless_shell'),
        path.join(root, dir, 'chrome-linux', 'chrome'),
        path.join(root, dir, 'chrome-win', 'headless_shell.exe'),
        path.join(root, dir, 'chrome-win', 'chrome.exe'),
      ];
      for (const c of candidates) if (fs.existsSync(c)) return c;
    }
  }
  return null;
}

function fail(msg) { console.error('FAIL: ' + msg); process.exitCode = 1; }
function ok(msg) { console.log('ok: ' + msg); }

(async () => {
  const exe = findChromium();
  const browser = await chromium.launch(exe ? { executablePath: exe } : { channel: 'chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(APP);
  await page.waitForTimeout(300);

  // Home screen renders
  if (await page.locator('section#home.active').count() !== 1) fail('home screen not active');
  else ok('home screen active');
  const grid = await page.locator('#progress-grid td').count();
  if (grid !== 144) fail('progress grid has ' + grid + ' cells, expected 144');
  else ok('progress grid 144 cells');
  const rank = await page.locator('#player-level').textContent();
  if (!/Current Rank:/.test(rank)) fail('player level missing: ' + rank);
  else ok('player level: ' + rank.trim());

  // Starfield flies on the home screen (max drift across 10 stars over 700ms)
  const starDrift = (samples) => page.evaluate(async (n) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const stars = Array.from(document.querySelectorAll('.star')).slice(0, n);
    const before = stars.map((s) => s.getBoundingClientRect().left);
    await wait(700);
    return Math.max(...stars.map((s, i) => Math.abs(s.getBoundingClientRect().left - before[i])));
  }, samples);
  if (!(await page.locator('#star-field.flying').count())) fail('star-field missing flying class on home');
  else ok('star-field flying on home screen');
  const homeDrift = await starDrift(10);
  if (homeDrift < 1) fail('stars not drifting on home screen (max drift ' + homeDrift.toFixed(2) + 'px)');
  else ok('stars drifting on home (' + homeDrift.toFixed(1) + 'px max over 700ms)');

  // Start a quick session
  await page.click('#start-btn');
  await page.waitForTimeout(200);
  if (await page.locator('section#practice.active').count() !== 1) fail('practice screen not active');
  else ok('practice screen active after start');

  // Stars must hold still during practice (twinkle only)
  const practiceDrift = await starDrift(10);
  if (practiceDrift > 0.5) fail('stars drifting during practice (' + practiceDrift.toFixed(2) + 'px)');
  else ok('stars static during practice');

  const problem = await page.locator('#problem-display').textContent();
  const m = problem.match(/(\d+)\s*×\s*(\d+)/);
  if (!m) { fail('no problem displayed: ' + problem); }
  else {
    ok('problem shown: ' + problem.trim());
    // Answer correctly via keyboard
    const answer = String(Number(m[1]) * Number(m[2]));
    for (const ch of answer) await page.keyboard.press(ch);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);
    const score = await page.locator('#session-score').textContent();
    if (score.trim() !== '1 correct') fail('score after correct answer: ' + score);
    else ok('correct answer counted: ' + score.trim());
    const streak = await page.locator('#streak-display').textContent();
    if (!streak.startsWith('1 ')) fail('streak after correct answer: ' + streak);
    else ok('streak updated: ' + streak.trim());

    // Wait for next problem, answer wrongly -> retype flow
    await page.waitForTimeout(600);
    const p2 = (await page.locator('#problem-display').textContent()).match(/(\d+)\s*×\s*(\d+)/);
    const correct2 = Number(p2[1]) * Number(p2[2]);
    const wrong = String(correct2 === 1 ? 2 : 1);
    for (const ch of wrong) await page.keyboard.press(ch);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);
    const fb = await page.locator('#feedback').textContent();
    if (!fb.includes(String(correct2))) fail('wrong-answer feedback missing answer: ' + fb);
    else ok('wrong answer shows correction: ' + fb.trim());
    const placeholder = await page.locator('#answer-input').getAttribute('placeholder');
    if (placeholder !== String(correct2)) fail('retype placeholder: ' + placeholder);
    else ok('retype mode engaged (placeholder ' + placeholder + ')');
    // Retype the correct answer to advance
    for (const ch of String(correct2)) await page.keyboard.press(ch);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    const p3 = await page.locator('#problem-display').textContent();
    if (!/\d+\s*×\s*\d+/.test(p3)) fail('no next problem after retype: ' + p3);
    else ok('advanced to next problem after retype');
  }

  // End session -> summary
  await page.click('#end-btn');
  await page.waitForTimeout(200);
  if (await page.locator('section#summary.active').count() !== 1) fail('summary not shown after end');
  else ok('summary screen shown');
  const acc = await page.locator('#summary-accuracy').textContent();
  if (acc.trim() !== '50%') fail('summary accuracy: ' + acc + ' (expected 50%)');
  else ok('summary accuracy 50% (1 of 2)');

  // Back home, then history
  await page.click('#home-btn');
  await page.click('#history-btn');
  await page.waitForTimeout(100);
  const histCards = await page.locator('.history-summary-card').count();
  if (histCards !== 2) fail('history summary cards: ' + histCards);
  else ok('history summary cards render');
  await page.click('#history-back-btn');

  // Sandbox practice mode
  await page.click('#practice-mode-btn');
  await page.click('#practice-start-btn');
  await page.waitForTimeout(200);
  if (await page.locator('section#practice.active').count() !== 1) fail('sandbox practice not active');
  else ok('sandbox session starts');
  await page.click('#end-btn');
  await page.waitForTimeout(100);

  // Challenge: generate code and verify countdown screen
  await page.click('#home-btn');
  await page.click('#challenge-btn');
  await page.click('#generate-code-btn');
  await page.waitForTimeout(200);
  const code = await page.locator('#challenge-show-code').textContent();
  if (!/^[2-9A-HJ-KM-NP-Z]{4}-[2-9A-HJ-KM-NP-Z]{4}-[2-9A-HJ-KM-NP-Z]{4}$/.test(code.trim())) fail('challenge code format: ' + code);
  else ok('challenge code generated: ' + code.trim());
  if (await page.locator('section#challenge-wait.active').count() !== 1) fail('challenge wait screen not shown');
  else ok('challenge countdown screen shown');
  // Join with the same code from a fresh state
  await page.click('#challenge-cancel-btn');
  await page.fill('#challenge-code-input', code.trim());
  await page.click('#join-challenge-btn');
  await page.waitForTimeout(200);
  const joinErr = await page.locator('#challenge-join-error').textContent();
  if (joinErr.trim()) fail('join challenge error: ' + joinErr);
  else ok('join challenge accepted same code');

  // Export/import round-trip (inside collapsible transfer panel)
  await page.click('#challenge-cancel-btn'); // back to challenge screen
  await page.click('#challenge-back-btn');
  await page.click('.transfer-section summary');
  await page.click('#export-btn');
  const exportCode = await page.locator('#export-code').inputValue();
  if (!/^[0-9A-F]+$/.test(exportCode)) fail('export code not hex: ' + exportCode.slice(0, 20));
  else ok('export code generated (' + exportCode.length + ' hex chars)');
  await page.fill('#import-code', exportCode);
  await page.click('#import-btn');
  const importMsg = await page.locator('#import-msg').textContent();
  if (importMsg.trim() !== 'Progress imported!') fail('import failed: ' + importMsg);
  else ok('import round-trip succeeded');

  // Decay behavior: seed mastered facts with old lastCorrect timestamps
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('multiply-trainer'));
    const day = 86400000;
    // 5 days ago: inside 7-day grace, should still show weight 1 (gold)
    raw.facts['2x2'] = { weight: 1, correct: 5, attempts: 5, streak: 5, bestStreak: 5, lastCorrect: Date.now() - 5 * day };
    // 15 days ago: 8 days past grace -> 1 + 4*(8/14) = 3.29 -> weight 3 (silver)
    raw.facts['3x3'] = { weight: 1, correct: 5, attempts: 5, streak: 5, bestStreak: 5, lastCorrect: Date.now() - 15 * day };
    // 30 days ago: fully decayed -> weight 5 (none)
    raw.facts['4x4'] = { weight: 1, correct: 5, attempts: 5, streak: 5, bestStreak: 5, lastCorrect: Date.now() - 30 * day };
    localStorage.setItem('multiply-trainer', JSON.stringify(raw));
  });
  await page.reload();
  await page.waitForTimeout(200);
  const cell = async (key) => page.locator('#progress-grid td[title^="' + key + ':"]').getAttribute('title');
  const graceTitle = await cell('2x2');
  if (graceTitle !== '2x2: weight 1') fail('grace period: ' + graceTitle + ' (expected weight 1)');
  else ok('decay grace period holds gold for 7 days');
  const midTitle = await cell('3x3');
  if (midTitle !== '3x3: weight 3') fail('mid decay: ' + midTitle + ' (expected weight 3)');
  else ok('15-day-old fact decayed to weight 3');
  const fullTitle = await cell('4x4');
  if (fullTitle !== '4x4: weight 5') fail('full decay: ' + fullTitle + ' (expected weight 5)');
  else ok('30-day-old fact fully decayed to weight 5');

  // Decayed facts must re-enter the practice rotation (picker uses effective
  // weight). Master all facts recently except a fully-decayed 7x8, restrict a
  // sandbox session to the 7s: 7x8 has effective weight 5 vs 1 for the other
  // 22 keys, so it should be drawn (p = 25/47 per pick) within 25 problems.
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('multiply-trainer'));
    for (const k of Object.keys(raw.facts)) {
      raw.facts[k] = { weight: 1, correct: 5, attempts: 5, streak: 5, bestStreak: 5, lastCorrect: Date.now() };
    }
    raw.facts['7x8'].lastCorrect = Date.now() - 30 * 86400000;
    localStorage.setItem('multiply-trainer', JSON.stringify(raw));
  });
  await page.reload();
  await page.waitForTimeout(200);
  await page.click('#practice-mode-btn');
  await page.click('#practice-fact-toggles .fact-toggle[data-fact="all"]'); // deselect all
  await page.click('#practice-fact-toggles .fact-toggle[data-fact="7"]');
  await page.click('#practice-start-btn');
  await page.waitForTimeout(200);
  const decayedResurfaces = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 25; i++) {
      const text = document.getElementById('problem-display').textContent;
      if (text === '7 × 8') return true;
      const m = text.match(/(\d+)\s*×\s*(\d+)/);
      if (!m) return false;
      document.getElementById('answer-input').value = String(Number(m[1]) * Number(m[2]));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      await wait(600);
    }
    return false;
  });
  if (!decayedResurfaces) fail('decayed fact 7x8 never picked in 25 sandbox problems');
  else ok('decayed fact resurfaces in practice rotation');
  await page.click('#end-btn');
  await page.waitForTimeout(200);
  await page.click('#home-btn');

  // Reset flow uses an in-app modal (no native confirm)
  await page.click('.transfer-section summary');
  await page.click('#reset-btn');
  if (!(await page.locator('#reset-modal').isVisible())) fail('reset modal did not open');
  else ok('reset modal opens');
  await page.click('#reset-cancel-btn');
  const streakAfterCancel = await page.locator('#daily-streak').textContent();
  if (await page.locator('#reset-modal').isVisible()) fail('reset modal still open after cancel');
  else if (!streakAfterCancel.startsWith('1')) fail('progress lost after cancel: ' + streakAfterCancel);
  else ok('cancel closes modal and keeps progress');
  await page.click('#reset-btn');
  await page.click('#reset-confirm-btn');
  const streakAfterReset = await page.locator('#daily-streak').textContent();
  if (await page.locator('#reset-modal').isVisible()) fail('reset modal still open after confirm');
  else if (!streakAfterReset.startsWith('0')) fail('progress not reset: ' + streakAfterReset);
  else ok('confirm resets progress');

  if (errors.length) fail('console/page errors: ' + JSON.stringify(errors));
  else ok('no console or page errors');

  if (SHOTS) {
    await page.setViewportSize({ width: 390, height: 844 });
    const shot = (name) => page.screenshot({ path: path.join(__dirname, name + '.png'), fullPage: true });
    await shot('shot-home');
    await page.click('#start-btn');
    await page.waitForTimeout(300);
    await shot('shot-practice');
    await page.click('#end-btn');
    await page.waitForTimeout(200);
    await shot('shot-summary');
    ok('screenshots saved');
  }

  await browser.close();
  console.log(process.exitCode ? 'SMOKE TEST FAILED' : 'SMOKE TEST PASSED');
})().catch((e) => { console.error('FATAL: ' + e.message); process.exit(1); });
