# Infera Agent Web 2.4 — technical report

Infera Engine Ltd, London · 4 November 2026 · extension version 2.4.0

## What changed

* **Editors in cross-site frames.** Frames from another site run in a process of their own, where the
  page's debugger session cannot evaluate. `cdp.frameSessions()` turns on auto-attach with flat
  sessions, so each such frame gets a child session; `code_editor` lists and edits the editors in them
  (reported as "in frame <host> (cross-site)"). Frames of blocked sites are never entered.
* **Excel input for per-row runs.** `lib/xlsx-read.js` reads the first sheet of a workbook in the
  browser (zip central directory + `DecompressionStream`; shared, rich and inline strings, booleans,
  gaps, whichever sheet is first). Batch runs take .xlsx as well as CSV/TSV.
* **Scheduled workflows by fast replay.** A workflow scheduled from the studio keeps its id; when it
  has recorded steps, the scheduled run replays them without model calls, and the agent takes over only
  if a step cannot be done.
* **Real-site benchmark.** `scripts/bench.mjs` and `bench/tasks.json`: 20 tasks on public practice
  sites (reading, extraction, navigation, pagination, forms, dynamic content, frames, tables, security
  headers, performance, research, two tabs, Arabic, Excel output, refusing a payment). Ground truth is
  fetched from the site or read from the page while it runs. See `docs/BENCHMARK.md`.

## Security review of 2.2–2.4

An adversarial pass over the new code found and fixed:

* Fast replay (and batches and scheduled replays) clicked without per-step approval. It now applies
  the agent's hard rules before every click or key: no purchases or payments, financial transactions,
  permanent deletion or account creation, and no OAuth consent without the person; it never types into
  password, card or one-time-code fields. Such a step stops the replay and the agent takes over (and
  asks the person).
* The passive security review re-requested the page with GET; it now reads the headers with HEAD and
  falls back to GET only when the server refuses HEAD.
* Site guides are written by the agent after visiting pages, so page content could shape them. They
  are handed back labelled as the agent's own notes — hints about the site, not instructions.

## Verification

* Agent end-to-end suite: **124 checks passed, 0 failed** (119 in 2.3). New: an editor in a
  cross-site frame (localhost inside 127.0.0.1) written and read back; a deflated Excel workbook with
  shared, rich and inline strings, booleans and gaps; the extension's own Excel export read back; a
  scheduled workflow run by fast replay with no model request.
* Static, native host, desktop link, relay and base end-to-end suites passed. Performance unchanged.
* The real-site benchmark needs internet access and an account token, which this build environment
  does not have; its task list and checks were validated with `--dry`. Its first real run should be
  done on a workstation (instructions in `docs/BENCHMARK.md`), and its pass rate reported as measured.
