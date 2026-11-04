# Infera Agent Web 2.5 — technical report

Infera Engine Ltd, London · 4 November 2026 · extension version 2.5.0

Phase A of the development plan ("an agent that learns from itself"), delivered step by step.

## 1. Learning by doing (`background/trace.js`)
While the agent works, every page action it takes — navigate, click, type, select, tick, key — is kept
as a semantic step (the element's CSS path and accessible name, never screen coordinates), hooked into
the executor so both tool sets are covered. When a single-tab task finishes well, the panel offers
"Learned this task → save as a fast workflow"; next time its steps replay in seconds with no model
cost. A skill the agent saves with `skill_save` carries the steps too, and a scheduled skill runs by
fast replay.

## 2. Self-repairing workflows
When a fast replay cannot do a step (the site changed) the agent finishes the task from that point;
its steps then replace the broken part of the workflow, so the next replay runs all the way through.

## 3. An independent reviewer
After a task of three or more steps, all marked done, a second model compares the final answer and
the noted evidence with a fresh screenshot of the page. A problem it finds sends the agent back once
to check and fix it; a confirmation is shown in the summary. Setting: Agent behaviour → Independent
reviewer (on by default).

## 4. Marked screenshots (`page_marks`)
A screenshot with a numbered box on every visible, uncovered clickable element, and a legend mapping
each number to its ref, role and name — for crowded or unusual pages and canvas-heavy apps.

## 5. Benchmark every night
`.github/workflows/bench.yml` runs the real-site benchmark nightly (with the `INFERA_BENCH_TOKEN`
secret) and fails below an 80% pass rate.

## 6. Premium touches
A completion card (duration, steps, cost, model, the reviewer's verdict), a Ctrl+K command palette over
every action and workflow, a three-card welcome tour shown once, and subtle entrance animations
(disabled with reduced motion).

## Verification
* Agent end-to-end suite: **136 checks passed, 0 failed** (125 in 2.4.1). New checks cover learning a
  task and replaying it with no model request, repairing a broken workflow and replaying the repaired
  one, both reviewer verdicts, the marked screenshot and acting by its ref, the tour, the palette and
  the completion card. Base end-to-end, static, native host, desktop link and relay suites pass; CI
  runs them all on GitHub for every push.
* Performance: side panel ready in 72 ms (median of 15), 8.1 MB heap, 456 KB package.
