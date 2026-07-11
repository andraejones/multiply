# Smoke test

Headless end-to-end test that drives the real app in Chromium and checks:

- Home screen, progress grid (144 cells), and player rank render
- Practice flow: correct answer scoring, streak, wrong-answer correction,
  retype mode, advancing between problems
- Summary stats, history cards, sandbox sessions
- Challenge code generate / join round-trip
- Export / import transfer-code round-trip
- Mastery decay: 7-day grace period, partial and full decay, and that
  decayed facts re-enter the practice rotation

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
