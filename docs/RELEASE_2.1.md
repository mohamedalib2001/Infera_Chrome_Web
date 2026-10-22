# Infera Agent Web 2.1 — technical report

Infera Engine Ltd, London · 22 October 2026 · extension version 2.1.0

## Summary

2.1 turns the side panel into an execution product: the agent shows a live plan, marks each step done
only with evidence from the page, and can be paused, taken over and handed back without losing
completed work. An operating mode (Auto / Fast / Balanced / Power) chooses the model and effort for
each task, with failover when a model is busy. The interface was redesigned around the Infera Engine
identity (dark navy, electric blue to violet) with a navigation rail, a home screen of quick actions,
the execution center, task history with status and site filters, a workflow studio and a usage
dashboard. The settings page gained section navigation and a Models & performance section.

Everything that worked in 2.0 still works and is covered by the same tests: account sign-in and
billing, conversations and history sync, memory, shortcuts, schedules, recording with voice, approvals
and site permissions, native messaging, MCP, the desktop link, team rules and tasks sent from the account.

## What changed

| Area | Change | Where |
| --- | --- | --- |
| Live steps | `task_steps` tool (plan / start / done / fail / skip); replanning keeps done steps; saved with the conversation | `background/agent.js`, `tools/definitions.js` |
| Control | Pause, take over (releases debugger and overlay), give back, stop; actions planned before a take-over are not run; the model re-checks the page on resume | `agent.js`, `service-worker.js` |
| Verification | Prompt rules: verify on the page before "done", say what was checked, never submit twice | `background/prompts.js` |
| Operating modes | `router.js`: Fast = Sonnet 5 low, Balanced = Sonnet 5 + Opus 5.5 advisor medium, Power = Opus 5.5 high; Auto classifies the request (English and Arabic) and learns from recent outcomes | `background/router.js` |
| Failover | Before the first answer, a model still overloaded after retries hands over to the next of the same kind | `agent.js` |
| Side panel | Rail navigation; home (9 quick actions, 6 quick tasks); live strip; execution center; history cards with thumbnails, status and site filters; usage dashboard; workflow studio and editor | `sidepanel/*` |
| Workflow studio | Steps with kinds (do / if / for each / wait until / verify), variables with defaults, test run, 6 templates, JSON import / export, recording options | `sidepanel.js`, `shortcuts.js`, `recording.js` |
| Settings | Section navigation, operating mode cards, model list, theme (dark / light / system) | `options/*` |
| Design system | Tokens, components, icons; no external fonts or libraries | `lib/theme.css`, `lib/icons.js` |
| Name | "Infera Agent Web" in the store strings and the agent's self-description; store length limits enforced by the static check | `_locales/*`, `scripts/check.mjs` |

## Verification

All run on Chromium 141 (Playwright) against local mock servers; nothing here is estimated.

* Static checks (`npm test`): syntax of every file, permissions, referenced files, module imports,
  locales and store length limits, tool lists — passed. Native host bridge, desktop link and relay tests — passed.
* Base end-to-end suite (`scripts/e2e.mjs`, every MCP tool through the service worker) — passed.
* Agent end-to-end suite (`scripts/e2e-agent.mjs`) — **104 checks passed, 0 failed** (81 before this
  release). The 23 new checks cover: the live plan and replanning; take over holding the next step,
  skipping the action planned before it, and the model told to look again; completion after resume;
  the verification rules in the prompt; Auto routing a question to Fast and a multi-step form task to
  Power; Fast and Power fixed choices; outcomes recorded; failover from a busy model; new installs on
  Auto; home quick actions and prefill; history cards and the status filter; the execution center
  showing saved steps; the workflow editor saving kinds, variables and the compiled prompt; templates;
  the usage total, hourly and daily bars and the split by model; Arabic right-to-left; the settings
  modes and navigation.

### Performance (`scripts/perf.mjs`, median of 15 loads, same machine and browser)

| Measure | 2.0.0 | 2.1.0 | Budget |
| --- | --- | --- | --- |
| Side panel time to interactive | 52 ms | 56 ms | 600 ms |
| JS heap after load | 6.09 MB | 6.39 MB | 12 MB |
| DOM elements | 105 | 97 | 1500 |
| Package (zip) | 394 KB | 423 KB | 600 KB |

The redesign adds no dependency. The only new timer is a one-second tick for the elapsed time, and it
runs only while a task is running and the strip or the execution center is on screen.

## Limitations, stated plainly

* **Other model providers.** The agent relies on Anthropic-specific capabilities (the trained browser
  toolset, server-side compaction, the advisor tool, web search and code execution), and the
  account's billing gateway speaks the Anthropic Messages API. Routing and failover are implemented
  within the Claude family. Adding OpenAI or self-hosted models needs a translating gateway on
  inferaagent.com first; it is not claimed here.
* **Duplicate submissions** are prevented by the agent's rules and by the approval modes, not by a
  hard lock on the page: a website can still accept a second request if one is sent.
* **Closed browser.** Scheduled tasks and tasks sent from the account run while Chrome is open; work
  outside the browser goes to Infera Agent Desktop (needs its next release for the link).
* **CAPTCHA, MFA and protected sign-in** remain the person's to complete; the agent pauses and asks.
* **Video evidence** is not added; GIF recording of a task remains available (`gif_creator`), and the
  execution center exports a Markdown report of the steps and the result.
* Pause takes effect after the current step: a model response already streaming is not cut off.

## Release

1. `node scripts/build-store.mjs --api-url https://inferaagent.com --version 2.1.0` →
   `dist/infera-agent-2.1.0.zip`.
2. Chrome Web Store → Infera Agent → Package → Upload new package → Submit for review. The listing
   name becomes "Infera Agent Web"; update the description from `docs/STORE_LISTING.md`.
