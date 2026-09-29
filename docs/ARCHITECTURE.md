# Infera Agent for Chrome — architecture

This document maps every capability in the reference report ("Claude in Chrome"
analysis) to where it lives in this codebase. Section numbers refer to the report.

## Components (report §4.1)

| Component | File(s) | Notes |
|---|---|---|
| Background service worker | `extension/background/service-worker.js` | Routing, lifecycle, panel ports, alarms, download guard, navigation guard |
| Side panel (chat UI) | `extension/sidepanel/*` | Opens on toolbar click (`chrome.sidePanel`), streams the agent, approvals, shortcuts, schedules, recording |
| Injected page agent | `extension/content/page-agent.js` | Injected on demand into the **isolated world**: `__inferaGenerateAccessibilityTree`, `__inferaElementMap` (ref_N → `WeakRef`), form input, uploads, page signals |
| On-page indicator | `extension/content/overlay.js` | Glowing border + floating "Stop / Take control" bar; hidden on `HIDE_FOR_TOOL_USE`, shown on `SHOW_AFTER_TOOL_USE` |
| Offscreen document | `extension/offscreen/*` | Notification sounds (Web Audio) + GIF encoding with overlays |
| Blocked page | `extension/blocked/*` | Replaces pages in blocked categories |
| Approval popup | `extension/approval/*` | "Infera Agent wants to…" dialog when no side panel is open (MCP clients, scheduled tasks) |
| Settings | `extension/options/*` | Account, model, approval mode, approved sites, blocklist, connections, remote MCP servers, org policy |

Internal modules: `TabGroupManager` (`tab-groups.js`), `PermissionManager` singleton
(`permissions.js`), CDP layer (`cdp.js`), tool executor (`tools/executor.js`), agent
loop (`agent.js`), model client (`llm.js`), native bridge (`native-bridge.js`), cloud
relay client (`relay.js`), remote MCP client (`remote-mcp.js`), scheduler
(`scheduler.js`), shortcuts (`shortcuts.js`), workflow recording (`recording.js`).

## CDP layer (report §4.2) — `background/cdp.js`

* `chrome.debugger.attach(tabId, "1.3")`; trusted input via `Input.dispatchMouseEvent`,
  `Input.dispatchKeyEvent`, `Input.insertText`.
* Click = `mouseMoved` → 100 ms → `mousePressed` → `mouseReleased`; double/triple via `clickCount`;
  hover = `mouseMoved`; drag = moved → pressed → moved (10 steps) → released.
* Typing character by character; key combos with `+`; modifier bitmask `alt=1 ctrl=2 meta=4 shift=8`.
* Screenshots: `Page.captureScreenshot` (JPEG) resized with `OffscreenCanvas`
  (`PX_PER_TOKEN = 28`, `MAX_TARGET_PX = 1568`). IDs `ss_…`, 5-minute TTL. Scaled
  screenshots keep coordinates in the full-resolution reference frame.
* Scroll = `mouseWheel`, `scroll_amount × 100 px`. Zoom = full-resolution clip.
* Console (`Runtime.consoleAPICalled`, `Runtime.exceptionThrown`, `Log.entryAdded`),
  network (`Network.*`, cleared on cross-domain navigation, auth headers / tokens → `REDACTED`),
  JavaScript dialogs (`Page.javascriptDialogOpening`) tracked per tab.
* Debugger detached at the end of every side-panel turn, after 5 idle minutes for MCP sessions,
  and the running task stops if the user cancels Chrome's debugging banner.

## Operating modes (report §4.3)

* **Side-panel agent** (`agent.js`) — the model loop runs in the service worker (so tasks keep
  running when the panel is closed): stream → `tool_use` → permission → execute → one user message
  with all `tool_result`s → repeat. Stop sends an error `tool_result` for every pending tool.
  History over ~25 MB replaces old screenshots with placeholders (`tokensSaved`).
* **Quick Mode** — models tagged `[fast]`: `speed: "fast"`, no tool definitions,
  `stop_sequences: ["\n<<END>>"]`, one/two-letter commands `C RC DC TC H T K S D Z N J W ST NT LT PL`
  (+ `DONE`); a screenshot is sent back after every batch.
* **Cloud sessions** — a remote agent drives the browser through the relay (`relay.js`,
  `bridge-relay/`), exposed as the `infera-in-chrome` MCP server.
* Every user message carries a `<tab_context>` JSON block (`availableTabs`, `initialTabId`) with an
  explicit note that titles/URLs are page-authored, untrusted content.

Accounts: users sign in with their **INFERA Agent account on inferaagent.com** via OAuth 2.1
(discovery, dynamic client registration, PKCE, `chrome.identity.launchWebAuthFlow`, refresh tokens —
`auth.js`). Model requests go to `https://inferaagent.com/api/browser-agent/v1/messages`, which checks the
person's credits, adds the platform key server-side, relays the stream and charges the tokens to the
person's credits (Infera_Agent `apps/server/src/browserAgent.ts`). No provider key is stored in the
browser. **An INFERA Agent account is the only way to use the extension**: there is no personal API
key or third-party OAuth option, and a stored session is only accepted for the built-in server. The
server is baked in at build time (`config.js`, `scripts/build-store.mjs`) and cannot be changed in a
Web Store install; only an unpacked developer build may point at a local `http://localhost` test server.

Model API: Anthropic Messages API wire format over HTTPS with SSE (`llm.js`; no bundler, so the wire
protocol is used directly), always sent to the INFERA Agent gateway. Default model `claude-opus-5` with
adaptive thinking (summarised), `output_config.effort`, server-side refusal fallbacks, context editing
(`clear_tool_uses`), prompt caching on tools + system, and `eager_input_streaming` with client-side
schema validation. Optional features are dropped automatically if the gateway rejects them.
Helper model `claude-haiku-4-5` powers `find`, the
safety checker and workflow-step descriptions.

## Native messaging bridge (report §4.4)

| Item | Value |
|---|---|
| Hosts (tried in order, first `pong` within 10 s wins) | `com.infera.agent_browser_extension` (Infera Desktop), `com.infera.agent_code_browser_extension` (Infera Code / any MCP client) |
| Host program | `native-host/infera-native-host.js` (wrapper `~/.infera/chrome/infera-native-host[.bat]`) |
| Manifests | written by `native-host/install.js` for Chrome, Chrome Beta/Canary, Chromium, Edge, Brave, Vivaldi, Opera, Arc (macOS/Linux folders, Windows `HKCU\Software\…\NativeMessagingHosts`) |
| Local channel | `/tmp/infera-mcp-browser-bridge-$USER/<pid>.sock` (dir 0700, socket 0600) · Windows `\\.\pipe\infera-mcp-browser-bridge-<user>-<pid>` |
| Envelope | `ping`/`pong`, `get_status`, `list_tools`, `tool_request {method:"execute_tool", params:{tool,args,tabGroupId,tabId,client_id}}`, `tool_response {result:{content}} \| {error:{content}}`, `mcp_connected`, `mcp_disconnected`; host→extension messages over 1 MB are chunked |
| MCP server | `native-host/infera-mcp-server.js` (stdio JSON-RPC; adds `list_connected_browsers`, `switch_browser`; reads `file_upload` paths, rejects multi-hard-link files, 10 MB cap) |
| Cloud relay | `bridge-relay/server.js` — extensions register at `/ws`, agents connect at `/agent?token=…`; pairing code confirmed in the browser, 2-minute pairing wait |

## Tab groups (report §4.5) — `tab-groups.js`

One Chrome tab group per session (`Infera`, MCP sessions `Infera (MCP)`), isolated per client.
Title shows `⋯` while working and `✓` when done. State in `chrome.storage.local`. Tools refuse tabs
outside the session's group. Group changes are injected into tool results as `<system-reminder>`.
Only blank tabs the agent created are closed at session end.

## Permissions (report §5)

All 16 permissions are declared and used (the 15 from the report plus `identity` for the INFERA Agent OAuth sign-in window): `sidePanel`, `storage`, `scripting`, `debugger`,
`tabGroups`, `tabs`, `alarms`, `notifications`, `system.display` (window-resize clamping to the display
work area), `webNavigation` (blocked-category interception, domain transitions, OAuth redirect, recorder),
`declarativeNetRequestWithHostAccess` (identifies the client to Infera endpoints, `rules/dnr_rules.json`),
`offscreen`, `nativeMessaging`, `downloads`, `unlimitedStorage`; host permission `<all_urls>`.

## Anthropic browser toolset — `tools/browser-toolset.js`

With models that support it (Claude Opus 5.5, Opus 5, Fable 5.1, Sonnet 5) the side-panel agent offers
Anthropic's **browser use toolset** (`browser_toolset_20260801`) instead of its own browsing tools — the
tool surface current models are trained on. Every member call (`navigate`, `screenshot`, `zoom`, clicks,
`mouse_move`, `left_mouse_down/up`, `scroll`, `scroll_to`, `type`, `key`, `hold_key`, `wait`, `read_page`,
`find`, `get_page_text`, `form_input`, `read_console`, `read_network`, `javascript_exec`, `new_tab`,
`list_tabs`, `switch_tab`, `close_tab`) is mapped onto the same executor, so permissions, domain safety,
the tab-group boundary, the overlay and GIF recording are unchanged. Results echo
`toolset_name: "browser"` and carry a `browser_state` block (the group's tabs, `tab_id` = Chrome tab id
as a string, `tab_opened` changes). Actions in one turn run in order and stop at the first failure
("Not executed: an earlier action in this turn failed."). `file_upload` stays disabled (it takes local
paths). Plan, shortcuts, GIF, image upload and window size remain our own tools next to the toolset.
If an endpoint rejects the toolset, the session falls back to the classic tools below.

## Web research, memory and attached files

* **Web research** — `tools/web-tools.js`. With the same models the agent also gets Anthropic's
  server-side `web_search_20260318` (max 8 per request, billed per search from the person's credits by
  the gateway) and `web_fetch_20260318` (max 10, 40k tokens each), with dynamic filtering and
  `response_inclusion: "excluded"`. The person's and the organization's blocklists become
  `blocked_domains` (an organization allowlist becomes `allowed_domains`). `server_tool_use` /
  `*_tool_result` blocks are replayed unchanged, the code-execution `container` id is sent back on the
  next request, searches show as tool cards, and cited sources are listed under the answer.
  Setting: `webResearch`.
* **Memory** — `memory.js`, tools `memory_save` / `memory_forget`. Short facts the user asked to be
  remembered, stored in `chrome.storage.local` (`userMemory`, ≤100 items, ≤500 chars); passwords,
  codes, card numbers and keys are refused. They are added to the first message of each new
  conversation as `<user_memory>`; Settings lists them with Remove / Forget everything. Setting:
  `memory`.
* **Attached files** — the side panel's paperclip attaches files from the device (10 MB total). Images
  are shown to the model, PDFs and text files are given to it as documents, and every file is listed
  in `<attached_files>` as `/attachments/<name>`: the browser toolset's `file_upload` (and the classic
  `file_upload` via `paths`) puts it into a page's file input.

Preserved thinking (Opus 5.5 / Fable 5.1): the system prompt and tool list are fixed for a
conversation (later mode changes and site know-how are appended as `<system-reminder>` notes, never
edited in), the history is append-only, and requests set
`thinking.block_binding.prefix_mismatch_behavior: "drop_block"` (beta
`thinking-binding-controls-2026-08-01`) so a compacted or reloaded history degrades instead of failing.

## Tools (report §6) — `tools/definitions.js`, `tools/executor.js`

MCP set (17): `tabs_context_mcp`, `tabs_create_mcp`, `tabs_close_mcp`, `navigate`, `computer`
(`left_click right_click double_click triple_click type key screenshot wait scroll scroll_to
left_click_drag zoom hover`), `read_page`, `find`, `form_input`, `get_page_text`, `javascript_tool`,
`read_console_messages`, `read_network_requests`, `upload_image`, `file_upload`, `resize_window`,
`gif_creator`, `browser_batch`. Side panel adds: `tabs_context`, `tabs_create`, `update_plan`,
`shortcuts_list`, `shortcuts_execute`, `turn_answer_start`, plus remote MCP tools
(`mcp__<server>__<tool>`, permission `REMOTE_MCP`).

Page-type restrictions: on `chrome://`, `chrome-extension://`, `about:` pages and the Chrome Web Store
only `navigate` works. CAPTCHA and sign-in pages are detected and handed back to the user.

## Security model (report §7)

* Modes: `ask` (Manually approve), `auto` (Automatically approve + independent safety checker per
  mutating action), `follow_a_plan` (Ask before acting, `update_plan`), `skip_all_permission_checks`.
* Types: `NAVIGATE`, `READ_PAGE_CONTENT`, `CLICK`, `TYPE`, `UPLOAD_IMAGE`, `PLAN_APPROVAL`,
  `REMOTE_MCP`, `DOMAIN_TRANSITION`, `DOWNLOAD`. Durations: `once` (bound to the tool-use id) and
  `always` (per netloc).
* Storage key `permissionStorage`, entries
  `{action, createdAt, duration, id, scope:{netloc,type}, mac}` — **signed with HMAC-SHA256** using a
  non-extractable key in IndexedDB; entries written directly into LevelDB without a valid MAC are
  ignored (this closes the gap described in report issue #26779).
* Domain re-verification between the permission decision and the input dispatch.
* Domain categories `category0/1/2/3/category_org_blocked` (`domain-safety.js`), 5-minute cache,
  optional remote classifier; banking, trading, crypto, adult and piracy blocked by default.
* Always confirm: downloads (paused until approved), sensitive entry (passwords / one-time codes),
  OAuth consent. Hard-blocked: purchases/payments, financial transactions, account creation, permanent
  deletion, card numbers and government IDs, CAPTCHA solving.
* Prompt-injection defences: untrusted-data system prompt, hidden/concealed DOM text removed from the
  accessibility tree, tab titles/URLs flagged as untrusted, safety checker, per-site permissions,
  blocklists.
* Enterprise (`managed_schema.json`): `enabled`, `allowlist`, `blocklist`,
  `defaultPermissionMode`, `disableSkipAllApprovals`, `relayUrl`.

## Not included

* The report's Cowork cloud container (terminal, Python, file production) is a separate cloud product;
  here, cloud sessions connect through the relay instead.
* 1Password integration.
* rrweb DOM recording — workflow recording uses a lightweight semantic recorder plus screenshots and
  voice narration (Web Speech API), turned into a parameterised shortcut by the helper model.
