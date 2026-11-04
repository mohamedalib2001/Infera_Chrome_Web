# Infera Agent Web 2.6 — technical report

Infera Engine Ltd, London · 4 November 2026 · extension version 2.6.0

## Voice control (`sidepanel/voice.js`)

* **Dictation**: the microphone button in the request box (or Ctrl+Shift+Space, or the command
  palette) listens in the interface language, Arabic or English; the words appear as they are
  recognised and the request is sent when you stop speaking (or left in the box, per setting).
* **Spoken commands** while a task runs — the whole utterance must be a short command, so a request
  is never mistaken for one: stop (توقف), pause (إيقاف مؤقت), resume (كمل / استأنف), take over
  (خليني / سأتولى), give control back (ارجع للوكيل), new task (مهمة جديدة). An approval request is
  answered with yes / no (نعم / لا). Anything else is sent as a request, or as a new instruction to the
  running task.
* **Spoken replies** (optional): the final answer and approval requests are read aloud by the browser,
  without code, tables or links. **Hands-free** listens again after each reply.
* **Privacy**: speech is recognised on the device when Chrome has the language (on-device
  recognition); otherwise Chrome sends the audio to Google's speech service. Only the resulting text
  reaches Infera Agent. The privacy policy and the Voice section in Settings say so.

## Fix

* The home screen sat on top of the panel with a fixed bottom margin, so with a taller request box
  its last line (the account and Sign out) stayed hidden under it even when scrolled. It is now part
  of the panel's layout and scrolls to its end at any height; a test checks it at 400×560.

## Verification

* Agent end-to-end suite: **140 checks passed, 0 failed** (136 in 2.5), with a simulated microphone
  and speaker: Arabic and English commands mapped, requests not mistaken for commands, a dictated
  request sent and its answer read aloud, hands-free listening again, "new task" acting without
  sending anything, and the home screen's last line above the request box.
* Base end-to-end, static, native host, desktop link and relay suites pass; CI runs them on GitHub.
