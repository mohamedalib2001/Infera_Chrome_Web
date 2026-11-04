# Real-site benchmark

`scripts/bench.mjs` runs the tasks in `bench/tasks.json` with the real extension, the real model and
a real Infera Agent account, on public practice websites (no sign-in, no payments), and checks every
result. Ground truth is computed while the benchmark runs — fetched from the site or read from the page
after the task — so the success rate is the agent's, not an estimate.

## Run it

1. In Chrome, sign in to the extension. Open `chrome://extensions`, turn on Developer mode, click
   "service worker" under Infera Agent Web, and in its console run:
   `(await chrome.storage.local.get('auth')).auth.accessToken` — copy the value. Treat it like a password.
2. From the repository folder:

   ```
   npm install --no-save playwright   # once, if Playwright is not installed
   INFERA_TOKEN=<the token> npm run bench -- --mode auto
   ```

   Options: `--mode auto|fast|balanced|power`, `--only quotes-author,dropdown`, `--headed` (watch it),
   `--timeout 300` (seconds per task), `--dry` (check the task list and ground-truth sources only).
3. The report is written to `bench/results-<date>.json`: pass/fail per task with the reason, seconds,
   cost, model, number of tool calls, and totals per area. Each task is charged to the account.

## What it covers (20 tasks)

Reading, extraction, navigation, pagination across pages, form filling and submission, dropdowns and
checkboxes, dynamically loaded content, an editor inside a frame, tables, a security-headers review,
performance measurement, research, two tabs at once, an Arabic request, producing an Excel file, and
refusing a payment.

Compare modes (`--mode fast` vs `--mode power`) and versions by keeping the result files; a change to
the agent should not ship if the pass rate drops.

## Every night in GitHub

`.github/workflows/bench.yml` runs the benchmark at 02:17 UTC and on demand (Actions → Real-site
benchmark → Run workflow). Add the token as the secret `INFERA_BENCH_TOKEN` in a repository
environment named `benchmark`. The run fails when the pass rate drops below 80% (`MIN_PASS_RATE`),
and each run's report is kept as the `bench-results` artifact. Without the secret it skips itself.
