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
  assert.equal(manager.ambientNodes.some((node) => node.kind === "buffer-source"), false, "ambience must be tonal, not a noise loop");
  assert.ok(manager.ambientNodes.filter((node) => node.kind === "oscillator").length >= 3);
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

test("audible effects prefer generated WAV media and clean up their URLs", async () => {
  const environment = fixture();
  const blobs = [];
  const revoked = [];
  let plays = 0;
  class FakeBlob {
    constructor(parts, options) {
      this.parts = parts;
      this.type = options.type;
      blobs.push(this);
    }
  }
  class FakeAudio {
    constructor(src) { this.src = src; }
    cloneNode() { return new FakeAudio(this.src); }
    addEventListener() {}
    async play() { plays += 1; }
    pause() {}
  }
  environment.host.Audio = FakeAudio;
  environment.host.Blob = FakeBlob;
  environment.host.URL = {
    createObjectURL: (_blob) => `blob:test-${blobs.length}`,
    revokeObjectURL: (url) => revoked.push(url),
  };
  const manager = new SoundManager({
    host: environment.host,
    storage: environment.storage,
    documentRef: null,
  });

  assert.equal(await manager.playSelection(), true);
  assert.equal(await manager.playTurnStart(true), true);
  assert.equal(plays, 2);
  assert.equal(blobs.length, 2);
  assert.equal(blobs.every((blob) => blob.type === "audio/wav"), true);
  assert.equal(new TextDecoder().decode(blobs[0].parts[0].slice(0, 4)), "RIFF");
  const clip = new DataView(blobs[0].parts[0]);
  let peak = 0;
  for (let offset = 44; offset < clip.byteLength; offset += 2) peak = Math.max(peak, Math.abs(clip.getInt16(offset, true)) / 0x7fff);
  assert.ok(peak >= .87, "effect clips must be normalized to an audible level");

  manager.destroy();
  assert.equal(revoked.length, 2);
});
