/* eslint-disable @typescript-eslint/no-require-imports -- Node regression tests. */
const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./office-loader.cjs')();
const { connectFoyerAudio, isMusicRoomPath, FOYER_SOUND_PREFERENCE } = load('components/FoyerAudio/controller.ts');
const { suspendBackgroundMusic } = load('components/FoyerAudio/musicFocus.ts');

class FakeNode extends EventTarget {
  contains(target) { return target === this; }
}
class FakeKeyboardEvent extends Event {
  constructor(key) { super('keydown'); this.key = key; }
}
function setup(t, preference, storageBlocked = false) {
  const names = ['document', 'window', 'localStorage', 'Node', 'HTMLElement', 'KeyboardEvent'];
  const descriptors = names.map(name => Object.getOwnPropertyDescriptor(global, name));
  const document = new FakeNode();
  document.hidden = false;
  document.body = { style: { overflow: '' } };
  const window = new FakeNode();
  const storage = new Map(preference ? [[FOYER_SOUND_PREFERENCE, preference]] : []);
  const localStorage = {
    getItem: key => { if (storageBlocked) throw Error('blocked'); return storage.get(key); },
    setItem: (key, value) => { if (storageBlocked) throw Error('blocked'); storage.set(key, value); },
  };
  for (const [name, value] of Object.entries({ document, window, localStorage, Node: FakeNode, HTMLElement: FakeNode, KeyboardEvent: FakeKeyboardEvent })) {
    Object.defineProperty(global, name, { value, configurable: true, writable: true });
  }
  const audio = new FakeNode();
  Object.assign(audio, {
    paused: true, calls: 0, loads: 0, volume: 1,
    play() { this.calls++; this.paused = false; return Promise.resolve(); },
    pause() { this.paused = true; },
    load() { this.loads++; },
  });
  const button = new FakeNode();
  const states = [];
  const { dispose, setRoomActive } = connectFoyerAudio(audio, button, state => states.push(state));
  setRoomActive(true);
  t.after(() => {
    dispose();
    names.forEach((name, i) => {
      if (descriptors[i]) Object.defineProperty(global, name, descriptors[i]);
      else delete global[name];
    });
  });
  return { audio, button, document, window, storage, states, dispose, setRoomActive,
    click: () => button.dispatchEvent(new Event('click')),
    interact: () => document.dispatchEvent(new Event('pointerup')),
    visibility: hidden => { document.hidden = hidden; document.dispatchEvent(new Event('visibilitychange')); },
  };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('audio spans all rooms but not account, pricing, checkout or admin pages', () => {
  for (const path of ['/', '/foyer', '/office', '/merch', '/theatre']) assert.equal(isMusicRoomPath(path), true);
  for (const path of [null, '/membership', '/account', '/checkout', '/merch/checkout', '/admin/store', '/foyer/other']) {
    assert.equal(isMusicRoomPath(path), false);
  }
});
test('room transitions keep the same playback; non-room routes pause without resetting', async t => {
  const h = setup(t);
  h.click(); await settle();
  h.audio.currentTime = 42;
  h.setRoomActive(true); h.setRoomActive(true);
  assert.equal(h.audio.calls, 1);
  assert.equal(h.audio.paused, false);
  h.setRoomActive(false); h.interact(); await settle();
  assert.equal(h.audio.paused, true);
  h.setRoomActive(true); await settle();
  assert.equal(h.audio.calls, 2);
  assert.equal(h.audio.currentTime, 42);
  h.click(); h.setRoomActive(false); h.setRoomActive(true); await settle();
  assert.equal(h.audio.paused, true, 'Returning to a room must not override mute');
});
test('Theatre player pauses background music through loading, interaction and hidden-tab return', async t => {
  const h = setup(t);
  h.click(); await settle();
  const release = suspendBackgroundMusic(); t.after(release);
  assert.equal(h.audio.paused, true);
  assert.equal(h.states.at(-1), 'paused');
  h.interact(); h.visibility(true); h.visibility(false); await settle();
  assert.equal(h.audio.calls, 1);
  release(); await settle();
  assert.equal(h.audio.calls, 2);
  assert.equal(h.states.at(-1), 'on');
});
test('closing a video never overrides a user mute', async t => {
  const h = setup(t);
  h.click(); await settle();
  const release = suspendBackgroundMusic(); t.after(release);
  h.click(); release(); await settle();
  assert.equal(h.storage.get(FOYER_SOUND_PREFERENCE), 'off');
  assert.equal(h.audio.paused, true);
  assert.equal(h.audio.calls, 1);
});
test('overlapping players each release their own interruption exactly once', async t => {
  const h = setup(t);
  h.click(); await settle();
  const a = suspendBackgroundMusic(), b = suspendBackgroundMusic();
  t.after(a); t.after(b);
  a(); a(); await settle();
  assert.equal(h.audio.paused, true);
  b(); await settle();
  assert.equal(h.audio.calls, 2);
});
test('late play resolution cannot leak music over a video', async t => {
  const h = setup(t);
  let finish;
  h.audio.play = () => new Promise(resolve => { finish = () => { h.audio.paused = false; resolve(); }; });
  h.click();
  const release = suspendBackgroundMusic(); t.after(release);
  finish(); await settle();
  assert.equal(h.audio.paused, true);
  h.dispose(); release();
});
test('video release on a non-room route does not restart music', async t => {
  const h = setup(t);
  h.click(); await settle();
  const release = suspendBackgroundMusic(); t.after(release);
  h.setRoomActive(false); release(); await settle();
  assert.equal(h.audio.paused, true);
  assert.equal(h.audio.calls, 1);
});
test('actual Theatre modal effect suspends music while opening and releases on close/unmount', async t => {
  const h = setup(t);
  h.click(); await settle();
  const effects = [];
  let stateIndex = 0, refIndex = 0;
  const dialog = { showModal() { this.open = true; }, close() { this.open = false; } };
  const react = {
    useCallback: fn => fn,
    useEffect: (effect, deps) => effects.push({ effect, deps }),
    useRef: value => ({ current: refIndex++ === 0 ? dialog : value }),
    useState: value => [stateIndex++ === 1 ? 'sample' : value, () => {}],
  };
  const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
  const source = fs.readFileSync(path.join(__dirname, '../src/components/TheatreMembership/TheatreScreenings.tsx'), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const component = { exports: {} };
  new Function('require', 'module', 'exports', output)(name => {
    if (name === 'react') return react;
    if (name === '@mux/mux-player-react' || name.endsWith('.css')) return {};
    if (name === '@/components/FoyerAudio/musicFocus') return load('components/FoyerAudio/musicFocus.ts');
    return require(name);
  }, component, component.exports);
  component.exports.default({ videos: [{ id: 'sample', title: 'Sample', description: '', isSample: true }] });
  const effect = effects.find(({ deps }) => deps.length === 1 && deps[0] === 'sample');
  assert.ok(effect, 'Video dialog lifecycle must be present');
  const close = effect.effect();
  try {
    assert.equal(dialog.open, true);
    assert.equal(h.audio.paused, true);
    h.interact(); await settle();
    assert.equal(h.audio.calls, 1);
  } finally { close(); }
  await settle();
  assert.equal(dialog.open, false);
  assert.equal(h.audio.paused, false);
  assert.equal(h.audio.calls, 2);
  assert.equal(h.document.body.style.overflow, '');
});
test('silent until interaction, then plays at low volume', async t => {
  const h = setup(t);
  assert.equal(h.audio.calls, 0);
  assert.equal(h.audio.volume, .25);
  h.interact(); await settle();
  assert.equal(h.audio.calls, 1);
  assert.equal(h.states.at(-1), 'on');
});
test('mute pauses, persists and cannot be undone by another page interaction', async t => {
  const h = setup(t);
  h.click(); await settle();
  h.click();
  assert.equal(h.audio.paused, true);
  assert.equal(h.storage.get(FOYER_SOUND_PREFERENCE), 'off');
  h.interact(); await settle();
  assert.equal(h.audio.calls, 1);
  h.click(); await settle();
  assert.equal(h.states.at(-1), 'on');
  assert.equal(h.storage.get(FOYER_SOUND_PREFERENCE), 'on');
});
test('stored off preference is honored until explicit sound-on click', async t => {
  const h = setup(t, 'off');
  h.interact(); await settle();
  assert.equal(h.audio.calls, 0);
  h.click(); await settle();
  assert.equal(h.audio.calls, 1);
});
test('hidden page pauses and returns only when enabled', async t => {
  const h = setup(t);
  h.interact(); await settle();
  h.visibility(true);
  assert.equal(h.audio.paused, true);
  h.visibility(false); await settle();
  assert.equal(h.audio.calls, 2);
  h.click(); h.visibility(true); h.visibility(false); await settle();
  assert.equal(h.audio.calls, 2);
});
test('cleanup pauses and removes gesture/visibility listeners', async t => {
  const h = setup(t);
  h.interact(); await settle();
  h.dispose();
  h.interact(); h.click(); h.visibility(false); await settle();
  assert.equal(h.audio.paused, true);
  assert.equal(h.audio.calls, 1);
});
test('pending play cannot restart audio after a mute or route departure', async t => {
  const h = setup(t);
  let finish;
  h.audio.play = function () { this.calls++; return new Promise(resolve => { finish = () => { this.paused = false; resolve(); }; }); };
  h.click(); h.click(); finish(); await settle();
  assert.equal(h.audio.paused, true);
  assert.equal(h.states.at(-1), 'off');
  h.click(); h.dispose(); finish(); await settle();
  assert.equal(h.audio.paused, true);
});
test('autoplay rejection is handled and an explicit click can retry', async t => {
  const h = setup(t);
  const play = h.audio.play;
  h.audio.play = () => Promise.reject(Object.assign(Error('gesture required'), { name: 'NotAllowedError' }));
  h.interact(); await settle();
  assert.equal(h.states.at(-1), 'off');
  h.audio.play = play;
  h.click(); await settle();
  assert.equal(h.states.at(-1), 'on');
});
test('missing audio has a retry state and does not repeatedly fail on unrelated clicks', async t => {
  const h = setup(t);
  h.click(); await settle();
  h.audio.dispatchEvent(new Event('error'));
  h.interact(); await settle();
  assert.equal(h.states.at(-1), 'error');
  assert.equal(h.audio.calls, 1);
  h.click(); await settle();
  assert.equal(h.audio.loads, 1);
  assert.equal(h.states.at(-1), 'on');
});
test('keyboard activation works and blocked storage never breaks controls', async t => {
  const h = setup(t, undefined, true);
  h.document.dispatchEvent(new FakeKeyboardEvent('Shift')); await settle();
  assert.equal(h.audio.calls, 0);
  h.document.dispatchEvent(new FakeKeyboardEvent('Enter')); await settle();
  assert.equal(h.audio.calls, 1);
  h.click(); assert.equal(h.audio.paused, true);
});
