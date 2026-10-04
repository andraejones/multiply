# Smoke test

Headless end-to-end test that drives the real app in Chromium and checks:

- Home screen, progress grid (144 cells), and player rank render
- Practice flow: correct answer scoring, streak, wrong-answer correction,
  retype mode, advancing between problems
- Summary stats, history cards, sandbox sessions
- Challenge code generate / join round-trip
- Challenge links open an accept dialog: live countdown, editable name, late
  join while running, ended and broken links
- Export / import transfer-code round-trip
- Mastery decay: 7-day grace period, partial and full decay, and that
  decayed facts re-enter the practice rotation
- Rounds ended early don't count (fact progress rolls back); a full round,
  played on a fake clock, does
- Optional player name: greeting, personalized summary, persistence
- Shared history links: the name isn't readable in the link, the recipient
  sees the sender's name, rank, and per-round details, edited links are
  rejected, and original-format links still open
- Progress over time: week-over-week tiles, accuracy/speed chart (including
  keyboard tooltip), numbers table; rank ladder modal, including after time away
- Sound suspends when the app loses focus or is hidden
- Regressions: double-submit, stale round timers, lapsed daily streak,
  truncated transfer codes, background-music races

## Run

```sh
cd test
npm install
npm test
```

Add `--shots` to also save phone-width screenshots of the home, practice,
and summary screens next to the script:

```sh
node smoke.js --shots
```

## Browser resolution

`playwright-core` does not download a browser. The test finds one in this
order:

1. `CHROMIUM_PATH` environment variable, if set
2. The newest Chromium in Playwright's browser cache
   (`~/Library/Caches/ms-playwright`, `~/.cache/ms-playwright`, or
   `%LOCALAPPDATA%\ms-playwright`)
3. System Chrome (`channel: 'chrome'`)

If none of those exist, install one with `npx playwright install chromium`.
