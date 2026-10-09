/* eslint-disable @typescript-eslint/no-require-imports -- Node regression tests. */
const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./office-loader.cjs')();
const { connectFoyerAudio, isFoyerPath, FOYER_SOUND_PREFERENCE } = load('components/FoyerAudio/controller.ts');

class FakeNode extends EventTarget {
  contains(target) { return target === this; }
}
class FakeKeyboardEvent extends Event {
  constructor(key) { super('keydown'); this.key = key; }
}
function setup(t, preference, storageBlocked = false) {
  const names = ['document', 'window', 'localStorage', 'Node', 'KeyboardEvent'];
  const descriptors = names.map(name => Object.getOwnPropertyDescriptor(global, name));
  const document = new FakeNode();
  document.hidden = false;
  const window = new FakeNode();
  const storage = new Map(preference ? [[FOYER_SOUND_PREFERENCE, preference]] : []);
  const localStorage = {
    getItem: key => { if (storageBlocked) throw Error('blocked'); return storage.get(key); },
    setItem: (key, value) => { if (storageBlocked) throw Error('blocked'); storage.set(key, value); },
  };
  for (const [name, value] of Object.entries({ document, window, localStorage, Node: FakeNode, KeyboardEvent: FakeKeyboardEvent })) {
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
  const dispose = connectFoyerAudio(audio, button, state => states.push(state));
  t.after(() => {
    dispose();
    names.forEach((name, i) => {
      if (descriptors[i]) Object.defineProperty(global, name, descriptors[i]);
      else delete global[name];
    });
  });
  return { audio, button, document, window, storage, states, dispose,
    click: () => button.dispatchEvent(new Event('click')),
    interact: () => document.dispatchEvent(new Event('pointerup')),
    visibility: hidden => { document.hidden = hidden; document.dispatchEvent(new Event('visibilitychange')); },
  };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('audio is restricted to the two foyer routes, never Theatre/account/checkout', () => {
  assert.equal(isFoyerPath('/'), true);
  assert.equal(isFoyerPath('/foyer'), true);
  for (const path of [null, '/theatre', '/office', '/merch', '/membership', '/account', '/checkout', '/foyer/other']) {
    assert.equal(isFoyerPath(path), false);
  }
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
