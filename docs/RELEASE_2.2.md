# Infera Agent Web 2.2 — technical report

Infera Engine Ltd, London · 3 November 2026 · extension version 2.2.0

## Summary

2.2 makes the agent a developer and IT tool, and makes repeated work fast:

* **code_editor** reads and edits code in the editors that web tools are built on — Monaco (VS Code
  for the web, GitHub, Azure and other cloud consoles), CodeMirror 5 and 6 (Replit, Jupyter, CodePen,
  many CMSs), Ace (Apps Script, Cloud9, admin panels) and large text areas — through each editor's own
  API: a whole change in one step, with undo, read back to verify. Editors with no reachable API
  (vscode.dev, github.dev) are written with a single paste, and the agent is told to check them.
* **devtools**: load performance (TTFB, FCP, LCP, CLS, resources, slowest requests, memory); an audit
  (SEO, accessibility, mobile, HTML, security, performance) with samples; a **passive security review**
  (HSTS, CSP, clickjacking, nosniff, CORS, disclosed versions, cookies readable by scripts, insecure
  forms, third-party scripts without integrity); element inspection with computed styles; console
  errors with failed requests; storage key names (never values); and the network log as a .har file.
* **Fast replay**: a recorded workflow runs again from its recorded steps with no model calls. Each
  element is found again by its CSS path, then by any of its names (aria-label, its label, its text),
  waited for and acted on; the steps show as the live plan. When a step cannot be done, the agent takes
  over from that step with the whole workflow. Passwords and card numbers are never replayed.
* **Batch runs**: a workflow runs once per row of a CSV/TSV file (the columns are its variables), one
  after the other, each in its own conversation, with a live progress card, approvals in the panel, a
  stop button and the results as a CSV file.
* **Playwright export**: a recorded workflow becomes a Playwright test file (getByRole locators,
  fill, selectOption, setChecked, keyboard), to run in CI or a terminal.

The system prompt now tells the agent to use these tools for programming and IT work and that security
work is defensive only: reviewing and hardening what the user owns or is authorized to test.

## Verification

Chrome for Testing 153 (Playwright), local mock servers.

* Static checks, native host bridge, desktop link and relay tests — passed.
* Base end-to-end suite (every MCP tool) — passed.
* Agent end-to-end suite — **115 checks passed, 0 failed** (104 in 2.1). The new checks: editors
  found across Monaco, CodeMirror 5 and 6, Ace and a text area; reading numbered lines and fixing a
  bug in Monaco, verified; write / insert / replace in the others; a missing snippet refused with its
  reason; performance, audit and inspection; the security review reading real response headers; storage
  names, errors and the HAR file; fast replay filling and submitting a form with new values and no
  model request; one run per CSV row; the Playwright file; and a failed replay step handed to the agent.
* The editor adapters are tested against a fixture page that exposes each library's public API
  surface (no CDN in the test environment); they have not yet been run against every live site.

### Performance (`scripts/perf.mjs`, median of 15 loads, same machine, Chrome 153)

| Measure | 2.1.0 | 2.2.0 |
| --- | --- | --- |
| Side panel time to interactive | 72 ms | 73 ms |
| JS heap | 8.08 MB | 8.07 MB |
| DOM elements | 97 | 97 |
| Package | 423 KB | 441 KB |

## Limits

* An editor inside a cross-origin iframe is reached by opening that frame's page in a tab.
* Paste-written editors (no API) cannot be read back in full; the agent checks them with a screenshot.
* Fast replay follows the recorded page structure; a redesigned page falls back to the agent.
* Security checks are passive by design: no scanning, probing or exploitation of any system.
