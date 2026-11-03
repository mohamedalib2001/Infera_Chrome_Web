# Infera Agent Web 2.3 — technical report

Infera Engine Ltd, London · 3 November 2026 · extension version 2.3.0

## What changed

* **Site guides** (`background/site-guides.js`, tool `site_guide`). After a multi-step task on a site
  goes well, the agent saves what will make the next visit faster: where things are, the steps that
  worked, pitfalls, field formats. A guide is kept in the account memory under the topic
  `site:<host>` (so it follows the person to every device and can be read or deleted in Settings →
  Memory), one per site; saving again replaces it. When the agent opens that site the guide is handed
  to it once per conversation as `<site_guide>`; guides are kept out of the general `<user_memory>`
  block. Personal data and secrets are refused (the memory filters on the extension and the server).
* **Self-check before finishing.** If the agent answers while steps of its plan were never marked
  done, it is sent back once to do and verify them, or to mark them skipped or failed and say why
  (or to ask the user). This turns "I think it is done" into a checked result.
* **Editors in frames.** `code_editor` also finds Monaco, CodeMirror, Ace and text-area editors inside
  same-origin frames (Apps Script, notebooks, admin panels) and reports which frame each is in.

## Verification

* Agent end-to-end suite: **119 checks passed, 0 failed** (115 in 2.2). New: guides saved per site,
  replaced when saved again and refused when they hold a secret; the guide handed to the agent on the
  site and kept out of the general memory; the self-check sending the agent back once with the open
  steps; an editor inside a same-origin frame written and verified.
* Static, native host, desktop link, relay and base end-to-end suites passed.
* Performance unchanged (see `scripts/perf.mjs`).

## Limits

* Editors in cross-origin frames still need that frame's page opened in a tab.
* A guide is advice, not a script: the agent is told to check the page, because sites change, and to
  save a corrected guide.
