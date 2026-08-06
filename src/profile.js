const PROFILE_COOKIE = "dicefront-dominion-profile";
const PROFILE_STORAGE_KEY = "dicefront-dominion:profile:v1";
const PROFILE_VERSION = 1;

export const DEFAULT_PROFILE = Object.freeze({
  version: PROFILE_VERSION,
  unlockedCards: [],
  unlockedSkills: [],
  skillSlots: 2,
  achievements: {},
  stats: { wins: 0, attacksWon: 0, defensesWon: 0, suppliedRounds: 0 },
});

function validIds(values, allowed) {
  return [...new Set(Array.isArray(values) ? values.filter((value) => allowed.includes(value)) : [])];
}

export function normalizeProfile(value, allowedCards = [], allowedSkills = []) {
  const source = value && typeof value === "object" ? value : {};
  const stats = source.stats && typeof source.stats === "object" ? source.stats : {};
  return {
    version: PROFILE_VERSION,
    unlockedCards: validIds(source.unlockedCards, allowedCards),
    unlockedSkills: validIds(source.unlockedSkills, allowedSkills),
    skillSlots: Number(source.skillSlots) === 3 ? 3 : 2,
    achievements: source.achievements && typeof source.achievements === "object" ? source.achievements : {},
    stats: {
      wins: Math.max(0, Number(stats.wins) || 0),
      attacksWon: Math.max(0, Number(stats.attacksWon) || 0),
      defensesWon: Math.max(0, Number(stats.defensesWon) || 0),
      suppliedRounds: Math.max(0, Number(stats.suppliedRounds) || 0),
    },
  };
}

function readCookie() {
  if (typeof document === "undefined") return null;
  const prefix = `${PROFILE_COOKIE}=`;
  const item = document.cookie.split("; ").find((entry) => entry.startsWith(prefix));
  if (!item) return null;
  try {
    return JSON.parse(decodeURIComponent(item.slice(prefix.length)));
  } catch {
    return null;
  }
}

function writeCookie(profile) {
  if (typeof document === "undefined") return false;
  const encoded = encodeURIComponent(JSON.stringify(profile));
  if (encoded.length > 3800) return false;
  document.cookie = `${PROFILE_COOKIE}=${encoded}; max-age=63072000; path=/; SameSite=Lax`;
  return true;
}

export function loadProfile(allowedCards = [], allowedSkills = []) {
  let parsed = readCookie();
  if (!parsed && typeof localStorage !== "undefined") {
    try { parsed = JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY)); } catch { parsed = null; }
  }
  return normalizeProfile(parsed ?? DEFAULT_PROFILE, allowedCards, allowedSkills);
}

export function saveProfile(profile, allowedCards = [], allowedSkills = []) {
  const normalized = normalizeProfile(profile, allowedCards, allowedSkills);
  const cookieSaved = writeCookie(normalized);
  if (!cookieSaved && typeof localStorage !== "undefined") {
    try { localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(normalized)); } catch { /* private mode */ }
  }
  return normalized;
}

export function unlockProfile(profile, { card, skill, thirdSlot = false } = {}, allowedCards = [], allowedSkills = []) {
  const next = normalizeProfile(profile, allowedCards, allowedSkills);
  if (card && allowedCards.includes(card) && !next.unlockedCards.includes(card)) next.unlockedCards.push(card);
  if (skill && allowedSkills.includes(skill) && !next.unlockedSkills.includes(skill)) next.unlockedSkills.push(skill);
  if (thirdSlot) next.skillSlots = 3;
  return saveProfile(next, allowedCards, allowedSkills);
}
