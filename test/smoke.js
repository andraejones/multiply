// End-to-end smoke test for Multiply. Drives the real app in headless
// Chromium via playwright-core: practice flow, retype mode, summary stats,
// history, sandbox, challenge codes, export/import, mastery decay, player
// name, shared history links, focus-aware sound, and regressions for
// round-timer, persistence, and music races.
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

  // Start a quick session (it gets ended early below, which must undo it)
  const savedFacts = () => page.evaluate(() => localStorage.getItem('multiply-trainer') && JSON.stringify(JSON.parse(localStorage.getItem('multiply-trainer')).facts));
  const factsBefore = await savedFacts();
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
    // Re-submitting during the feedback pause must not grade the fact again
    for (const ch of answer) await page.keyboard.press(ch);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(50);
    const rescore = await page.locator('#session-score').textContent();
    if (rescore.trim() !== '1 correct') fail('answer double-counted during feedback pause: ' + rescore);
    else ok('re-submit during feedback pause ignored');

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

  // End session -> confirmation modal; cancel resumes the round
  await page.click('#end-btn');
  if (!(await page.locator('#end-modal').isVisible())) fail('end-round modal did not open');
  else ok('end-round modal opens');
  await page.click('#end-cancel-btn');
  if (await page.locator('#end-modal').isVisible() || await page.locator('section#practice.active').count() !== 1) fail('cancel did not resume the round');
  else ok('keep playing resumes the round');
  // Confirm -> summary
  await page.click('#end-btn');
  await page.click('#end-confirm-btn');
  await page.waitForTimeout(200);
  if (await page.locator('section#summary.active').count() !== 1) fail('summary not shown after end');
  else ok('summary screen shown');
  const acc = await page.locator('#summary-accuracy').textContent();
  if (acc.trim() !== '50%') fail('summary accuracy: ' + acc + ' (expected 50%)');
  else ok('summary accuracy 50% (1 of 2)');

  // Ending early: the summary says so, and nothing from the round counts
  const earlyMsg = await page.locator('#summary-message').textContent();
  if (!earlyMsg.includes("won't count")) fail('early-end summary message: ' + earlyMsg);
  else ok('summary explains an early end does not count');
  await page.click('#home-btn');
  const earlyHome = {
    best: (await page.locator('#personal-best').textContent()).trim(),
    streak: (await page.locator('#daily-streak').textContent()).trim(),
    lastRound: await page.locator('#last-round-btn').isVisible(),
  };
  if (!earlyHome.best.startsWith('0/min') || !earlyHome.streak.startsWith('0') || earlyHome.lastRound) fail('early-ended round counted: ' + JSON.stringify(earlyHome));
  else ok('early end skips personal best, daily streak, last round stats');
  if (await savedFacts() !== factsBefore) fail('early-ended round left fact progress behind');
  else ok('early end rolls fact progress back');
  await page.click('#history-btn');
  await page.waitForTimeout(100);
  if (await page.locator('.history-summary-card').count() !== 0) fail('early-ended round added to history');
  else ok('early end adds nothing to history');
  await page.click('#history-back-btn');

  // Sandbox practice mode
  await page.click('#practice-mode-btn');
  await page.click('#practice-start-btn');
  await page.waitForTimeout(200);
  if (await page.locator('section#practice.active').count() !== 1) fail('sandbox practice not active');
  else ok('sandbox session starts');
  await page.click('#end-btn');
  await page.click('#end-confirm-btn');
  await page.waitForTimeout(100);

  // A round ended mid feedback pause must not advance the next round: type a
  // digit into the new round's first problem and make sure it isn't wiped.
  await page.click('#home-btn');
  await page.click('#start-btn');
  await page.waitForTimeout(100);
  const pq = (await page.locator('#problem-display').textContent()).match(/(\d+)\s*×\s*(\d+)/);
  for (const ch of String(Number(pq[1]) * Number(pq[2]))) await page.keyboard.press(ch);
  await page.keyboard.press('Enter');
  await page.click('#end-btn');
  await page.click('#end-confirm-btn');
  await page.click('#restart-btn');
  await page.keyboard.press('7');
  await page.waitForTimeout(600);
  const carried = await page.locator('#answer-input').inputValue();
  if (carried !== '7') fail('stale timer from previous round advanced the new round');
  else ok('previous round\'s pending advance does not leak into the next');
  await page.click('#end-btn');
  await page.click('#end-confirm-btn');
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
  // A truncated code that happens to carry a valid checksum must be rejected
  const crc8 = (bytes) => bytes.reduce((crc, byte) => {
    crc ^= byte;
    for (let j = 0; j < 8; j++) crc = (crc & 0x80) ? ((crc << 1) ^ 0x07) & 0xFF : (crc << 1) & 0xFF;
    return crc;
  }, 0);
  const shortBytes = exportCode.slice(0, -4).match(/../g).map((h) => parseInt(h, 16));
  shortBytes.push(crc8(shortBytes));
  await page.fill('#import-code', shortBytes.map((b) => b.toString(16).padStart(2, '0')).join(''));
  await page.click('#import-btn');
  const shortMsg = (await page.locator('#import-msg').textContent()).trim();
  if (shortMsg !== 'Invalid code: wrong length') fail('truncated import code not rejected: ' + shortMsg);
  else ok('truncated import code rejected');

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
  await page.click('#end-confirm-btn');
  await page.waitForTimeout(200);
  await page.click('#home-btn');

  // Reset flow uses an in-app modal (no native confirm)
  await page.click('.transfer-section summary');
  await page.click('#reset-btn');
  if (!(await page.locator('#reset-modal').isVisible())) fail('reset modal did not open');
  else ok('reset modal opens');
  await page.click('#reset-cancel-btn');
  // 2x2 was mastered (weight 1) by the decay setup above
  const afterCancel = await cell('2x2');
  if (await page.locator('#reset-modal').isVisible()) fail('reset modal still open after cancel');
  else if (afterCancel !== '2x2: weight 1') fail('progress lost after cancel: ' + afterCancel);
  else ok('cancel closes modal and keeps progress');
  await page.click('#reset-btn');
  await page.click('#reset-confirm-btn');
  const afterReset = await cell('2x2');
  if (await page.locator('#reset-modal').isVisible()) fail('reset modal still open after confirm');
  else if (afterReset !== '2x2: weight 5') fail('progress not reset: ' + afterReset);
  else ok('confirm resets progress');

  // A lapsed daily streak reads 0 on the home screen (it resets on next play)
  const homeStreak = (daysAgo) => page.evaluate((n) => {
    const raw = JSON.parse(localStorage.getItem('multiply-trainer'));
    const d = new Date();
    d.setDate(d.getDate() - n);
    raw.dailyStreak = 4;
    raw.lastPracticeDate = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    localStorage.setItem('multiply-trainer', JSON.stringify(raw));
  }, daysAgo).then(() => page.reload()).then(() => page.locator('#daily-streak').textContent());
  const aliveStreak = await homeStreak(1);
  const lapsedStreak = await homeStreak(3);
  if (!aliveStreak.startsWith('4')) fail('streak from yesterday not shown: ' + aliveStreak);
  else if (!lapsedStreak.startsWith('0')) fail('lapsed streak still shown: ' + lapsedStreak);
  else ok('daily streak shows while alive, 0 once lapsed');

  // A round played to the end does count. A fake clock runs a 1-minute
  // round in moments; unanswered problems time out as misses along the way.
  const fpage = await browser.newPage();
  fpage.on('pageerror', (e) => errors.push(e.message));
  await fpage.clock.install();
  await fpage.goto(APP);
  await fpage.waitForTimeout(300);
  // The name is optional: no prompt, just an invitation on the home screen
  const noName = (await fpage.locator('#name-btn').textContent()).trim();
  if (!noName.startsWith('Add your name') || await fpage.locator('#name-modal').isVisible()) fail('name should be optional: ' + noName);
  else ok('name is optional (home shows "' + noName + '")');
  await fpage.click('#name-btn');
  await fpage.fill('#name-input', '  Maya   ');
  await fpage.click('#name-save-btn');
  const greet = (await fpage.locator('#name-btn').textContent()).trim();
  if (!greet.startsWith('Hi, Maya!')) fail('name greeting: ' + greet);
  else ok('name saved and greets the player: ' + greet);
  await fpage.click('#timer-buttons button[data-minutes="1"]');
  await fpage.click('#start-btn');
  const fq = (await fpage.locator('#problem-display').textContent()).match(/(\d+)\s*×\s*(\d+)/);
  for (const ch of String(Number(fq[1]) * Number(fq[2]))) await fpage.keyboard.press(ch);
  await fpage.keyboard.press('Enter');
  await fpage.clock.runFor('01:05');
  const fullMsg = await fpage.locator('#summary-message').textContent();
  if (await fpage.locator('section#summary.active').count() !== 1 || fullMsg.includes("won't count")) fail('full round did not finish normally: ' + fullMsg);
  else ok('full round ends on its own timer');
  if (!fullMsg.includes(', Maya!')) fail('summary not personalized: ' + fullMsg);
  else ok('summary cheers the player by name');
  await fpage.click('#home-btn');
  const fullStreak = (await fpage.locator('#daily-streak').textContent()).trim();
  if (!fullStreak.startsWith('1')) fail('full round did not count toward daily streak: ' + fullStreak);
  else ok('full round counts toward daily streak');
  await fpage.reload();
  await fpage.waitForTimeout(200);
  if (!(await fpage.locator('#last-round-btn').isVisible())) fail('last round stats lost on reload');
  else ok('last round stats saved and survive reload');
  if ((await fpage.locator('#name-btn').textContent()).trim() !== 'Hi, Maya! 👋') fail('name lost on reload');
  else ok('name survives reload');
  await fpage.click('#history-btn');
  if (await fpage.locator('.history-summary-card').count() !== 2) fail('full round missing from history');
  else ok('full round recorded in history');
  const dayRec = await fpage.evaluate(() => Object.values(JSON.parse(localStorage.getItem('multiply-trainer')).history)[0]);
  if (!(dayRec.minutes > 0.9 && dayRec.timedCorrect === dayRec.correct && typeof dayRec.rounds[0].rate === 'number')) fail('round speed data not saved: ' + JSON.stringify(dayRec));
  else ok('round saves minutes played and speed');
  const oneDayNote = await fpage.locator('#trend-chart-note').textContent();
  if (!(await fpage.locator('#progress-trends').isVisible()) || !/another day/.test(oneDayNote)) fail('progress section after one day: ' + oneDayNote);
  else ok('progress section asks for another day before drawing a trend');
  if ((await fpage.locator('#history-title').textContent()) !== "Maya's History") fail('history title not personalized');
  else ok('history titled with the player\'s name');

  // Share one day of history by link. The name must not be readable in the
  // link, even after undoing the base64.
  const myRow = (await fpage.locator('#history-list .history-day').first().textContent()).replace('📲', '').trim();
  const myRounds = await fpage.locator('#history-list .history-round').allTextContents();
  if (myRounds.length !== 1 || !/^\d{1,2}:\d{2} (AM|PM) · 1 min round\d+\/\d+ \d+%$/.test(myRounds[0])) fail('round details in history: ' + JSON.stringify(myRounds));
  else ok('history lists the round with time and timer: ' + myRounds[0]);
  await fpage.click('#history-list .history-day-share');
  if (!(await fpage.locator('#share-modal').isVisible())) fail('share modal did not open');
  const link = await fpage.locator('#share-link').inputValue();
  const linkCode = new URL(link).searchParams.get('history');
  const linkBytes = linkCode && Buffer.from(linkCode, 'base64url');
  if (!linkCode || /maya/i.test(link) || /maya/i.test(linkBytes.toString('latin1'))) fail('history link missing or exposes the name: ' + link);
  else ok('history link hides the name (' + linkCode.length + ' chars)');
  await fpage.click('#share-close-btn');
  await fpage.click('#history-share-week-btn');
  const weekText = (await fpage.locator('#share-modal-text').textContent()).trim();
  if (!weekText.startsWith('Last 7 days')) fail('last-7-days share: ' + weekText);
  else ok('last 7 days can be shared: ' + weekText);
  await fpage.close();

  // Opening the link in someone else's app shows the shared history with
  // the sender's name, without touching the recipient's own data
  const rpage = await browser.newPage();
  rpage.on('pageerror', (e) => errors.push(e.message));
  await rpage.goto(APP + '?history=' + linkCode);
  await rpage.waitForTimeout(300);
  const shared = {
    active: await rpage.locator('section#shared-history.active').count(),
    title: await rpage.locator('#shared-title').textContent(),
    by: await rpage.locator('#shared-by').textContent(),
    row: (await rpage.locator('#shared-history-list .history-day').first().textContent()).trim(),
    rows: await rpage.locator('#shared-history-list .history-day').count(),
    rounds: await rpage.locator('#shared-history-list .history-round').allTextContents(),
    rank: await rpage.locator('#shared-rank').textContent(),
    query: await rpage.evaluate(() => location.search),
  };
  if (shared.active !== 1 || shared.title !== "Maya's History" || shared.by !== 'Shared by Maya' || shared.rows !== 1 || shared.row !== myRow ||
    shared.rounds.join() !== myRounds.join() || shared.rank !== 'Rank: 🧑‍🚀 Space Cadet' || shared.query) fail('shared history view: ' + JSON.stringify(shared) + ' expected row ' + myRow);
  else ok('shared link shows the sender\'s name, rank, and rounds: ' + shared.rank + ', ' + shared.rounds[0]);
  const recipientHistory = await rpage.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('multiply-trainer')).history).length);
  if (recipientHistory !== 0) fail('shared history leaked into the recipient\'s own history');
  else ok('shared history is view-only for the recipient');
  await rpage.click('#shared-history-home-btn');
  if (await rpage.locator('section#home.active').count() !== 1) fail('shared view did not return home');
  else ok('shared view returns to the recipient\'s home');
  // An edited link (e.g. trying to pass off someone else's history) is refused
  const mid = Math.floor(linkCode.length / 2);
  const tampered = linkCode.slice(0, mid) + (linkCode[mid] === 'A' ? 'B' : 'A') + linkCode.slice(mid + 1);
  await rpage.goto(APP + '?history=' + tampered);
  await rpage.waitForTimeout(200);
  const tamperMsg = await rpage.locator('#shared-by').textContent();
  if (!/broken or was changed/.test(tamperMsg) || await rpage.locator('#shared-history-list .history-day').count()) fail('tampered link accepted: ' + tamperMsg);
  else ok('edited history link is rejected');

  // Days from before per-round details existed keep their totals as an
  // "Other rounds" line, and the round's clock time and timer survive a link
  await rpage.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('multiply-trainer'));
    const at = new Date();
    at.setHours(16, 15, 0, 0);
    const today = at.getFullYear() + '-' + String(at.getMonth() + 1).padStart(2, '0') + '-' + String(at.getDate()).padStart(2, '0');
    raw.history = { [today]: { correct: 50, total: 60, rounds: [{ time: at.getTime(), minutes: 3, mode: 'challenge', correct: 20, total: 25 }] } };
    localStorage.setItem('multiply-trainer', JSON.stringify(raw));
  });
  await rpage.goto(APP);
  await rpage.click('#history-btn');
  const mixedRounds = await rpage.locator('#history-list .history-round').allTextContents();
  const mixedExpected = ['4:15 PM · 3 min challenge20/25 80%', 'Other rounds30/35 86%'];
  if (mixedRounds.join('|') !== mixedExpected.join('|')) fail('round lines with older totals: ' + JSON.stringify(mixedRounds));
  else ok('older rounds without details show as "Other rounds"');
  await rpage.click('#history-list .history-day-share');
  const mixedCode = new URL(await rpage.locator('#share-link').inputValue()).searchParams.get('history');
  await rpage.goto(APP + '?history=' + mixedCode);
  await rpage.waitForTimeout(200);
  const mixedShared = await rpage.locator('#shared-history-list .history-round').allTextContents();
  if (mixedShared.join('|') !== mixedExpected.join('|')) fail('shared round details: ' + JSON.stringify(mixedShared));
  else ok('round time, timer, and mode survive the link');

  // Links sent before rank and round details were added still open
  // (fixture: Maya, Oct 2-3 2026, made by the version 1 encoder)
  await rpage.goto(APP + '?history=gxT8yPOBf3plJT9u4aREc_l_ljpXYka0Nw');
  await rpage.waitForTimeout(200);
  const v1 = {
    title: await rpage.locator('#shared-title').textContent(),
    days: await rpage.locator('#shared-history-list .history-day').allTextContents(),
    rounds: await rpage.locator('#shared-history-list .history-round').count(),
    rankShown: await rpage.locator('#shared-rank').isVisible(),
  };
  if (v1.title !== "Maya's History" || v1.days.join('|') !== 'Oct 3, 202642/45 93%|Oct 2, 202630/36 83%' || v1.rounds || v1.rankShown) fail('version 1 link: ' + JSON.stringify(v1));
  else ok('links in the original format still open');
  await rpage.close();

  // Progress over time: week-over-week tiles, chart, numbers table, and the
  // rank ladder, all from seeded history with known answers
  const tpage = await browser.newPage();
  tpage.on('pageerror', (e) => errors.push(e.message));
  await tpage.goto(APP);
  const seedTrends = (lastPlayedAgo) => tpage.evaluate((away) => {
    const raw = JSON.parse(localStorage.getItem('multiply-trainer'));
    const ymd = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    raw.history = {
      [ymd(1)]: { correct: 45, total: 50, minutes: 5, timedCorrect: 45 },
      [ymd(3)]: { correct: 10, total: 10 },                                // from before speed was saved
      [ymd(9)]: { correct: 30, total: 40, minutes: 5, timedCorrect: 30 },
    };
    raw.masteryLog = { [ymd(10)]: 4, [ymd(8)]: 10 };
    Object.keys(raw.facts).slice(0, 15).forEach((k) => { raw.facts[k].weight = 1; raw.facts[k].lastCorrect = Date.now(); });
    raw.lastPracticeDate = ymd(away);
    localStorage.setItem('multiply-trainer', JSON.stringify(raw));
  }, lastPlayedAgo).then(() => tpage.reload()).then(() => tpage.waitForTimeout(200));
  await seedTrends(1);
  await tpage.click('#history-btn');
  const tiles = await tpage.evaluate(() => ['accuracy', 'speed', 'mastered'].map((id) =>
    document.getElementById('trend-' + id).textContent + ' ' + document.getElementById('trend-' + id + '-delta').textContent));
  const tilesExpected = ['92% ↑ 17%', '9/min ↑ 3/min', '15 ↑ 5 this week'];
  if (tiles.join('|') !== tilesExpected.join('|')) fail('trend tiles: ' + JSON.stringify(tiles));
  else ok('this week vs last week: ' + tiles.join(', '));
  const accDots = await tpage.locator('.trend-dot').count();
  await tpage.focus('.trend-svg');
  const tipLast = await tpage.locator('#trend-tip strong').textContent();
  await tpage.keyboard.press('ArrowLeft');
  const tipPrev = await tpage.locator('#trend-tip').textContent();
  if (accDots !== 3 || tipLast !== '90%' || !/^100%.*10\/10 correct$/.test(tipPrev)) fail('accuracy chart: ' + JSON.stringify({ accDots, tipLast, tipPrev }));
  else ok('accuracy chart plots each day; keyboard steps the tooltip (' + tipPrev + ')');
  await tpage.click('#trend-toggle button[data-metric="speed"]');
  const speedDots = await tpage.locator('.trend-dot').count();
  const endLabel = await tpage.locator('.trend-end-label').textContent();
  if (speedDots !== 2 || endLabel !== '9/min') fail('speed chart: ' + JSON.stringify({ speedDots, endLabel }));
  else ok('speed chart skips days without timing (' + speedDots + ' days, latest ' + endLabel + ')');
  await tpage.click('.trend-table-wrap summary');
  const tableRows = await tpage.locator('#trend-table tbody tr').allTextContents();
  if (tableRows.length !== 3 || !/100%—$/.test(tableRows[1])) fail('numbers table: ' + JSON.stringify(tableRows));
  else ok('numbers table lists both metrics per day');

  // Rank ladder: all ranks, current and next marked
  await tpage.click('#history-back-btn');
  await tpage.click('#player-level-widget');
  const ladder = await tpage.evaluate(() => ({
    rows: document.querySelectorAll('#rank-list .rank-row').length,
    current: document.querySelector('.rank-row.current .rank-title').textContent,
    next: document.querySelector('.rank-row.next .rank-title').textContent,
    nextSub: document.querySelector('.rank-row.next .rank-sub').textContent,
    home: document.getElementById('player-level').textContent,
  }));
  if (ladder.rows !== 7 || ladder.current !== 'Asteroid Miner' || !ladder.home.endsWith('Asteroid Miner') || ladder.next !== 'Nebula Navigator' || ladder.nextSub !== '8% more mastery to go') fail('rank ladder: ' + JSON.stringify(ladder));
  else ok('rank ladder shows all 7 ranks, you are here (' + ladder.current + '), next up (' + ladder.next + ')');
  await tpage.keyboard.press('Escape');
  if (await tpage.locator('#rank-modal').isVisible()) fail('rank modal did not close on Escape');
  else ok('rank modal closes');
  // After 4 days away the rank drops; the ladder says how to win it back
  await seedTrends(4);
  await tpage.click('#player-level-widget');
  const away = await tpage.evaluate(() => ({
    note: document.getElementById('rank-note').textContent,
    current: document.querySelector('.rank-row.current .rank-title').textContent,
    nextSub: document.querySelector('.rank-row.next .rank-sub').textContent,
    bar: !!document.querySelector('.rank-row.current .rank-progress'),
  }));
  if (!/win back .*Asteroid Miner/.test(away.note) || away.current !== 'Star Pilot' || away.nextSub !== 'Play today to win it back' || away.bar) fail('rank ladder after time away: ' + JSON.stringify(away));
  else ok('rank ladder after time away offers a win-back');
  await tpage.close();

  // Challenge links open an accept dialog with a live countdown and the
  // player's name. Make a code that starts in a minute, then open it as a link.
  const cpage = await browser.newPage();
  cpage.on('pageerror', (e) => errors.push(e.message));
  await cpage.goto(APP);
  await cpage.click('#challenge-btn');
  await cpage.click('#generate-code-btn');
  const inviteCode = (await cpage.locator('#challenge-show-code').textContent()).trim();
  await cpage.click('#challenge-cancel-btn');
  await cpage.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('multiply-trainer'));
    raw.name = 'Maya';
    localStorage.setItem('multiply-trainer', JSON.stringify(raw));
  });
  await cpage.goto(APP + '?code=' + inviteCode);
  await cpage.waitForTimeout(300);
  const invite = {
    open: await cpage.locator('#challenge-invite-modal').isVisible(),
    title: await cpage.locator('#invite-title').textContent(),
    details: await cpage.locator('#invite-details').textContent(),
    countdown: await cpage.locator('#invite-countdown').textContent(),
    name: await cpage.locator('#invite-name').inputValue(),
    query: await cpage.evaluate(() => location.search),
  };
  await cpage.waitForTimeout(1300);
  const countdownLater = await cpage.locator('#invite-countdown').textContent();
  if (!invite.open || invite.title !== "You've been challenged!" || invite.details !== '1 min round · All facts' ||
    !/^0[01]:\d\d$/.test(invite.countdown) || invite.name !== 'Maya' || invite.query || countdownLater === invite.countdown) fail('challenge invite: ' + JSON.stringify({ ...invite, countdownLater }));
  else ok('challenge link opens the invite with a live countdown (' + invite.countdown + ' -> ' + countdownLater + ')');
  await cpage.fill('#invite-name', 'Sam');
  await cpage.click('#invite-accept-btn');
  const accepted = {
    wait: await cpage.locator('section#challenge-wait.active').count(),
    code: (await cpage.locator('#challenge-show-code').textContent()).trim(),
    greeting: await cpage.locator('#name-btn').textContent(),
  };
  if (accepted.wait !== 1 || accepted.code !== inviteCode || !accepted.greeting.startsWith('Hi, Sam!')) fail('accepting the invite: ' + JSON.stringify(accepted));
  else ok('accepting saves the new name and waits for the start');
  await cpage.close();

  // Already running: join late with the time left shown. Over: no way to join.
  const challengeAt = async (msFromNow) => {
    const p = await browser.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.clock.install({ time: Date.now() + msFromNow });
    await p.goto(APP + '?code=' + inviteCode);
    await p.waitForTimeout(300);
    return p;
  };
  const running = await challengeAt(75000);
  const runningState = {
    title: await running.locator('#invite-title').textContent(),
    countdown: await running.locator('#invite-countdown').textContent(),
    accept: await running.locator('#invite-accept-btn').textContent(),
  };
  await running.fill('#invite-name', '');
  await running.click('#invite-accept-btn');
  const joined = await running.locator('section#practice.active').count();
  const clearedName = await running.locator('#name-btn').textContent();
  if (runningState.title !== 'The challenge has started!' || runningState.accept !== 'Join Now' || !/^00:[0-4]\d$/.test(runningState.countdown) ||
    joined !== 1 || !clearedName.startsWith('Add your name')) fail('running challenge invite: ' + JSON.stringify({ ...runningState, joined, clearedName }));
  else ok('a running challenge can be joined late (' + runningState.countdown + ' left); name stays optional');
  await running.close();
  const ended = await challengeAt(5 * 60000);
  const endedState = {
    title: await ended.locator('#invite-title').textContent(),
    acceptShown: await ended.locator('#invite-accept-btn').isVisible(),
    nameShown: await ended.locator('#invite-name').isVisible(),
  };
  await ended.click('#invite-decline-btn');
  const endedHome = await ended.locator('section#home.active').count() === 1 && !(await ended.locator('#challenge-invite-modal').isVisible());
  if (endedState.title !== 'This challenge is over' || endedState.acceptShown || endedState.nameShown || !endedHome) fail('ended challenge invite: ' + JSON.stringify({ ...endedState, endedHome }));
  else ok('an ended challenge says so and closes to home');
  await ended.close();
  const bad = await browser.newPage();
  await bad.goto(APP + '?code=NOPE');
  await bad.waitForTimeout(200);
  if ((await bad.locator('#invite-title').textContent()) !== "This challenge link doesn't work" || await bad.locator('#invite-accept-btn').isVisible()) fail('broken challenge link not handled');
  else ok('a broken challenge link is explained');
  await bad.close();

  // Sound pauses whenever the app is hidden or loses focus
  const apage = await browser.newPage();
  await apage.addInitScript(() => {
    const Orig = window.AudioContext;
    window.AudioContext = class extends Orig {
      constructor(...a) { super(...a); window.__ctx = this; }
    };
  });
  await apage.clock.install();
  await apage.goto(APP);
  await apage.waitForTimeout(300);
  await apage.click('#start-btn');
  await apage.waitForTimeout(300);
  const ctxState = () => apage.waitForTimeout(150).then(() => apage.evaluate(() => window.__ctx && window.__ctx.state));
  const setHidden = (hidden) => apage.evaluate((h) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
  const focusStates = { start: await ctxState() };
  await apage.evaluate(() => window.dispatchEvent(new Event('blur')));
  focusStates.blurred = await ctxState();
  // A question timing out while unfocused plays the miss sound; that must
  // not wake the audio back up
  await apage.clock.runFor(11000);
  if (!(await apage.locator('#feedback.wrong').count())) fail('question did not time out while unfocused');
  focusStates.answeredBlurred = await ctxState();
  await apage.evaluate(() => window.dispatchEvent(new Event('focus')));
  focusStates.refocused = await ctxState();
  await setHidden(true);
  focusStates.hidden = await ctxState();
  await setHidden(false);
  focusStates.visible = await ctxState();
  const expected = { start: 'running', blurred: 'suspended', answeredBlurred: 'suspended', refocused: 'running', hidden: 'suspended', visible: 'running' };
  if (JSON.stringify(focusStates) !== JSON.stringify(expected)) fail('audio focus handling: ' + JSON.stringify(focusStates));
  else ok('sound pauses when the app loses focus or is hidden, resumes on return');
  await apage.close();

  // Background music: ending a round and instantly replaying must leave only
  // the gameplay track running (each track runs one 50ms sequencer interval)
  const mpage = await browser.newPage();
  await mpage.addInitScript(() => {
    const live = new Map();
    const si = window.setInterval, ci = window.clearInterval;
    window.setInterval = function (fn, ms) { const id = si.apply(this, arguments); live.set(id, ms); return id; };
    window.clearInterval = function (id) { live.delete(id); return ci.apply(this, arguments); };
    window.musicTracks = () => ({ sequencers: [...live.values()].filter((ms) => ms === 50).length, track: document.body.dataset.music });
  });
  await mpage.goto(APP);
  await mpage.waitForTimeout(300);
  await mpage.click('#start-btn');
  await mpage.waitForTimeout(1000);
  await mpage.click('#end-btn');
  await mpage.click('#end-confirm-btn');
  await mpage.click('#restart-btn');
  await mpage.waitForTimeout(1500);
  const tracks = await mpage.evaluate(() => musicTracks());
  if (tracks.sequencers !== 1 || tracks.track !== 'gameplay') fail('music after quick replay: ' + JSON.stringify(tracks));
  else ok('quick replay leaves only gameplay music running');
  await mpage.close();

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
    await page.click('#end-confirm-btn');
    await page.waitForTimeout(200);
    await shot('shot-summary');
    ok('screenshots saved');
  }

  await browser.close();
  console.log(process.exitCode ? 'SMOKE TEST FAILED' : 'SMOKE TEST PASSED');
})().catch((e) => { console.error('FATAL: ' + e.message); process.exit(1); });
