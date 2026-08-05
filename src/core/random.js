export function hashSeed(value) {
  const text = String(value ?? "");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0 || 0x9e3779b9;
}
export class SeededRandom {
  constructor(seed) {
    this.state = typeof seed === "number" ? seed >>> 0 : hashSeed(seed);
    if (this.state === 0) this.state = 0x9e3779b9;
  }

  next() {
    let value = (this.state += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    const result = ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    this.state >>>= 0;
    return result;
  }

  int(min, max) {
    if (max < min) throw new RangeError("max must be greater than or equal to min");
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick(values) {
    if (!values.length) return undefined;
    return values[this.int(0, values.length - 1)];
  }

  shuffle(values) {
    const copy = [...values];
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const target = this.int(0, index);
      [copy[index], copy[target]] = [copy[target], copy[index]];
    }
    return copy;
  }

  weighted(values, getWeight = (entry) => entry.weight) {
    const total = values.reduce((sum, entry) => sum + Math.max(0, getWeight(entry)), 0);
    if (total <= 0) return this.pick(values);
    let cursor = this.next() * total;
    for (const entry of values) {
      cursor -= Math.max(0, getWeight(entry));
      if (cursor <= 0) return entry;
    }
    return values.at(-1);
  }
}

export function randomSeed() {
  if (globalThis.crypto?.getRandomValues) {
    const values = new Uint32Array(2);
    globalThis.crypto.getRandomValues(values);
    return `${values[0].toString(36)}-${values[1].toString(36)}`;
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}
