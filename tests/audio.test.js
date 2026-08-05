import test from "node:test";
import assert from "node:assert/strict";
import { SOUND_STORAGE_KEY, SoundManager } from "../src/audio.js";

class FakeParam {
  constructor() { this.value = 0; }
  setValueAtTime(value) { this.value = value; }
  exponentialRampToValueAtTime(value) { this.value = value; }
}

class FakeNode {
  constructor(type) {
    this.kind = type;
    this.type = "";
    this.gain = new FakeParam();
    this.frequency = new FakeParam();
    this.Q = new FakeParam();
    this.started = false;
    this.stopped = false;
  }
  connect(target) { this.target = target; return target; }
  disconnect() { this.disconnected = true; }
  start() { this.started = true; }
  stop() { this.stopped = true; }
}

class FakeAudioContext {
  constructor() {
    this.state = "suspended";
    this.currentTime = 2;
    this.sampleRate = 100;
    this.destination = new FakeNode("destination");
    this.nodes = [];
  }
  node(type) { const node = new FakeNode(type); this.nodes.push(node); return node; }
  createGain() { return this.node("gain"); }
  createOscillator() { return this.node("oscillator"); }
  createBufferSource() { return this.node("buffer-source"); }
  createBiquadFilter() { return this.node("filter"); }
  createBuffer(_channels, length) {
    const data = new Float32Array(length);
    return { getChannelData: () => data };
  }
  async resume() { this.state = "running"; }
  close() { this.state = "closed"; }
}

function fixture(storedValue = null) {
  const values = new Map(storedValue === null ? [] : [[SOUND_STORAGE_KEY, storedValue]]);
  const timers = new Map();
  let nextTimer = 1;
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const host = {
    AudioContext: FakeAudioContext,
    setTimeout(callback, delay) {
      const id = nextTimer++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  };
  return { host, storage, timers, values };
}

test("sound starts enabled, creates ambience, and persists mute", async () => {
  const environment = fixture();
  const manager = new SoundManager({
    host: environment.host,
    storage: environment.storage,
    documentRef: null,
    random: () => 0.5,
  });

  assert.equal(manager.enabled, true);
  manager.setMatchActive(true);
  assert.equal(await manager.unlock(), true);
  assert.equal(manager.context.state, "running");
  assert.ok(manager.ambientNodes.length >= 5);
  assert.ok(environment.timers.size >= 1, "distant impact must be scheduled");

  await manager.playSelection();
  await manager.playEnabledCue();
  await manager.playTurnStart(true);
  await manager.playBattle(true);
  assert.ok(manager.context.nodes.some((node) => node.kind === "oscillator" && node.started));
  assert.ok(manager.effectTimers.size >= 1, "battle result must be synchronized");

  await manager.setEnabled(false);
  assert.equal(environment.values.get(SOUND_STORAGE_KEY), "off");
  assert.equal(manager.ambientNodes.length, 0);
  assert.equal(manager.effectTimers.size, 0);
  assert.equal(environment.timers.size, 0);

  const reloaded = new SoundManager({ host: environment.host, storage: environment.storage, documentRef: null });
  assert.equal(reloaded.enabled, false);
  assert.equal(await reloaded.unlock(), false);
});

test("missing Web Audio support degrades to silence", async () => {
  const manager = new SoundManager({ host: {}, storage: null, documentRef: null });
  manager.setMatchActive(true);
  assert.equal(await manager.playSelection(), false);
  assert.equal(manager.context, null);
});
