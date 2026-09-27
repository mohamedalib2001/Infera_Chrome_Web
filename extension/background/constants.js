// Shared constants for the Infera Agent service worker.
// Values mirror the behaviour documented in docs/ARCHITECTURE.md.

export const VERSION = chrome.runtime.getManifest().version;
export const PRODUCT = 'Infera Agent';
export const MCP_SERVER_NAME = 'infera-in-chrome';

// Native messaging hosts, tried in this order; the first one that answers
// a ping with pong inside NATIVE_PING_TIMEOUT_MS wins.
export const NATIVE_HOSTS = [
  'com.infera.agent_browser_extension',      // Infera Desktop
  'com.infera.agent_code_browser_extension', // Infera Code / any MCP client
];
export const NATIVE_PING_TIMEOUT_MS = 10_000;
export const NATIVE_RECONNECT_BASE_MS = 2_000;
export const NATIVE_RECONNECT_MAX_MS = 60_000;

// CDP
export const CDP_PROTOCOL_VERSION = '1.3';
export const CLICK_MOVE_DELAY_MS = 100;
export const SCROLL_PX_PER_TICK = 100;
export const MODIFIER_BITS = { alt: 1, ctrl: 2, meta: 4, shift: 8 };

// Screenshot scaling (token-saving): longest side <= MAX_TARGET_PX and total
// pixels <= MAX_TARGET_PX * PX_PER_TOKEN^2.
export const PX_PER_TOKEN = 28;
export const MAX_TARGET_PX = 1568;
export const SCREENSHOT_QUALITY = 80;
export const SCREENSHOT_TTL_MS = 5 * 60_000;

// Tool limits
export const READ_PAGE_DEFAULT_DEPTH = 15;
export const READ_PAGE_DEFAULT_MAX_CHARS = 50_000;
export const LOG_DEFAULT_LIMIT = 100;
export const LOG_BUFFER_MAX = 1_000;
export const FIND_MAX_RESULTS = 20;
export const FILE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const WAIT_MAX_SECONDS = 10;
export const KEY_REPEAT_MAX = 100;

// Domain classification cache
export const DOMAIN_CACHE_TTL_MS = 5 * 60_000;

// Relay (cloud bridge)
export const RELAY_PAIR_TIMEOUT_MS = 2 * 60_000;
export const RELAY_HEARTBEAT_MS = 25_000;

// Conversation compaction threshold (bytes of serialized history)
export const COMPACT_THRESHOLD_BYTES = 25 * 1024 * 1024;

// Models (Anthropic Messages API). Default follows the current flagship.
export const MODELS = [
  { id: 'claude-opus-5', label: 'Claude Opus 5', thinking: 'adaptive', fast: true },
  { id: 'claude-opus-5[fast]', label: 'Claude Opus 5 [fast] — Quick Mode', thinking: 'adaptive', fast: true, quick: true },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', thinking: 'adaptive' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', thinking: 'none' },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1', thinking: 'always' },
];
export const DEFAULT_MODEL = 'claude-opus-5';
export const HELPER_MODEL = 'claude-haiku-4-5'; // find tool, step descriptions, safety checker

export const PERMISSION_MODES = {
  ASK: 'ask',                                  // "Manually approve"
  AUTO: 'auto',                                // "Automatically approve" + safety checker
  PLAN: 'follow_a_plan',                       // "Ask before acting" (plan approval)
  SKIP_ALL: 'skip_all_permission_checks',      // "Skip all approvals"
};

export const PERMISSION_TYPES = {
  NAVIGATE: 'NAVIGATE',
  READ_PAGE_CONTENT: 'READ_PAGE_CONTENT',
  CLICK: 'CLICK',
  TYPE: 'TYPE',
  UPLOAD_IMAGE: 'UPLOAD_IMAGE',
  PLAN_APPROVAL: 'PLAN_APPROVAL',
  REMOTE_MCP: 'REMOTE_MCP',
  DOMAIN_TRANSITION: 'DOMAIN_TRANSITION',
  DOWNLOAD: 'DOWNLOAD',
};

export const GROUP_TITLE = 'Infera';
export const MCP_GROUP_TITLE = 'Infera (MCP)';
export const GROUP_COLOR = 'purple';

export const STORAGE_KEYS = {
  SETTINGS: 'settings',
  PERMISSIONS: 'permissionStorage',
  TAB_GROUPS: 'tabGroupState',
  SHORTCUTS: 'shortcuts',
  SCHEDULES: 'scheduledTasks',
  CONVERSATIONS: 'conversations',
  MCP_SERVERS: 'mcpServers',
  AUTH: 'auth',
};

export const RESTRICTED_URL_PREFIXES = [
  'chrome://', 'chrome-extension://', 'edge://', 'brave://', 'about:', 'devtools://',
  'view-source:', 'chrome-search://', 'chrome-untrusted://',
];
export const RESTRICTED_HOSTS = ['chromewebstore.google.com', 'chrome.google.com', 'microsoftedge.microsoft.com'];
