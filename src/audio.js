export const SOUND_STORAGE_KEY = "dicefront-dominion:sound:v1";

const MASTER_GAIN = 0.78;
const EFFECT_GAIN = 0.9;
const AMBIENT_GAIN = 0.22;
const CLIP_SAMPLE_RATE = 22050;

const CLIP_RECIPES = {
  selection: { duration: .14, tones: [[0, .12, 320, 430, .48, "triangle"]] },
  enabled: { duration: .38, tones: [[0, .18, 392, 494, .48, "triangle"], [.15, .2, 523, 659, .42, "triangle"]] },
  "turn-human": { duration: .44, tones: [[0, .2, 330, 330, .48, "triangle"], [.16, .24, 494, 494, .44, "triangle"]] },
  "turn-ai": { duration: .42, tones: [[0, .18, 247, 220, .4, "triangle"], [.15, .22, 294, 277, .36, "triangle"]] },
  "end-turn": { duration: .4, tones: [[0, .24, 350, 230, .45, "triangle"], [.08, .25, 270, 180, .34, "triangle"]] },
  "card-draw": { duration: .32, tones: [[0, .12, 420, 520, .42, "triangle"], [.1, .16, 560, 680, .38, "sine"]], noise: [[0, .05, .18]] },
  card: { duration: .34, tones: [[0, .16, 310, 465, .48, "triangle"], [.13, .18, 465, 620, .4, "triangle"]], noise: [[0, .045, .2]] },
  "battle-win": {
    duration: 1.05,
    tones: [[.52, .3, 196, 294, .44, "triangle"], [.65, .32, 294, 440, .36, "triangle"]],
    noise: [[0, .08, .5], [.1, .08, .48], [.21, .09, .52], [.33, .09, .46], [.45, .1, .42]],
  },
  "battle-loss": {
    duration: .95,
    tones: [[.5, .38, 180, 72, .52, "triangle"]],
    noise: [[0, .09, .5], [.12, .09, .48], [.25, .1, .45], [.39, .11, .4]],
  },
  "game-win": { duration: 1, tones: [[0, .45, 262, 262, .42, "sine"], [.18, .5, 330, 330, .4, "sine"], [.38, .55, 392, 392, .38, "sine"]] },
  "game-loss": { duration: 1, tones: [[0, .45, 220, 196, .45, "triangle"], [.2, .5, 165, 147, .4, "triangle"], [.4, .52, 110, 82, .38, "triangle"]] },
};

function addTone(samples, start, duration, startFrequency, endFrequency, amplitude, type) {
  const first = Math.floor(start * CLIP_SAMPLE_RATE);
  const count = Math.floor(duration * CLIP_SAMPLE_RATE);
  let phase = 0;
  for (let index = 0; index < count && first + index < samples.length; index += 1) {
    const progress = index / Math.max(1, count - 1);
    phase += (Math.PI * 2 * (startFrequency + (endFrequency - startFrequency) * progress)) / CLIP_SAMPLE_RATE;
    const envelope = Math.sin(Math.PI * progress) ** .7;
    const wave = type === "triangle" ? (2 / Math.PI) * Math.asin(Math.sin(phase)) : Math.sin(phase);
    samples[first + index] += wave * envelope * amplitude;
  }
}

function addNoise(samples, start, duration, amplitude, seed) {
  const first = Math.floor(start * CLIP_SAMPLE_RATE);
  const count = Math.floor(duration * CLIP_SAMPLE_RATE);
  let value = seed || 1;
  let previous = 0;
  for (let index = 0; index < count && first + index < samples.length; index += 1) {
    value = (value * 1664525 + 1013904223) >>> 0;
    previous = previous * .42 + ((value / 0xffffffff) * 2 - 1) * .58;
    const progress = index / Math.max(1, count - 1);
    samples[first + index] += previous * (1 - progress) ** 1.6 * amplitude;
  }
}

function createWavBytes(name) {
  const recipe = CLIP_RECIPES[name];
  if (!recipe) throw new Error(`Unknown audio clip: ${name}`);
  const samples = new Float32Array(Math.ceil(recipe.duration * CLIP_SAMPLE_RATE));
  recipe.tones?.forEach((tone) => addTone(samples, ...tone));
  recipe.noise?.forEach((noise, index) => addNoise(samples, ...noise, index + 1));
  const peak = samples.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0);
  const normalization = peak > 0 ? .88 / peak : 1;
  samples.forEach((sample, index) => { samples[index] = sample * normalization; });
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  const write = (offset, text) => [...text].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  write(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, CLIP_SAMPLE_RATE, true);
  view.setUint32(28, CLIP_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, Math.max(-1, Math.min(1, sample)) * 0x7fff, true));
  return bytes;
}

function safeStop(node) {
  try { node.stop(); } catch { /* The node may already be stopped. */ }
  try { node.disconnect(); } catch { /* Disconnection is best effort. */ }
}

export class SoundManager {
  constructor({
    host = globalThis.window,
    storage = globalThis.localStorage,
    documentRef = globalThis.document,
    random = Math.random,
  } = {}) {
    this.host = host;
    this.storage = storage;
    this.documentRef = documentRef;
    this.random = random;
    this.enabled = this.loadEnabled();
    this.context = null;
    this.master = null;
    this.effects = null;
    this.ambient = null;
    this.matchActive = false;
    this.pageVisible = !documentRef?.hidden;
    this.ambientNodes = [];
    this.ambientTimer = null;
    this.effectTimers = new Set();
    this.mediaClips = new Map();
    this.activeMedia = new Set();
    this.battleMedia = new Set();
    this.battleBus = null;
    this.battlePlaybackId = 0;
    this.lastPlaybackError = null;
    this.onFirstInteraction = () => {
      void this.unlock().then((ready) => {
        if (ready) this.removeInteractionListeners();
      });
    };
    this.onVisibilityChange = () => {
      this.pageVisible = !this.documentRef?.hidden;
      if (this.pageVisible) void this.unlock();
      else this.stopAmbientNodes();
    };
    this.documentRef?.addEventListener?.("visibilitychange", this.onVisibilityChange);
    this.documentRef?.addEventListener?.("pointerdown", this.onFirstInteraction, { capture: true });
    this.documentRef?.addEventListener?.("keydown", this.onFirstInteraction, { capture: true });
  }

  removeInteractionListeners() {
    this.documentRef?.removeEventListener?.("pointerdown", this.onFirstInteraction, { capture: true });
    this.documentRef?.removeEventListener?.("keydown", this.onFirstInteraction, { capture: true });
  }

  loadEnabled() {
    try {
      return this.storage?.getItem(SOUND_STORAGE_KEY) !== "off";
    } catch {
      return true;
    }
  }

  saveEnabled() {
    try {
      this.storage?.setItem(SOUND_STORAGE_KEY, this.enabled ? "on" : "off");
    } catch {
      // Sound remains controllable for the current page if storage is blocked.
    }
  }

  async setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    this.saveEnabled();
    if (!this.enabled) {
      this.stopAmbientNodes();
      this.stopBattleEffects();
      this.stopMedia();
      if (this.master) this.master.gain.setValueAtTime(0, this.context.currentTime);
      return false;
    }
    if (this.master) this.master.gain.setValueAtTime(MASTER_GAIN, this.context.currentTime);
    return this.unlock();
  }

  toggle() {
    return this.setEnabled(!this.enabled);
  }

  async unlock() {
    if (!this.enabled) return false;
    if (!this.context) {
      const AudioContextClass = this.host?.AudioContext ?? this.host?.webkitAudioContext;
      if (!AudioContextClass) return false;
      try {
        this.context = new AudioContextClass();
        this.master = this.context.createGain();
        this.effects = this.context.createGain();
        this.ambient = this.context.createGain();
        this.master.gain.value = MASTER_GAIN;
        this.effects.gain.value = EFFECT_GAIN;
        this.ambient.gain.value = AMBIENT_GAIN;
        this.effects.connect(this.master);
        this.ambient.connect(this.master);
        this.master.connect(this.context.destination);
      } catch {
        this.context = null;
        return false;
      }
    }
    try {
      if (this.context.state !== "running" && this.context.state !== "closed") await this.context.resume();
    } catch {
      return false;
    }
    if (this.matchActive && this.pageVisible) this.startAmbientNodes();
    return this.context.state !== "closed";
  }

  setMatchActive(active) {
    this.matchActive = Boolean(active);
    if (!this.matchActive) {
      this.stopAmbientNodes();
      this.stopBattleEffects();
      this.stopMedia();
      return;
    }
    void this.unlock();
  }

  createNoiseBuffer(duration) {
    const length = Math.max(1, Math.floor(this.context.sampleRate * duration));
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    let previous = 0;
    for (let index = 0; index < length; index += 1) {
      const white = this.random() * 2 - 1;
      previous = previous * 0.82 + white * 0.18;
      data[index] = previous;
    }
    return buffer;
  }

  startAmbientNodes() {
    if (!this.enabled || !this.matchActive || !this.pageVisible || this.ambientNodes.length) return;
    const now = this.context.currentTime;
    const drone = this.context.createOscillator();
    const droneGain = this.context.createGain();
    drone.type = "triangle";
    drone.frequency.value = 146.83;
    droneGain.gain.value = .11;
    drone.connect(droneGain);
    droneGain.connect(this.ambient);

    const fifth = this.context.createOscillator();
    const fifthGain = this.context.createGain();
    fifth.type = "sine";
    fifth.frequency.value = 220;
    fifthGain.gain.value = .055;
    fifth.connect(fifthGain);
    fifthGain.connect(this.ambient);

    const pulse = this.context.createOscillator();
    const pulseDepth = this.context.createGain();
    pulse.type = "sine";
    pulse.frequency.value = .075;
    pulseDepth.gain.value = .025;
    pulse.connect(pulseDepth);
    pulseDepth.connect(droneGain.gain);

    drone.start(now);
    fifth.start(now);
    pulse.start(now);
    this.ambientNodes = [drone, droneGain, fifth, fifthGain, pulse, pulseDepth];
    this.scheduleDistantImpact();
  }

  stopAmbientNodes() {
    if (this.ambientTimer !== null) {
      this.clearTimer(this.ambientTimer);
      this.ambientTimer = null;
    }
    this.ambientNodes.forEach(safeStop);
    this.ambientNodes = [];
  }

  scheduleDistantImpact() {
    if (!this.enabled || !this.matchActive || !this.pageVisible) return;
    const delay = 8000 + Math.floor(this.random() * 6000);
    this.ambientTimer = this.setTimer(() => {
      this.ambientTimer = null;
      this.playDistantImpact();
      this.scheduleDistantImpact();
    }, delay);
  }

  playDistantImpact() {
    if (!this.context || !this.ambientNodes.length) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(118 + this.random() * 28, now);
    oscillator.frequency.exponentialRampToValueAtTime(52, now + 1.1);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.25);
    oscillator.connect(gain);
    gain.connect(this.ambient);
    oscillator.start(now);
    oscillator.stop(now + 1.3);
  }

  play(effect) {
    return this.playWithClip(null, effect);
  }

  async playWithClip(clipName, effect, group = null) {
    if (!this.enabled) return false;
    const mediaPlayback = clipName ? this.playMedia(clipName, group) : Promise.resolve(false);
    const [mediaPlayed, ready] = await Promise.all([mediaPlayback, this.unlock()]);
    if (mediaPlayed) return true;
    if (ready && this.enabled) effect(this.context);
    return ready;
  }

  getMediaClip(name) {
    if (this.mediaClips.has(name)) return this.mediaClips.get(name);
    const AudioClass = this.host?.Audio;
    const BlobClass = this.host?.Blob;
    const urlApi = this.host?.URL;
    if (!AudioClass || !BlobClass || !urlApi?.createObjectURL) return null;
    const url = urlApi.createObjectURL(new BlobClass([createWavBytes(name)], { type: "audio/wav" }));
    const base = new AudioClass(url);
    base.preload = "auto";
    const clip = { base, url };
    this.mediaClips.set(name, clip);
    return clip;
  }

  async playMedia(name, group = null) {
    let audio = null;
    try {
      const clip = this.getMediaClip(name);
      if (!clip) return false;
      audio = clip.base.cloneNode();
      audio.volume = .92;
      const cleanup = () => {
        this.activeMedia.delete(audio);
        this.battleMedia.delete(audio);
      };
      audio.addEventListener?.("ended", cleanup, { once: true });
      audio.addEventListener?.("error", cleanup, { once: true });
      this.activeMedia.add(audio);
      if (group === "battle") this.battleMedia.add(audio);
      await audio.play();
      this.lastPlaybackError = null;
      return true;
    } catch (error) {
      if (audio) {
        this.activeMedia.delete(audio);
        this.battleMedia.delete(audio);
      }
      this.lastPlaybackError = error?.name || "PlaybackError";
      return false;
    }
  }

  stopMedia() {
    this.activeMedia.forEach((audio) => {
      try { audio.pause(); } catch { /* Stopping media is best effort. */ }
    });
    this.activeMedia.clear();
    this.battleMedia.clear();
  }

  stopBattleEffects() {
    this.battlePlaybackId += 1;
    this.battleMedia.forEach((audio) => {
      try { audio.pause(); } catch { /* Stopping media is best effort. */ }
      this.activeMedia.delete(audio);
    });
    this.battleMedia.clear();
    this.clearEffectTimers();
    if (this.battleBus) {
      try { this.battleBus.disconnect(); } catch { /* The bus may already be disconnected. */ }
      this.battleBus = null;
    }
  }

  tone({ frequency, endFrequency = frequency, duration, gain = 0.08, type = "sine", delay = 0 }, output = this.effects) {
    const now = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    const envelope = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency, now + duration);
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(gain, now + Math.min(0.025, duration / 4));
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(envelope);
    envelope.connect(output);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  noiseClick(delay, frequency, output = this.effects) {
    const now = this.context.currentTime + delay;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = this.createNoiseBuffer(0.055);
    filter.type = "bandpass";
    filter.frequency.value = frequency;
    filter.Q.value = 1.7;
    gain.gain.setValueAtTime(0.11, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.052);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(output);
    source.start(now);
    source.stop(now + 0.06);
  }

  playSelection() {
    return this.playWithClip("selection", () => this.tone({ frequency: 230, endFrequency: 285, duration: 0.075, gain: 0.07 }));
  }

  playEnabledCue() {
    return this.playWithClip("enabled", () => {
      this.tone({ frequency: 330, endFrequency: 440, duration: .13, gain: .09, type: "triangle" });
      this.tone({ frequency: 440, endFrequency: 550, duration: .16, gain: .075, type: "triangle", delay: .1 });
    });
  }

  playTurnStart(humanTurn) {
    return this.playWithClip(humanTurn ? "turn-human" : "turn-ai", () => {
      const first = humanTurn ? 294 : 220;
      const second = humanTurn ? 440 : 277;
      this.tone({ frequency: first, endFrequency: first, duration: .16, gain: .085, type: "triangle" });
      this.tone({ frequency: second, endFrequency: second, duration: .2, gain: .075, type: "triangle", delay: .12 });
    });
  }

  playBattle(attackerWon) {
    this.stopBattleEffects();
    const playbackId = ++this.battlePlaybackId;
    return this.playWithClip(attackerWon ? "battle-win" : "battle-loss", () => {
      if (playbackId !== this.battlePlaybackId) return;
      const output = this.context.createGain();
      output.gain.value = 1;
      output.connect(this.effects);
      this.battleBus = output;
      [0, .065, .14, .225, .32, .43].forEach((delay, index) => {
        this.noiseClick(delay, 520 + index * 95 + this.random() * 120, output);
      });
      const timer = this.setTimer(() => {
        this.effectTimers.delete(timer);
        if (!this.enabled || !this.context || this.battleBus !== output) return;
        if (attackerWon) {
          this.tone({ frequency: 185, endFrequency: 278, duration: .25, gain: .095 }, output);
          this.tone({ frequency: 278, endFrequency: 370, duration: .28, gain: .055, delay: .07 }, output);
        } else {
          this.tone({ frequency: 150, endFrequency: 82, duration: .32, gain: .11, type: "triangle" }, output);
        }
      }, 540);
      this.effectTimers.add(timer);
    }, "battle");
  }

  playEndTurn() {
    return this.playWithClip("end-turn", () => {
      this.tone({ frequency: 240, endFrequency: 165, duration: .22, gain: .055, type: "triangle" });
      this.tone({ frequency: 320, endFrequency: 220, duration: .18, gain: .035, delay: .06 });
    });
  }

  playCardDraw() {
    return this.playWithClip("card-draw", () => {
      this.tone({ frequency: 360, endFrequency: 520, duration: .14, gain: .075, type: "triangle" });
      this.tone({ frequency: 520, endFrequency: 680, duration: .16, gain: .06, type: "sine", delay: .09 });
    });
  }

  playCard() {
    return this.playWithClip("card", () => {
      this.tone({ frequency: 300, endFrequency: 460, duration: .15, gain: .085, type: "triangle" });
      this.tone({ frequency: 460, endFrequency: 620, duration: .18, gain: .065, type: "triangle", delay: .11 });
    });
  }

  playGameEnd(humanWon) {
    return this.playWithClip(humanWon ? "game-win" : "game-loss", () => {
      const notes = humanWon ? [196, 247, 294] : [196, 147, 98];
      notes.forEach((frequency, index) => this.tone({
        frequency,
        endFrequency: frequency,
        duration: .55,
        gain: .07,
        type: humanWon ? "sine" : "triangle",
        delay: index * .13,
      }));
    });
  }

  setTimer(callback, delay) {
    const set = this.host?.setTimeout?.bind(this.host) ?? globalThis.setTimeout;
    return set(callback, delay);
  }

  clearTimer(timer) {
    const clear = this.host?.clearTimeout?.bind(this.host) ?? globalThis.clearTimeout;
    clear(timer);
  }

  clearEffectTimers() {
    this.effectTimers.forEach((timer) => this.clearTimer(timer));
    this.effectTimers.clear();
  }

  destroy() {
    this.stopAmbientNodes();
    this.stopBattleEffects();
    this.stopMedia();
    this.mediaClips.forEach(({ url }) => this.host?.URL?.revokeObjectURL?.(url));
    this.mediaClips.clear();
    this.removeInteractionListeners();
    this.documentRef?.removeEventListener?.("visibilitychange", this.onVisibilityChange);
    try { this.context?.close(); } catch { /* Closing is best effort. */ }
  }
}
