// Key-name -> CDP key descriptor table used by Input.dispatchKeyEvent.

const K = (key, code, keyCode, text) => ({ key, code, keyCode, text });

const NAMED = {
  enter: K('Enter', 'Enter', 13, '\r'),
  return: K('Enter', 'Enter', 13, '\r'),
  tab: K('Tab', 'Tab', 9),
  escape: K('Escape', 'Escape', 27),
  esc: K('Escape', 'Escape', 27),
  backspace: K('Backspace', 'Backspace', 8),
  delete: K('Delete', 'Delete', 46),
  del: K('Delete', 'Delete', 46),
  insert: K('Insert', 'Insert', 45),
  space: K(' ', 'Space', 32, ' '),
  arrowup: K('ArrowUp', 'ArrowUp', 38),
  up: K('ArrowUp', 'ArrowUp', 38),
  arrowdown: K('ArrowDown', 'ArrowDown', 40),
  down: K('ArrowDown', 'ArrowDown', 40),
  arrowleft: K('ArrowLeft', 'ArrowLeft', 37),
  left: K('ArrowLeft', 'ArrowLeft', 37),
  arrowright: K('ArrowRight', 'ArrowRight', 39),
  right: K('ArrowRight', 'ArrowRight', 39),
  home: K('Home', 'Home', 36),
  end: K('End', 'End', 35),
  pageup: K('PageUp', 'PageUp', 33),
  page_up: K('PageUp', 'PageUp', 33),
  pagedown: K('PageDown', 'PageDown', 34),
  page_down: K('PageDown', 'PageDown', 34),
  capslock: K('CapsLock', 'CapsLock', 20),
  contextmenu: K('ContextMenu', 'ContextMenu', 93),
  // modifiers
  shift: K('Shift', 'ShiftLeft', 16),
  ctrl: K('Control', 'ControlLeft', 17),
  control: K('Control', 'ControlLeft', 17),
  alt: K('Alt', 'AltLeft', 18),
  option: K('Alt', 'AltLeft', 18),
  meta: K('Meta', 'MetaLeft', 91),
  cmd: K('Meta', 'MetaLeft', 91),
  command: K('Meta', 'MetaLeft', 91),
  win: K('Meta', 'MetaLeft', 91),
  windows: K('Meta', 'MetaLeft', 91),
  super: K('Meta', 'MetaLeft', 91),
};
for (let i = 1; i <= 12; i++) NAMED['f' + i] = K('F' + i, 'F' + i, 111 + i);

const PUNCT = {
  '-': ['Minus', 189], '=': ['Equal', 187], '[': ['BracketLeft', 219], ']': ['BracketRight', 221],
  '\\': ['Backslash', 220], ';': ['Semicolon', 186], "'": ['Quote', 222], ',': ['Comma', 188],
  '.': ['Period', 190], '/': ['Slash', 191], '`': ['Backquote', 192],
  minus: ['Minus', 189, '-'], plus: ['Equal', 187, '+'], equal: ['Equal', 187, '='],
};

export const MODIFIER_NAMES = {
  shift: 'shift', ctrl: 'ctrl', control: 'ctrl', alt: 'alt', option: 'alt',
  meta: 'meta', cmd: 'meta', command: 'meta', win: 'meta', windows: 'meta', super: 'meta',
};

export function describeKey(name) {
  const lower = name.toLowerCase();
  if (NAMED[lower]) return { ...NAMED[lower] };
  if (name.length === 1) {
    const ch = name;
    if (/[a-z]/i.test(ch)) {
      const up = ch.toUpperCase();
      return K(ch, 'Key' + up, up.charCodeAt(0), ch);
    }
    if (/[0-9]/.test(ch)) return K(ch, 'Digit' + ch, ch.charCodeAt(0), ch);
    if (PUNCT[ch]) return K(ch, PUNCT[ch][0], PUNCT[ch][1], ch);
    return K(ch, '', 0, ch);
  }
  if (PUNCT[lower]) {
    const [code, kc, text] = PUNCT[lower];
    return K(text, code, kc, text);
  }
  return null;
}
