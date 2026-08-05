export const SOUND_STORAGE_KEY = "dicefront-dominion:sound:v1";

const MASTER_GAIN = 0.32;
const EFFECT_GAIN = 0.55;
const AMBIENT_GAIN = 0.07;

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
    this.onVisibilityChange = () => {
      this.pageVisible = !this.documentRef?.hidden;
      if (this.pageVisible) void this.unlock();
      else this.stopAmbientNodes();
    };
    this.documentRef?.addEventListener?.("visibilitychange", this.onVisibilityChange);
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
      this.clearEffectTimers();
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
      if (this.context.state === "suspended") await this.context.resume();
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
      this.clearEffectTimers();
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
    const wind = this.context.createBufferSource();
    const windFilter = this.context.createBiquadFilter();
    const windGain = this.context.createGain();
    wind.buffer = this.createNoiseBuffer(2.5);
    wind.loop = true;
    windFilter.type = "lowpass";
    windFilter.frequency.value = 720;
    windGain.gain.value = 0.34;
    wind.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(this.ambient);
    wind.start(now);

    const rumble = this.context.createOscillator();
    const rumbleGain = this.context.createGain();
    rumble.type = "sine";
    rumble.frequency.value = 43;
    rumbleGain.gain.value = 0.055;
    rumble.connect(rumbleGain);
    rumbleGain.connect(this.ambient);
    rumble.start(now);
    this.ambientNodes = [wind, windFilter, windGain, rumble, rumbleGain];
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
    const delay = 6500 + Math.floor(this.random() * 6500);
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
    oscillator.frequency.setValueAtTime(68 + this.random() * 24, now);
    oscillator.frequency.exponentialRampToValueAtTime(34, now + 1.1);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.11, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.25);
    oscillator.connect(gain);
    gain.connect(this.ambient);
    oscillator.start(now);
    oscillator.stop(now + 1.3);
  }

  play(effect) {
    if (!this.enabled) return Promise.resolve(false);
    return this.unlock().then((ready) => {
      if (ready && this.enabled) effect(this.context);
      return ready;
    });
  }

  tone({ frequency, endFrequency = frequency, duration, gain = 0.08, type = "sine", delay = 0 }) {
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
    envelope.connect(this.effects);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  noiseClick(delay, frequency) {
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
    gain.connect(this.effects);
    source.start(now);
    source.stop(now + 0.06);
  }

  playSelection() {
    return this.play(() => this.tone({ frequency: 230, endFrequency: 285, duration: 0.075, gain: 0.045 }));
  }

  playBattle(attackerWon) {
    return this.play(() => {
      [0, .065, .14, .225, .32, .43].forEach((delay, index) => {
        this.noiseClick(delay, 520 + index * 95 + this.random() * 120);
      });
      const timer = this.setTimer(() => {
        this.effectTimers.delete(timer);
        if (!this.enabled || !this.context) return;
        if (attackerWon) {
          this.tone({ frequency: 185, endFrequency: 278, duration: .25, gain: .095 });
          this.tone({ frequency: 278, endFrequency: 370, duration: .28, gain: .055, delay: .07 });
        } else {
          this.tone({ frequency: 150, endFrequency: 82, duration: .32, gain: .11, type: "triangle" });
        }
      }, 540);
      this.effectTimers.add(timer);
    });
  }

  playEndTurn() {
    return this.play(() => {
      this.tone({ frequency: 240, endFrequency: 165, duration: .22, gain: .055, type: "triangle" });
      this.tone({ frequency: 320, endFrequency: 220, duration: .18, gain: .035, delay: .06 });
    });
  }

  playGameEnd(humanWon) {
    return this.play(() => {
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
    this.clearEffectTimers();
    this.documentRef?.removeEventListener?.("visibilitychange", this.onVisibilityChange);
    try { this.context?.close(); } catch { /* Closing is best effort. */ }
  }
}
