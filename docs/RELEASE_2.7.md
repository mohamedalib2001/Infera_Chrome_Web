# Infera Agent Web 2.7 — technical report

Infera Engine Ltd, London · 4 November 2026 · extension version 2.7.0

Phase D, enterprise trust: three controls a company needs before letting an agent work in its staff's
browsers.

## Sensitive fields masked in screenshots (`background/cdp.js`)

* Before any screenshot or zoom leaves the browser, fields with a value that are passwords, card
  details (`cc-*` autocomplete), one-time codes, or whose name/label suggests a card, CVV, IBAN,
  passport, national ID or OTP (English and Arabic) are painted over with a dark box marked
  "•••• hidden". The model never sees those values.
* A test fills a login form and checks the pixels where the password was.

## Workflow scope (`background/replay.js`)

* A recorded workflow knows the sites it was recorded on. Fast replay checks every step before it
  runs; a step that would act on another site stops the replay with a clear message, and the agent
  does **not** take over in that case.
* The workflow studio shows each workflow's sites, and importing a workflow asks you to confirm them.

## Activity log (`background/activity.js`)

* Every tool step, fast-replay step and approval (what, on which site, the result) is written to a
  local log on this device: the last 5,000 entries. It is never sent to Infera.
* Settings → Activity log shows the latest entries, exports the whole log as CSV (UTF-8, opens in
  Excel with Arabic intact) and clears it.

## Verification

* Agent end-to-end suite: **144 checks passed, 0 failed** (140 in 2.6), including the masking pixel
  test, a replay sent to an out-of-scope site, and the activity log and its CSV export.
* Extension e2e suite, unit, bridge, desktop-link and relay tests: all passed.
