// Voice control for the side panel: dictation into the request box, spoken commands while
// a task runs (stop, pause, resume, take over, give control back, approve, decline, new
// task), spoken replies, and a hands-free mode that listens again after each reply.
// Speech recognition runs on the device when Chrome offers it; otherwise Chrome's speech
// service is used (stated in the privacy policy). Nothing here is sent to Infera's servers
// except the text of a request, like a typed one.

const SR = () => window.SpeechRecognition || window.webkitSpeechRecognition;

// Arabic is matched without diacritics, tatweel or hamza forms.
const norm = (s) => String(s || '').toLowerCase().replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  .replace(/[.!؟?،,]+/g, ' ').replace(/\s+/g, ' ').trim();

// Short spoken phrases that are commands rather than requests (the whole utterance must match).
const COMMANDS = [
  ['stop', /^(stop|stop the task|cancel|توقف|اوقف|وقف|قف|الغي|الغاء|كفايه)$/],
  ['pause', /^(pause|hold on|wait|ايقاف مؤقت|توقف مؤقتا|استني|انتظر|لحظه)$/],
  ['resume', /^(resume|continue|go on|keep going|استانف|كمل|تابع|استمر|واصل)$/],
  ['takeOver', /^(take over|let me|i will do it|let me do it|ساتولي|خليني|خليني انا|دعني|تولي التحكم|انا هعمل)$/],
  ['giveBack', /^(give it back|give back control|your turn|back to you|ارجع|ارجع للوكيل|اعد التحكم|دورك|خلاص كمل)$/],
  ['approve', /^(yes|allow|approve|ok|okay|go ahead|نعم|ايوه|اه|موافق|اسمح|تمام|اوكي|نفذ)$/],
  ['decline', /^(no|decline|deny|don't|لا|ارفض|مش موافق|لا تنفذ)$/],
  ['newTask', /^(new task|new chat|start over|مهمه جديده|محادثه جديده|ابدا من جديد)$/],
];

/** The command a short utterance means, or null when it is a request to send. */
export function matchCommand(text) {
  const t = norm(text);
  if (!t || t.split(' ').length > 5) return null;
  for (const [cmd, re] of COMMANDS) if (re.test(t)) return cmd;
  return null;
}

/** Markdown answer → text that reads well aloud (no code, tables or links). */
export function speakable(md, max = 600) {
  let s = String(md || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*\|.*\|\s*$/gm, ' ')
    .replace(/^#+\s*/gm, '')
    .replace(/[*_~>#]+/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length > max) s = `${s.slice(0, s.lastIndexOf(' ', max) > 200 ? s.lastIndexOf(' ', max) : max)} …`;
  return s;
}

export class Voice {
  constructor({ lang, onInterim, onFinal, onState, onError }) {
    this.lang = lang;
    this.onInterim = onInterim;
    this.onFinal = onFinal;
    this.onState = onState;
    this.onError = onError;
    this.rec = null;
    this.listening = false;
    this.speaking = false;
  }

  get supported() { return !!SR(); }

  setLang(l) { this.lang = l; }
  #code() { return this.lang === 'ar' ? 'ar-SA' : navigator.language?.startsWith('en') ? navigator.language : 'en-US'; }

  async listen() {
    const R = SR();
    if (!R) { this.onError?.('unsupported'); return; }
    if (this.listening) return;
    this.stopSpeaking();
    const rec = new R();
    rec.lang = this.#code();
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    // On-device recognition when Chrome has the language pack (Chrome 139+).
    try {
      if (typeof R.available === 'function' && 'processLocally' in rec) {
        const a = await R.available({ langs: [rec.lang], processLocally: true });
        if (a === 'available') rec.processLocally = true;
      }
    } catch { /* older Chrome: the default service */ }
    let final = '';
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      this.onInterim?.((final + interim).trim());
    };
    rec.onerror = (e) => { if (e.error !== 'no-speech' && e.error !== 'aborted') this.onError?.(e.error); };
    rec.onend = () => {
      if (this.rec === rec) this.rec = null;
      this.listening = false;
      this.onState?.('idle');
      if (final.trim()) this.onFinal?.(final.trim());
    };
    this.rec = rec;
    this.listening = true;
    this.onState?.('listening');
    try { rec.start(); } catch { this.listening = false; this.onState?.('idle'); }
  }

  stopListening() { try { this.rec?.stop(); } catch { /* ended */ } }
  toggle() { if (this.listening) this.stopListening(); else this.listen(); }

  speak(text, { then } = {}) {
    const s = String(text || '').trim();
    if (!s || !window.speechSynthesis) { then?.(); return; }
    this.stopSpeaking();
    const u = new SpeechSynthesisUtterance(s);
    u.lang = this.#code();
    const voices = speechSynthesis.getVoices();
    const v = voices.find((x) => x.lang?.toLowerCase().startsWith(this.lang === 'ar' ? 'ar' : 'en') && /natural|neural|google|online/i.test(x.name))
      || voices.find((x) => x.lang?.toLowerCase().startsWith(this.lang === 'ar' ? 'ar' : 'en'));
    if (v) u.voice = v;
    u.rate = 1;
    this.speaking = true;
    this.onState?.('speaking');
    const done = () => { this.speaking = false; this.onState?.('idle'); then?.(); };
    u.onend = done;
    u.onerror = done;
    speechSynthesis.speak(u);
  }

  stopSpeaking() { if (this.speaking || window.speechSynthesis?.speaking) { try { speechSynthesis.cancel(); } catch { /* none */ } this.speaking = false; } }
}
