// GIF recording state. Frames are captured by the tool layer after each action
// while recording; export happens in the offscreen document.
import { offscreenCall } from './offscreen-client.js';

const recordings = new Map(); // tabId -> {recording, frames:[{base64,width,height,action,ts}]}
const MAX_FRAMES = 300;

function rec(tabId) {
  if (!recordings.has(tabId)) recordings.set(tabId, { recording: false, frames: [] });
  return recordings.get(tabId);
}

export const gif = {
  isRecording: (tabId) => !!recordings.get(tabId)?.recording,
  start(tabId) { const r = rec(tabId); r.recording = true; r.frames = []; },
  stop(tabId) { rec(tabId).recording = false; return rec(tabId).frames.length; },
  clear(tabId) { recordings.delete(tabId); },
  frameCount: (tabId) => recordings.get(tabId)?.frames.length || 0,
  addFrame(tabId, shot, action = null) {
    const r = recordings.get(tabId);
    if (!r?.recording) return;
    r.frames.push({ base64: shot.base64, width: shot.width, height: shot.height, refWidth: shot.refFrame?.width || shot.width, action, ts: Date.now() });
    if (r.frames.length > MAX_FRAMES) r.frames.shift();
  },
  // Attach an action (click/drag/type label) to the most recent frame so the
  // overlay can draw it on the frame that preceded the action.
  annotateLast(tabId, action) {
    const r = recordings.get(tabId);
    if (!r?.recording || !r.frames.length) return;
    r.frames[r.frames.length - 1].action = action;
  },
  async export(tabId, options = {}) {
    const r = recordings.get(tabId);
    if (!r?.frames.length) throw new Error('No frames recorded. Use start_recording, take screenshots/actions, then stop_recording.');
    const opts = {
      showClickIndicators: true, showDragPaths: true, showActionLabels: true, showProgressBar: true, showWatermark: true, quality: 10,
      ...options,
    };
    const res = await offscreenCall('ENCODE_GIF', { frames: r.frames, options: opts });
    return { base64: res.base64, bytes: res.bytes, frames: r.frames.length };
  },
};
