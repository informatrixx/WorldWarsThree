import {
  computeBattleOdds,
  endTurn,
  getActivePlayer,
  getLegalAttacks,
  resolveAttack,
} from "./game.js";
import { hashSeed } from "./random.js";

function tacticalScore(state, attack, difficulty) {
  const source = state.map.regions[attack.sourceId];
  const target = state.map.regions[attack.targetId];
  const playerId = source.ownerId;
  const odds = computeBattleOdds(state, source.id, target.id);
  const friendlyLinks = target.neighbors.filter(
    (neighborId) => state.map.regions[neighborId].ownerId === playerId,
  ).length;
  let score = odds * 100 + friendlyLinks * 6;
  if (target.terrain === "city") score += 12;
  if (target.isHeadquarters && state.config.victoryMode === "headquarters") score += 90;
  if (difficulty === "hard") {
    const hostilePressure = source.neighbors
      .filter((neighborId) => state.map.regions[neighborId].ownerId !== playerId)
      .reduce((sum, neighborId) => sum + state.map.regions[neighborId].units.length, 0);
    const targetExitCount = target.neighbors.filter(
      (neighborId) => state.map.regions[neighborId].ownerId !== playerId,
    ).length;
    score += targetExitCount * 3 - hostilePressure * 0.7;
    if (source.isHeadquarters) score -= 18;
  }
  return { ...attack, odds, score };
}

function decisionHash(state, attackCount) {
  const ownership = state.map.regions
    .map((region) => `${region.ownerId}:${region.units.length}`)
    .join("|");
  return hashSeed(`${state.config.seed}:${state.turn.round}:${getActivePlayer(state).id}:${attackCount}:${ownership}`);
}

export function chooseAiAttack(state, attackCount = 0) {
  const player = getActivePlayer(state);
  if (player.isHuman || state.phase !== "playing") return null;
  const difficulty = state.config.difficulty;
  const maxAttacks = difficulty === "easy" ? 4 : difficulty === "normal" ? 8 : 12;
  if (attackCount >= maxAttacks) return null;

  const attacks = getLegalAttacks(state).map((attack) => tacticalScore(state, attack, difficulty));
  const threshold = difficulty === "easy" ? 0.3 : difficulty === "normal" ? 0.48 : 0.4;
  const plausible = attacks.filter((attack) => attack.odds >= threshold);
  if (!plausible.length) return null;

  const hash = decisionHash(state, attackCount);
  if (difficulty === "easy") {
    if (attackCount > 0 && hash % 100 < 34) return null;
    return plausible[hash % plausible.length];
  }

  plausible.sort((first, second) => second.score - first.score || first.sourceId - second.sourceId || first.targetId - second.targetId);
  if (difficulty === "normal") {
    const window = plausible.slice(0, Math.min(3, plausible.length));
    return window[hash % window.length];
  }
  return plausible[0];
}

export function playAiTurn(initialState) {
  let state = initialState;
  let attacks = 0;
  while (state.phase === "playing") {
    const attack = chooseAiAttack(state, attacks);
    if (!attack) break;
    state = resolveAttack(state, attack.sourceId, attack.targetId).state;
    attacks += 1;
  }
  if (state.phase === "playing") state = endTurn(state);
  return { state, attacks };
}
