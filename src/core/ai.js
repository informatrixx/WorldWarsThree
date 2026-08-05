import {
  computeBattleOdds,
  discardCard,
  endTurn,
  getActivePlayer,
  getLegalAttacks,
  getLegalCardTargets,
  playCard,
  requiresCardDiscard,
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

function frontlinePressure(state, region) {
  return region.neighbors
    .map((id) => state.map.regions[id])
    .filter((neighbor) => neighbor.ownerId !== region.ownerId)
    .reduce((sum, neighbor) => sum + neighbor.units.length, 0);
}

function bestAttackSource(state, cardId) {
  const sourceIds = new Set(getLegalCardTargets(state, cardId));
  const attacks = getLegalAttacks(state)
    .filter((attack) => sourceIds.has(attack.sourceId))
    .map((attack) => tacticalScore(state, attack, state.config.difficulty))
    .sort((first, second) => second.score - first.score || first.sourceId - second.sourceId);
  return attacks[0]?.sourceId ?? null;
}

function chooseCardPlay(state, card) {
  const targets = getLegalCardTargets(state, card.id);
  if (!targets.length) return null;
  const regions = state.map.regions;
  if (["fireSupport", "luckyRoll"].includes(card.type)) {
    const targetId = bestAttackSource(state, card.id);
    return targetId === null ? null : { cardId: card.id, selection: { targetId }, score: card.type === "luckyRoll" ? 90 : 75 };
  }
  if (card.type === "supplyDrop") {
    const targetId = [...targets].sort((first, second) => {
      const firstRegion = regions[first];
      const secondRegion = regions[second];
      const firstScore = frontlinePressure(state, firstRegion) * 5 + getLegalAttacks(state).filter((attack) => attack.sourceId === first).length * 18 - firstRegion.units.length;
      const secondScore = frontlinePressure(state, secondRegion) * 5 + getLegalAttacks(state).filter((attack) => attack.sourceId === second).length * 18 - secondRegion.units.length;
      return secondScore - firstScore || first - second;
    })[0];
    return { cardId: card.id, selection: { targetId }, score: 62 };
  }
  if (card.type === "fortification") {
    const ranked = [...targets].map((targetId) => {
      const region = regions[targetId];
      return {
        targetId,
        score: frontlinePressure(state, region) * 4 + (region.isHeadquarters ? 35 : 0) + (region.terrain === "city" ? 12 : 0) - region.units.length,
      };
    }).sort((first, second) => second.score - first.score || first.targetId - second.targetId);
    if (ranked[0].score <= 0) return null;
    return { cardId: card.id, selection: { targetId: ranked[0].targetId }, score: 50 + ranked[0].score };
  }
  if (card.type === "mobilization") {
    const targetId = [...targets].sort((first, second) => {
      const score = (id) => [id, ...regions[id].neighbors]
        .filter((regionId) => regions[regionId].ownerId === regions[id].ownerId)
        .reduce((sum, regionId) => sum + frontlinePressure(state, regions[regionId]) * 3 + (8 - regions[regionId].units.length), 0);
      return score(second) - score(first) || first - second;
    })[0];
    return { cardId: card.id, selection: { targetId }, score: 100 };
  }
  if (card.type === "redeploy") {
    const candidates = [];
    for (const sourceId of targets) {
      for (const targetId of getLegalCardTargets(state, card.id, { sourceId })) {
        const source = regions[sourceId];
        const target = regions[targetId];
        const score = frontlinePressure(state, target) * 8 - frontlinePressure(state, source) * 4
          + getLegalAttacks(state).filter((attack) => attack.sourceId === targetId).length * 20
          - target.units.length;
        candidates.push({ sourceId, targetId, score });
      }
    }
    candidates.sort((first, second) => second.score - first.score || first.sourceId - second.sourceId || first.targetId - second.targetId);
    if (!candidates.length || candidates[0].score <= 0) return null;
    return { cardId: card.id, selection: candidates[0], score: 55 + candidates[0].score };
  }
  return null;
}

export function playAiCards(initialState) {
  let state = initialState;
  const player = getActivePlayer(state);
  if (player.isHuman || state.phase !== "playing" || !state.config.cardsEnabled) return { state, played: 0, discarded: 0 };
  let discarded = 0;
  while (requiresCardDiscard(state)) {
    const values = { supplyDrop: 45, redeploy: 40, fireSupport: 60, fortification: 48, luckyRoll: 75, mobilization: 90 };
    const card = [...getActivePlayer(state).hand]
      .sort((first, second) => values[first.type] - values[second.type] || first.id.localeCompare(second.id))[0];
    state = discardCard(state, card.id);
    discarded += 1;
  }
  let played = 0;
  while (played < 3) {
    const choices = getActivePlayer(state).hand
      .map((card) => chooseCardPlay(state, card))
      .filter(Boolean)
      .sort((first, second) => second.score - first.score || first.cardId.localeCompare(second.cardId));
    if (!choices.length) break;
    state = playCard(state, choices[0].cardId, choices[0].selection).state;
    played += 1;
  }
  return { state, played, discarded };
}

export function playAiTurn(initialState) {
  let state = playAiCards(initialState).state;
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
