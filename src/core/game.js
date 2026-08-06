import { generateMap, HEX_SIZE, MAP_SIZES, MIN_REGION_CELLS, RIVER_DENSITIES } from "./map-generator.js";
import { randomSeed, SeededRandom } from "./random.js";

export const SCHEMA_VERSION = 5;
export const UNIT_CAP = 8;
export const UNIT_TYPES = Object.freeze(["infantry", "armor", "artillery", "pioneers", "supply", "snipers"]);
export const TERRAIN_TYPES = Object.freeze(["plains", "forest", "hills", "city", "swamp"]);
export const STANCE_TYPES = Object.freeze(["security", "breakthrough", "barrage", "engineering", "supplySurge", "recon"]);
export const VICTORY_MODES = Object.freeze(["conquest", "headquarters"]);
export const DIFFICULTIES = Object.freeze(["easy", "normal", "hard"]);
export const SUPPLY_RATES = Object.freeze({ low: 1, medium: 1.5, high: 2, veryHigh: 3 });
export const CARD_TYPES = Object.freeze([
  "supplyDrop",
  "redeploy",
  "fireSupport",
  "fortification",
  "luckyRoll",
  "mobilization",
  "supplyConvoy",
  "interdiction",
]);
export const SKILL_TYPES = Object.freeze(["quartermaster", "fortressDoctrine", "recon"]);
export const ACHIEVEMENT_TYPES = Object.freeze([
  "firstBreakthrough",
  "supplyChain",
  "encirclement",
  "ironDefense",
  "fieldMarshal",
]);

const COMMANDER_NAMES = Object.freeze([
  "Napoleon Bonbonparte",
  "Hanniball Bärka",
  "Julius Käsear",
  "Alexander der Krümelige",
  "Sun Tzatziki",
  "Dschingis Kännchen",
  "Horatio Nudelson",
  "Arthur Waffley",
  "Scipio Africappuccino",
  "Georg von Knödelwitz",
  "Friedrich der Große Hunger",
  "Gustav Adolfsenf",
  "Tokugawa Ieyasuppe",
  "Yi Sun-Sinfonie",
  "Salatdin der Kühne",
  "Belisar Bällchen",
  "Jan Sobieskeks",
  "Subutai Suboptimal",
]);

function assignCommanderNames(players, seed) {
  const names = new SeededRandom(`${seed}:commander-names`).shuffle(COMMANDER_NAMES);
  players.filter((player) => !player.isHuman).forEach((player, index) => {
    player.commanderName = names[index];
  });
}
export const CARD_HAND_LIMIT = 3;
export const CARD_DECK_COUNTS = Object.freeze({
  supplyDrop: 6,
  redeploy: 6,
  fireSupport: 6,
  fortification: 6,
  luckyRoll: 3,
  mobilization: 3,
  supplyConvoy: 3,
  interdiction: 3,
});
export const BASE_CARD_POOL = Object.freeze([
  "supplyDrop", "redeploy", "fireSupport", "fortification", "luckyRoll", "mobilization",
]);
export const DEFAULT_CARD_POOL = CARD_TYPES;

export const PLAYER_STYLES = Object.freeze([
  { color: "#33b8a6", accent: "#8af2e1", pattern: "diagonal" },
  { color: "#e05c55", accent: "#ffaaa4", pattern: "dots" },
  { color: "#d9a441", accent: "#ffe09b", pattern: "cross" },
  { color: "#7c69d7", accent: "#c1b6ff", pattern: "waves" },
  { color: "#448dd1", accent: "#9fd2ff", pattern: "grid" },
  { color: "#c56baa", accent: "#ffc0ea", pattern: "chevron" },
]);

function clone(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function normalizeConfig(config = {}) {
  const playerCount = Number(config.playerCount ?? 4);
  const mapSize = config.mapSize ?? "medium";
  const difficulty = config.difficulty ?? "normal";
  const victoryMode = config.victoryMode ?? "headquarters";
  const supplyRate = config.supplyRate ?? "low";
  const riverDensity = config.riverDensity ?? "normal";
  const cardsEnabled = config.cardsEnabled === undefined ? true : Boolean(config.cardsEnabled);
  const cardPool = Array.isArray(config.cardPool)
    ? [...new Set(config.cardPool.filter((type) => CARD_TYPES.includes(type)))]
    : [...DEFAULT_CARD_POOL];
  const skillPool = Array.isArray(config.skillPool)
    ? [...new Set(config.skillPool.filter((type) => SKILL_TYPES.includes(type)))]
    : [];
  const skillSlots = Number.isInteger(config.skillSlots) ? Math.max(2, Math.min(3, config.skillSlots)) : 2;
  const skillLoadout = Array.isArray(config.skillLoadout)
    ? [...new Set(config.skillLoadout.filter((type) => skillPool.includes(type)))].slice(0, skillSlots)
    : [];
  const locale = config.locale === "en" ? "en" : "de";
  if (!Number.isInteger(playerCount) || playerCount < 2 || playerCount > 6) {
    throw new RangeError("playerCount must be an integer between 2 and 6");
  }
  if (!MAP_SIZES[mapSize]) throw new RangeError(`Unknown map size: ${mapSize}`);
  if (!DIFFICULTIES.includes(difficulty)) throw new RangeError(`Unknown difficulty: ${difficulty}`);
  if (!VICTORY_MODES.includes(victoryMode)) throw new RangeError(`Unknown victory mode: ${victoryMode}`);
  if (!Object.hasOwn(SUPPLY_RATES, supplyRate)) throw new RangeError(`Unknown supply rate: ${supplyRate}`);
  if (!Object.hasOwn(RIVER_DENSITIES, riverDensity)) throw new RangeError(`Unknown river density: ${riverDensity}`);
  return {
    playerCount,
    mapSize,
    difficulty,
    victoryMode,
    supplyRate,
    riverDensity,
    cardsEnabled,
    cardPool,
    skillPool,
    skillSlots,
    skillLoadout,
    locale,
    seed: String(config.seed || randomSeed()),
  };
}

function createCardState(rng, enabled, cardPool = DEFAULT_CARD_POOL) {
  if (!enabled) return { drawPile: [], discardPile: [], effects: [] };
  const cards = cardPool.flatMap((type) => Array.from(
    { length: CARD_DECK_COUNTS[type] },
    (_, index) => ({ id: `${type}-${index + 1}`, type }),
  ));
  return { drawPile: rng.shuffle(cards), discardPile: [], effects: [] };
}

function drawCard(state, playerId, rng) {
  if (!state.config.cardsEnabled) return null;
  const player = state.players[playerId];
  if (!player?.active || player.hand.length > CARD_HAND_LIMIT) return null;
  if (!state.cards.drawPile.length && state.cards.discardPile.length) {
    state.cards.drawPile = rng.shuffle(state.cards.discardPile);
    state.cards.discardPile = [];
  }
  const card = state.cards.drawPile.pop();
  if (!card) return null;
  player.hand.push(card);
  return card;
}

function randomUnit(rng, allowedTypes = UNIT_TYPES) {
  return rng.weighted([
    { type: "infantry", weight: 0.4 },
    { type: "armor", weight: 0.2 },
    { type: "artillery", weight: 0.15 },
    { type: "pioneers", weight: 0.1 },
    { type: "supply", weight: 0.08 },
    { type: "snipers", weight: 0.07 },
  ].filter(({ type }) => allowedTypes.includes(type))).type;
}

function unitTypes(region) {
  return new Set(region?.units ?? []);
}

function randomUnitForRegion(region, rng) {
  const existing = [...unitTypes(region)];
  return randomUnit(rng, existing.length >= 3 ? existing : UNIT_TYPES);
}

function canAcceptUnits(region, units) {
  return new Set([...(region?.units ?? []), ...units]).size <= 3;
}

export function requiresCardDiscard(state) {
  return Boolean(state.config.cardsEnabled && getActivePlayer(state).hand.length > CARD_HAND_LIMIT);
}

function regionDistanceMatrix(regions) {
  return regions.map((origin) => {
    const distances = Array(regions.length).fill(Infinity);
    distances[origin.id] = 0;
    const queue = [origin.id];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const regionId = queue[cursor];
      for (const neighborId of regions[regionId].neighbors) {
        if (distances[neighborId] !== Infinity) continue;
        distances[neighborId] = distances[regionId] + 1;
        queue.push(neighborId);
      }
    }
    return distances;
  });
}

function balancedRegionQuotas(regionCount, players, rng) {
  const base = Math.floor(regionCount / players.length);
  const quotas = Array(players.length).fill(base);
  rng.shuffle(players.map((player) => player.id))
    .slice(0, regionCount % players.length)
    .forEach((playerId) => { quotas[playerId] += 1; });
  return quotas;
}

function chooseHeadquarters(regions, players, distances, rng) {
  const headquarters = [rng.pick(regions).id];
  while (headquarters.length < players.length) {
    const candidates = regions
      .filter((region) => !headquarters.includes(region.id))
      .map((region) => ({
        id: region.id,
        distance: Math.min(...headquarters.map((hqId) => distances[hqId][region.id])),
      }));
    const greatestDistance = Math.max(...candidates.map((candidate) => candidate.distance));
    headquarters.push(rng.pick(candidates.filter((candidate) => candidate.distance === greatestDistance)).id);
  }
  return headquarters;
}

function safeUnitCap(regionId, ownerId, headquarters, distances) {
  return Math.min(
    UNIT_CAP,
    ...headquarters
      .filter((_, playerId) => playerId !== ownerId)
      .map((hqId) => distances[hqId][regionId]),
  );
}

function buildOwnershipCandidate(regions, players, distances, rng) {
  const quotas = balancedRegionQuotas(regions.length, players, rng);
  const headquarters = chooseHeadquarters(regions, players, distances, rng);
  const ownerIds = Array(regions.length).fill(null);
  const ownedCounts = Array(players.length).fill(0);
  headquarters.forEach((regionId, playerId) => {
    ownerIds[regionId] = playerId;
    ownedCounts[playerId] = 1;
  });

  const coreTargets = quotas.map((quota) => Math.min(4, Math.max(2, Math.floor(quota / 3))));
  let growing = true;
  while (growing && coreTargets.some((target, playerId) => ownedCounts[playerId] < target)) {
    growing = false;
    for (const player of rng.shuffle(players)) {
      const playerId = player.id;
      if (ownedCounts[playerId] >= coreTargets[playerId]) continue;
      const frontier = regions
        .filter((region) => ownerIds[region.id] === null && region.neighbors.some((id) => ownerIds[id] === playerId))
        .map((region) => ({
          region,
          friendlyNeighbors: region.neighbors.filter((id) => ownerIds[id] === playerId).length,
          distance: distances[headquarters[playerId]][region.id],
        }));
      if (!frontier.length) continue;
      const bestScore = Math.max(...frontier.map((entry) => entry.friendlyNeighbors * 20 - entry.distance));
      const selected = rng.pick(frontier.filter(
        (entry) => entry.friendlyNeighbors * 20 - entry.distance === bestScore,
      )).region;
      ownerIds[selected.id] = playerId;
      ownedCounts[playerId] += 1;
      growing = true;
    }
  }
  if (coreTargets.some((target, playerId) => ownedCounts[playerId] < target)) return null;

  for (const region of rng.shuffle(regions.filter((entry) => ownerIds[entry.id] === null))) {
    const eligible = players.filter((player) => ownedCounts[player.id] < quotas[player.id]);
    if (!eligible.length) return null;
    const selected = rng.weighted(eligible, (player) => quotas[player.id] - ownedCounts[player.id]);
    ownerIds[region.id] = selected.id;
    ownedCounts[selected.id] += 1;
  }
  if (ownedCounts.some((count, playerId) => count !== quotas[playerId])) return null;

  const capacities = players.map((player) => regions.reduce((sum, region) => (
    sum + (ownerIds[region.id] === player.id
      ? safeUnitCap(region.id, player.id, headquarters, distances)
      : 0)
  ), 0));
  const commonCapacity = Math.min(...capacities);
  const maximumOwned = Math.max(...ownedCounts);
  if (commonCapacity < maximumOwned) return null;
  const pairDistances = headquarters.flatMap((hqId, first) => (
    headquarters.slice(first + 1).map((otherId) => distances[hqId][otherId])
  ));
  return {
    ownerIds,
    headquarters,
    commonCapacity,
    minimumHeadquartersDistance: Math.min(...pairDistances),
    totalHeadquartersDistance: pairDistances.reduce((sum, distance) => sum + distance, 0),
  };
}

function assignOwnersAndHeadquarters(regions, players, rng) {
  const distances = regionDistanceMatrix(regions);
  let best = null;
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const candidate = buildOwnershipCandidate(regions, players, distances, rng);
    if (!candidate) continue;
    const isBetter = !best
      || candidate.commonCapacity > best.commonCapacity
      || (
        candidate.commonCapacity === best.commonCapacity
        && candidate.minimumHeadquartersDistance > best.minimumHeadquartersDistance
      )
      || (
        candidate.commonCapacity === best.commonCapacity
        && candidate.minimumHeadquartersDistance === best.minimumHeadquartersDistance
        && candidate.totalHeadquartersDistance > best.totalHeadquartersDistance
      );
    if (isBetter) best = candidate;
  }
  if (!best) throw new Error("Unable to create a safe headquarters layout");

  regions.forEach((region) => {
    region.ownerId = best.ownerIds[region.id];
    region.isHeadquarters = false;
  });
  players.forEach((player) => {
    player.headquartersRegionId = best.headquarters[player.id];
    regions[player.headquartersRegionId].isHeadquarters = true;
  });
  return distances;
}

function assignBalancedTerrain(regions, players, rng) {
  for (const player of players) {
    const owned = rng.shuffle(regions.filter((region) => region.ownerId === player.id));
    const cityCount = Math.max(1, Math.floor(owned.length / 8));
    const forestCount = Math.min(owned.length - cityCount, Math.round(owned.length * 0.25));
    const hillCount = Math.min(
      owned.length - cityCount - forestCount,
      Math.round(owned.length * 0.18),
    );
    const swampCount = Math.min(
      owned.length - cityCount - forestCount - hillCount,
      Math.max(1, Math.round(owned.length * 0.12)),
    );
    owned.forEach((region, index) => {
      if (index < cityCount) region.terrain = "city";
      else if (index < cityCount + forestCount) region.terrain = "forest";
      else if (index < cityCount + forestCount + hillCount) region.terrain = "hills";
      else if (index < cityCount + forestCount + hillCount + swampCount) region.terrain = "swamp";
      else region.terrain = "plains";
    });
  }
}

function classPool(total, rng) {
  const infantry = Math.round(total * 0.4);
  const armor = Math.round(total * 0.2);
  const artillery = Math.round(total * 0.15);
  const pioneers = Math.round(total * 0.1);
  const supply = Math.round(total * 0.08);
  const snipers = total - infantry - armor - artillery - pioneers - supply;
  return rng.shuffle([
    ...Array(infantry).fill("infantry"),
    ...Array(armor).fill("armor"),
    ...Array(artillery).fill("artillery"),
    ...Array(pioneers).fill("pioneers"),
    ...Array(supply).fill("supply"),
    ...Array(snipers).fill("snipers"),
  ]);
}

function distributeTypePool(owned, budget, caps, rng) {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const pool = classPool(budget, rng);
    owned.forEach((region) => { region.units = []; });
    let failed = false;
    for (const region of owned) {
      const unique = new Set(region.units);
      const candidates = pool
        .map((type, index) => ({ type, index }))
        .filter(({ type }) => unique.size < 3 || unique.has(type));
      if (!candidates.length) {
        failed = true;
        break;
      }
      const selected = rng.pick(candidates);
      region.units.push(selected.type);
      pool.splice(selected.index, 1);
    }
    while (!failed && pool.length) {
      const eligible = owned.filter((region) => region.units.length < caps[region.id]);
      if (!eligible.length) {
        failed = true;
        break;
      }
      const region = rng.pick(eligible);
      const unique = new Set(region.units);
      const candidates = pool
        .map((type, index) => ({ type, index }))
        .filter(({ type }) => unique.size < 3 || unique.has(type));
      if (!candidates.length) {
        failed = true;
        break;
      }
      const selected = rng.pick(candidates);
      region.units.push(selected.type);
      pool.splice(selected.index, 1);
    }
    if (!failed) return;
  }
  throw new Error("Unable to distribute the unit type pool");
}

function assignBalancedUnits(regions, players, distances, rng) {
  const desiredBudget = Math.max(12, 3 * Math.ceil(regions.length / players.length));
  const headquarters = players.map((player) => player.headquartersRegionId);
  const caps = regions.map((region) => safeUnitCap(region.id, region.ownerId, headquarters, distances));
  const safeCapacities = players.map((player) => regions.reduce((sum, region) => (
    sum + (region.ownerId === player.id ? caps[region.id] : 0)
  ), 0));
  const budget = Math.min(desiredBudget, ...safeCapacities);
  const maximumOwned = Math.max(...players.map(
    (player) => regions.filter((region) => region.ownerId === player.id).length,
  ));
  if (budget < maximumOwned) throw new Error("Safe unit budget cannot cover every region");
  for (const player of players) {
    const owned = rng.shuffle(regions.filter((region) => region.ownerId === player.id));
    distributeTypePool(owned, budget, caps, rng);
  }
  return budget;
}

export function createGame(inputConfig = {}) {
  const config = normalizeConfig(inputConfig);
  const map = generateMap({ size: config.mapSize, seed: config.seed, riverDensity: config.riverDensity });
  const rng = new SeededRandom(`${config.seed}:game`);
  const players = Array.from({ length: config.playerCount }, (_, index) => ({
    id: index,
    style: PLAYER_STYLES[index],
    isHuman: index === 0,
    active: true,
    headquartersRegionId: null,
    hand: [],
    skills: [],
  }));
  assignCommanderNames(players, config.seed);
  const regionDistances = assignOwnersAndHeadquarters(map.regions, players, rng);
  assignBalancedTerrain(map.regions, players, rng);
  const startingUnitBudget = assignBalancedUnits(map.regions, players, regionDistances, rng);
  const state = {
    schemaVersion: SCHEMA_VERSION,
    config,
    map,
    players,
    startingUnitBudget,
    rngState: 0,
    cards: createCardState(rng, config.cardsEnabled, config.cardPool),
    turn: { round: 1, activePlayerIndex: 0, supplyBoostUsed: false, supplyBoostPlayerId: null },
    phase: "playing",
    winnerId: null,
    log: [{ type: "gameStarted", round: 1, seed: config.seed }],
  };
  const skillChoices = [...config.skillPool];
  players.forEach((player, index) => {
    const requested = index === 0 ? config.skillLoadout : [];
    player.skills = requested.length
      ? requested.slice(0, config.skillSlots)
      : rng.shuffle(skillChoices).slice(0, config.skillSlots);
  });
  const drawn = drawCard(state, 0, rng);
  if (drawn) state.log.unshift({ type: "cardDrawn", playerId: 0, cardType: drawn.type, round: 1 });
  state.rngState = rng.state;
  return state;
}

export function getActivePlayer(state) {
  return state.players[state.turn.activePlayerIndex];
}

export function getLegalTargets(state, sourceId) {
  const source = state.map.regions[sourceId];
  const activePlayer = getActivePlayer(state);
  if (
    state.phase !== "playing"
    || !source
    || source.ownerId !== activePlayer.id
    || source.units.length < 2
    || requiresCardDiscard(state)
  ) return [];
  return source.neighbors.filter((id) => (
    state.map.regions[id].ownerId !== activePlayer.id
    && !(state.turn.round === 1 && state.map.regions[id].isHeadquarters)
  ));
}

export function getLegalAttacks(state) {
  const attacks = [];
  for (const region of state.map.regions) {
    for (const targetId of getLegalTargets(state, region.id)) {
      attacks.push({ sourceId: region.id, targetId });
    }
  }
  return attacks;
}

function findHandCard(state, cardId) {
  return getActivePlayer(state).hand.find((card) => card.id === cardId);
}

function ownedRegions(state) {
  const playerId = getActivePlayer(state).id;
  return state.map.regions.filter((region) => region.ownerId === playerId);
}

export function getLegalCardTargets(state, cardId, selection = {}) {
  if (!state.config.cardsEnabled || state.phase !== "playing" || requiresCardDiscard(state)) return [];
  const card = findHandCard(state, cardId);
  if (!card) return [];
  const owned = ownedRegions(state);
  if (card.type === "supplyDrop") {
    return owned.filter((region) => region.units.length < UNIT_CAP).map((region) => region.id);
  }
  if (card.type === "supplyConvoy") {
    const supplied = getSupplyNetwork(state, getActivePlayer(state).id);
    return owned.filter((region) => region.units.length < UNIT_CAP && supplied.has(region.id)).map((region) => region.id);
  }
  if (card.type === "interdiction") {
    return owned.flatMap((region) => region.neighbors)
      .filter((id, index, values) => values.indexOf(id) === index)
      .filter((id) => state.map.regions[id].ownerId !== getActivePlayer(state).id);
  }
  if (["fireSupport", "luckyRoll"].includes(card.type)) {
    return owned.filter((region) => getLegalTargets(state, region.id).length).map((region) => region.id);
  }
  if (card.type === "fortification") return owned.map((region) => region.id);
  if (card.type === "mobilization") {
    return owned.filter((region) => (
      [region.id, ...region.neighbors].some((id) => (
        state.map.regions[id].ownerId === region.ownerId
        && state.map.regions[id].units.length < UNIT_CAP
      ))
    )).map((region) => region.id);
  }
  if (card.type === "redeploy") {
    if (selection.sourceId !== undefined && selection.sourceId !== null) {
      const source = state.map.regions[selection.sourceId];
      if (!source || source.ownerId !== getActivePlayer(state).id || source.units.length < 2) return [];
      return source.neighbors.filter((id) => (
        state.map.regions[id].ownerId === source.ownerId
        && state.map.regions[id].units.length < UNIT_CAP
        && canAcceptUnits(state.map.regions[id], source.units)
      ));
    }
    return owned.filter((source) => (
      source.units.length >= 2
      && source.neighbors.some((id) => (
        state.map.regions[id].ownerId === source.ownerId
        && state.map.regions[id].units.length < UNIT_CAP
      ))
    )).map((region) => region.id);
  }
  return [];
}

export function getPlayableCards(state) {
  if (!state.config.cardsEnabled || state.phase !== "playing" || requiresCardDiscard(state)) return [];
  return getActivePlayer(state).hand.filter((card) => getLegalCardTargets(state, card.id).length);
}

function addEffect(state, type, regionId, cardId) {
  state.cards.effects.push({ type, playerId: getActivePlayer(state).id, regionId, cardId });
}

function removeCardFromHand(state, cardId) {
  const player = getActivePlayer(state);
  const index = player.hand.findIndex((card) => card.id === cardId);
  if (index < 0) throw new Error("Card is not in the active player's hand");
  const [card] = player.hand.splice(index, 1);
  state.cards.discardPile.push(card);
  return card;
}

export function discardCard(currentState, cardId) {
  if (!requiresCardDiscard(currentState)) throw new Error("No card discard is required");
  const state = clone(currentState);
  const card = removeCardFromHand(state, cardId);
  state.log.unshift({
    type: "cardDiscarded",
    playerId: getActivePlayer(state).id,
    cardType: card.type,
    round: state.turn.round,
  });
  state.log = state.log.slice(0, 200);
  return state;
}

export function playCard(currentState, cardId, selection = {}) {
  const card = findHandCard(currentState, cardId);
  if (!card) throw new Error("Card is not in the active player's hand");
  const sourceId = selection.sourceId;
  const targetId = selection.targetId;
  const firstTarget = card.type === "redeploy" ? sourceId : targetId;
  if (!getLegalCardTargets(currentState, cardId).includes(firstTarget)) throw new Error("Illegal card target");
  if (card.type === "redeploy" && !getLegalCardTargets(currentState, cardId, { sourceId }).includes(targetId)) {
    throw new Error("Illegal redeployment target");
  }

  const state = clone(currentState);
  const rng = new SeededRandom(state.rngState);
  const result = { cardType: card.type, sourceId, targetId, affectedRegionIds: [] };
  if (card.type === "supplyDrop") {
    const target = state.map.regions[targetId];
    while (target.units.length < UNIT_CAP && result.affectedRegionIds.length < 2) {
      target.units.push(randomUnitForRegion(target, rng));
      result.affectedRegionIds.push(targetId);
    }
  } else if (card.type === "supplyConvoy") {
    const target = state.map.regions[targetId];
    while (target.units.length < UNIT_CAP && result.affectedRegionIds.length < 3) {
      target.units.push(randomUnitForRegion(target, rng));
      result.affectedRegionIds.push(targetId);
    }
  } else if (card.type === "interdiction") {
    const target = state.map.regions[targetId];
    state.cards.effects.push({
      type: card.type,
      playerId: getActivePlayer(state).id,
      regionId: targetId,
      targetOwnerId: target.ownerId,
      cardId: card.id,
      untilRound: state.turn.round + 1,
    });
    result.affectedRegionIds.push(targetId);
  } else if (card.type === "redeploy") {
    const source = state.map.regions[sourceId];
    const target = state.map.regions[targetId];
    const { garrison, remaining } = selectGarrison(source.units);
    const priority = { armor: 0, artillery: 1, infantry: 2 };
    const ordered = remaining.map((type, index) => ({ type, index }))
      .sort((first, second) => priority[first.type] - priority[second.type] || first.index - second.index);
    const moving = ordered.slice(0, Math.min(2, UNIT_CAP - target.units.length));
    const movingIndexes = new Set(moving.map((unit) => unit.index));
    source.units = [garrison, ...remaining.filter((_, index) => !movingIndexes.has(index))];
    target.units.push(...moving.map((unit) => unit.type));
    result.moved = moving.length;
    result.affectedRegionIds.push(sourceId, targetId);
  } else if (["fireSupport", "fortification", "luckyRoll"].includes(card.type)) {
    addEffect(state, card.type, targetId, card.id);
    result.affectedRegionIds.push(targetId);
  } else if (card.type === "mobilization") {
    const target = state.map.regions[targetId];
    const neighbors = target.neighbors
      .map((id) => state.map.regions[id])
      .filter((region) => region.ownerId === target.ownerId && region.units.length < UNIT_CAP)
      .sort((first, second) => first.units.length - second.units.length || first.id - second.id)
      .slice(0, 3);
    for (const region of [target, ...neighbors]) {
      if (region.units.length >= UNIT_CAP) continue;
      region.units.push(randomUnitForRegion(region, rng));
      result.affectedRegionIds.push(region.id);
    }
  }
  state.rngState = rng.state;
  removeCardFromHand(state, cardId);
  state.log.unshift({
    type: "cardPlayed",
    playerId: getActivePlayer(state).id,
    cardType: card.type,
    sourceId,
    targetId,
    affectedRegionIds: result.affectedRegionIds,
    round: state.turn.round,
  });
  state.log = state.log.slice(0, 200);
  return { state, result };
}

const STANCE_PRIMARY_UNIT = Object.freeze({
  security: "infantry",
  breakthrough: "armor",
  barrage: "artillery",
  engineering: "pioneers",
  supplySurge: "supply",
  recon: "snipers",
});

function hasStanceUnit(units, stance) {
  return Boolean(stance && STANCE_PRIMARY_UNIT[stance] && units.includes(STANCE_PRIMARY_UNIT[stance]));
}

function riverBetween(state, firstId, secondId) {
  return (state.map.rivers ?? []).some(([first, second]) => (
    (first === firstId && second === secondId) || (first === secondId && second === firstId)
  ));
}

export function getAvailableStances(state, sourceId, targetId = null) {
  const source = state.map.regions[sourceId];
  if (!source) return [];
  return Object.entries(STANCE_PRIMARY_UNIT)
    .filter(([, unit]) => source.units.includes(unit))
    .filter(([stance]) => !(stance === "supplySurge" && state.turn.supplyBoostUsed))
    .map(([stance]) => stance);
}

export function getStanceClassBalance(state, sourceId, stance) {
  const source = state.map.regions[sourceId];
  const primaryUnit = STANCE_PRIMARY_UNIT[stance];
  if (!source || !primaryUnit || !source.units.includes(primaryUnit)) return null;
  const matchingDice = source.units.filter((type) => type === primaryUnit).length;
  const otherDice = source.units.length - matchingDice;
  const primaryBonus = matchingDice;
  const otherPenalty = -otherDice;
  return {
    primaryUnit,
    matchingDice,
    otherDice,
    primaryBonus,
    otherPenalty,
    netBonus: primaryBonus + otherPenalty,
  };
}

export function getRecommendedStance(state, sourceId, targetId) {
  const stanceChoices = [null, ...getAvailableStances(state, sourceId, targetId)];
  let recommended = null;
  let bestOdds = computeBattleOdds(state, sourceId, targetId, null);
  for (const stance of stanceChoices.slice(1)) {
    const odds = computeBattleOdds(state, sourceId, targetId, stance);
    if (odds > bestOdds + 1e-12) {
      recommended = stance;
      bestOdds = odds;
    }
  }
  return recommended;
}

function stanceIsLegal(state, sourceId, stance) {
  return stance === null || stance === undefined || getAvailableStances(state, sourceId).includes(stance);
}

function dieModifiers(units, terrain, role, stance = null) {
  let supportedArtillery = 0;
  const primary = STANCE_PRIMARY_UNIT[stance];
  return units.map((type) => {
    let modifier = 0;
    if (type === "infantry" && role === "defender" && ["forest", "city", "swamp"].includes(terrain)) modifier += 1;
    if (type === "armor" && role === "attacker" && terrain === "plains") modifier += 1;
    if (type === "artillery" && role === "attacker" && supportedArtillery < 2) {
      supportedArtillery += 1;
      modifier += 1;
    }
    if (role === "attacker" && primary) modifier += type === primary ? 1 : -1;
    return modifier;
  });
}

export function getBattleModifierSummary(state, sourceId, targetId, stance = null) {
  const source = state.map.regions[sourceId];
  const target = state.map.regions[targetId];
  if (!source || !target) return null;
  const legalStance = stanceIsLegal(state, sourceId, stance) ? stance : null;
  const attackerTerrainBonus = dieModifiers(source.units, target.terrain, "attacker")
    .reduce((sum, modifier) => sum + modifier, 0);
  const defenderTerrainBonus = dieModifiers(target.units, target.terrain, "defender")
    .reduce((sum, modifier) => sum + modifier, 0);
  const attackerCardBonus = (state.cards?.effects ?? []).filter((effect) => (
    effect.type === "fireSupport" && effect.playerId === source.ownerId && effect.regionId === sourceId
  )).length * 3;
  const defenderCardBonus = (state.cards?.effects ?? []).filter((effect) => (
    effect.type === "fortification" && effect.playerId === target.ownerId && effect.regionId === targetId
  )).length * 3;
  const attackerPlayer = state.players.find((player) => player.id === source.ownerId);
  const reconSupplyIntel = hasSkill(attackerPlayer, "recon") && !isRegionSupplied(state, targetId, target.ownerId) ? -1 : 0;
  const stanceClassBalance = legalStance ? getStanceClassBalance(state, sourceId, legalStance) : null;
  const attackerStancePenalty = stanceClassBalance?.otherPenalty ?? 0;
  const attackerStancePrimaryBonus = stanceClassBalance?.primaryBonus ?? 0;
  const riverPenalty = riverBetween(state, sourceId, targetId) ? 1 : 0;
  const swampPenalty = target.terrain === "swamp" ? 1 : 0;
  const coastalPenalty = target.isCoastal ? 1 : 0;
  const engineering = legalStance === "engineering" && hasStanceUnit(source.units, legalStance);
  const recon = legalStance === "recon" && hasStanceUnit(source.units, legalStance);
  const breakthroughBonus = legalStance === "breakthrough" && target.terrain === "plains" ? 1 : 0;
  const barrageBonus = legalStance === "barrage" ? 1 : 0;
  const neutralizedTerrainPenalty = (engineering ? riverPenalty + swampPenalty : 0)
    + (recon ? coastalPenalty : 0);
  const attackerEnvironmentPenalty = riverPenalty + swampPenalty + coastalPenalty - neutralizedTerrainPenalty;
  const engineeringDefenseReduction = engineering ? 1 : 0;
  const attackerBonus = attackerTerrainBonus + attackerCardBonus + attackerStancePrimaryBonus + attackerStancePenalty
    + breakthroughBonus - attackerEnvironmentPenalty;
  const defenderBonus = Math.max(0, defenderTerrainBonus - engineeringDefenseReduction)
    + defenderCardBonus + reconSupplyIntel - barrageBonus;
  return {
    attackerBonus,
    defenderBonus,
    netBonus: attackerBonus - defenderBonus,
    attackerTerrainBonus,
    defenderTerrainBonus,
    attackerCardBonus,
    defenderCardBonus,
    reconSupplyIntel,
    stance: legalStance,
    attackerStancePenalty,
    attackerStancePrimaryBonus,
    breakthroughBonus,
    barrageBonus,
    engineeringDefenseReduction,
    riverPenalty,
    swampPenalty,
    coastalPenalty,
    neutralizedTerrainPenalty,
    attackerEnvironmentPenalty,
  };
}

function rollArmy(units, terrain, role, rng, forcedRolls, rerollPasses = 0, forcedRerolls = [], stance = null) {
  const modifiers = dieModifiers(units, terrain, role, stance);
  const dice = units.map((type, index) => {
    const base = forcedRolls?.[index] ?? rng.int(1, 6);
    if (!Number.isInteger(base) || base < 1 || base > 6) throw new RangeError("Forced rolls must be W6 results");
    return { type, base, modifier: modifiers[index], total: base + modifiers[index], rerolls: 0 };
  });
  for (let pass = 0; pass < rerollPasses; pass += 1) {
    dice.forEach((die, index) => {
      if (die.base > 2) return;
      const base = forcedRerolls?.[pass]?.[index] ?? rng.int(1, 6);
      if (!Number.isInteger(base) || base < 1 || base > 6) throw new RangeError("Forced rerolls must be W6 results");
      die.base = base;
      die.total = base + die.modifier;
      die.rerolls += 1;
    });
  }
  return dice;
}

function selectGarrison(units) {
  const priority = { infantry: 0, artillery: 1, armor: 2 };
  let selectedIndex = 0;
  units.forEach((type, index) => {
    if (priority[type] < priority[units[selectedIndex]]) selectedIndex = index;
  });
  return {
    garrison: units[selectedIndex],
    remaining: units.filter((_, index) => index !== selectedIndex),
  };
}

function selectRandomGarrison(units, rng, count = 1) {
  const indexes = rng.shuffle(units.map((_, index) => index)).slice(0, Math.min(count, units.length - 1));
  const selected = new Set(indexes);
  return {
    garrison: indexes.map((index) => units[index]),
    remaining: units.filter((_, index) => !selected.has(index)),
  };
}

function eliminatePlayer(state, defeatedId, victorId) {
  const defeated = state.players.find((player) => player.id === defeatedId);
  if (!defeated?.active) return 0;
  defeated.active = false;
  if (state.cards) {
    state.cards.discardPile.push(...defeated.hand);
    defeated.hand = [];
    state.cards.effects = state.cards.effects.filter((effect) => effect.playerId !== defeatedId);
  }
  let transferred = 0;
  for (const region of state.map.regions) {
    if (region.ownerId === defeatedId) {
      region.ownerId = victorId;
      transferred += 1;
    }
  }
  state.log.unshift({ type: "playerEliminated", playerId: defeatedId, victorId, transferred });
  return transferred;
}

function retirePlayerCards(state, player) {
  if (!state.cards || !player.hand?.length && !state.cards.effects.some((effect) => effect.playerId === player.id)) return;
  state.cards.discardPile.push(...(player.hand ?? []));
  player.hand = [];
  state.cards.effects = state.cards.effects.filter((effect) => effect.playerId !== player.id);
}

function updateEliminationsAndVictory(state) {
  for (const player of state.players) {
    if (player.active && !state.map.regions.some((region) => region.ownerId === player.id)) {
      player.active = false;
      retirePlayerCards(state, player);
      state.log.unshift({ type: "playerEliminated", playerId: player.id, victorId: null, transferred: 0 });
    }
  }
  const active = state.players.filter((player) => player.active);
  if (active.length === 1) {
    state.phase = "finished";
    state.winnerId = active[0].id;
    state.log.unshift({ type: "gameWon", playerId: active[0].id, round: state.turn.round });
  }
}

export function resolveAttack(currentState, sourceId, targetId, options = {}) {
  if (!getLegalTargets(currentState, sourceId).includes(targetId)) {
    throw new Error("Illegal attack");
  }
  const stance = options.stance ?? null;
  if (!stanceIsLegal(currentState, sourceId, stance)) throw new Error("Illegal attack stance");
  if (stance === "supplySurge" && currentState.turn.supplyBoostUsed) throw new Error("Supply stance already used this turn");
  const recommendedStance = getRecommendedStance(currentState, sourceId, targetId);
  const recommendedOdds = computeBattleOdds(currentState, sourceId, targetId, recommendedStance);
  const selectedOdds = computeBattleOdds(currentState, sourceId, targetId, stance);
  const state = clone(currentState);
  const source = state.map.regions[sourceId];
  const target = state.map.regions[targetId];
  const attackerId = source.ownerId;
  const defenderId = target.ownerId;
  const rng = new SeededRandom(state.rngState);
  const modifiers = getBattleModifierSummary(state, sourceId, targetId, stance);
  const attackerEffects = state.cards?.effects.filter((effect) => (
    effect.playerId === attackerId && effect.regionId === sourceId
    && ["fireSupport", "luckyRoll"].includes(effect.type)
  )) ?? [];
  const defenderEffects = state.cards?.effects.filter((effect) => (
    effect.playerId === defenderId && effect.regionId === targetId && effect.type === "fortification"
  )) ?? [];
  const fireSupport = attackerEffects.filter((effect) => effect.type === "fireSupport").length;
  const luckyRerolls = attackerEffects.filter((effect) => effect.type === "luckyRoll").length;
  const attackerDice = rollArmy(
    source.units,
    target.terrain,
    "attacker",
    rng,
    options.attackerRolls,
    luckyRerolls,
    options.attackerRerolls,
    stance,
  );
  const defenderPlayer = state.players.find((player) => player.id === defenderId);
  const defenderSupplyPenalty = !isRegionSupplied(state, targetId, defenderId)
    && !hasSkill(defenderPlayer, "fortressDoctrine") && target.units.length > 1 ? 1 : 0;
  const defenderSupplyBefore = getSupplyNetwork(state, defenderId).size;
  const defenderRollUnits = defenderSupplyPenalty && target.units.length > 1
    ? target.units.slice(0, -1) : target.units;
  const defenderDice = rollArmy(defenderRollUnits, target.terrain, "defender", rng, options.defenderRolls);
  const attackerCardBonus = fireSupport * 3;
  const defenderCardBonus = defenderEffects.length * 3;
  const attackerTotal = attackerDice.reduce((sum, die) => sum + die.total, 0)
    + attackerCardBonus + modifiers.breakthroughBonus - modifiers.attackerEnvironmentPenalty;
  const defenderTotal = defenderDice.reduce((sum, die) => sum + die.total, 0)
    + defenderCardBonus + (hasSkill(state.players.find((player) => player.id === attackerId), "recon")
      && !isRegionSupplied(state, targetId, defenderId) ? -1 : 0)
    - modifiers.engineeringDefenseReduction - modifiers.barrageBonus;
  const attackerWon = attackerTotal > defenderTotal;
  const garrisonResult = attackerWon
    ? selectRandomGarrison(source.units, rng, stance === "security" ? 2 : 1)
    : selectGarrison(source.units);
  const garrison = Array.isArray(garrisonResult.garrison) ? garrisonResult.garrison : [garrisonResult.garrison];
  const { remaining } = garrisonResult;

  if (state.cards) {
    const consumed = new Set([...attackerEffects, ...defenderEffects].map((effect) => effect.cardId));
    state.cards.effects = state.cards.effects.filter((effect) => !consumed.has(effect.cardId));
  }

  source.units = garrison;
  if (attackerWon) {
    const capturedHeadquarters = target.isHeadquarters;
    target.ownerId = attackerId;
    target.units = remaining;
    if (capturedHeadquarters) {
      target.isHeadquarters = false;
      const defeated = state.players.find((player) => player.id === defenderId);
      if (defeated?.headquartersRegionId === targetId) defeated.headquartersRegionId = null;
    }
    if (currentState.config.victoryMode === "headquarters" && capturedHeadquarters) {
      eliminatePlayer(state, defenderId, attackerId);
    }
  }
  if (stance === "supplySurge") {
    state.turn.supplyBoostUsed = true;
    state.turn.supplyBoostPlayerId = attackerId;
  }
  const tacticalLoot = attackerWon
    && currentState.config.cardsEnabled
    && stance !== recommendedStance
    && selectedOdds < recommendedOdds - 1e-12
    && state.players.find((player) => player.id === attackerId).hand.length < CARD_HAND_LIMIT
    ? drawCard(state, attackerId, rng)
    : null;
  const defenderSupplyBroken = attackerWon && getSupplyNetwork(state, defenderId).size < defenderSupplyBefore;
  state.rngState = rng.state;
  const battle = {
    sourceId,
    targetId,
    attackerId,
    defenderId,
    attackerDice,
    defenderDice,
    attackerTotal,
    defenderTotal,
    attackerCardBonus,
    defenderCardBonus,
    stance,
    recommendedStance,
    tacticalLootCardType: tacticalLoot?.type ?? null,
    stancePenalty: modifiers.attackerStancePenalty,
    riverPenalty: modifiers.riverPenalty,
    swampPenalty: modifiers.swampPenalty,
    coastalPenalty: modifiers.coastalPenalty,
    neutralizedTerrainPenalty: modifiers.neutralizedTerrainPenalty,
    breakthroughBonus: modifiers.breakthroughBonus,
    barrageBonus: modifiers.barrageBonus,
    engineeringDefenseReduction: modifiers.engineeringDefenseReduction,
    defenderSupplyPenalty,
    defenderSupplyBroken,
    luckyRerolls,
    appliedCards: [...attackerEffects, ...defenderEffects].map((effect) => effect.type),
    attackerWon,
  };
  state.log.unshift({ type: "battle", round: state.turn.round, ...battle });
  if (tacticalLoot) {
    state.log.unshift({
      type: "tacticalLoot",
      playerId: attackerId,
      cardType: tacticalLoot.type,
      sourceId,
      targetId,
      round: state.turn.round,
    });
  }
  state.log = state.log.slice(0, 200);
  updateEliminationsAndVictory(state);
  return { state, battle };
}

function connectedRegionCount(state, ownerId) {
  const owned = state.map.regions.filter((region) => region.ownerId === ownerId);
  const unvisited = new Set(owned.map((region) => region.id));
  let largest = 0;
  while (unvisited.size) {
    const first = unvisited.values().next().value;
    unvisited.delete(first);
    const queue = [first];
    let count = 0;
    while (queue.length) {
      const id = queue.shift();
      count += 1;
      for (const neighbor of state.map.regions[id].neighbors) {
        if (unvisited.has(neighbor) && state.map.regions[neighbor].ownerId === ownerId) {
          unvisited.delete(neighbor);
          queue.push(neighbor);
        }
      }
    }
    largest = Math.max(largest, count);
  }
  return largest;
}

export function getSupplyNetwork(state, ownerId) {
  const depots = state.map.regions
    .filter((region) => region.ownerId === ownerId && (
      region.isHeadquarters || region.terrain === "city"
    ))
    .map((region) => region.id);
  const interdicted = new Set((state.cards?.effects ?? [])
    .filter((effect) => effect.type === "interdiction" && effect.targetOwnerId === ownerId
      && effect.untilRound >= state.turn.round)
    .map((effect) => effect.regionId));
  const supplied = new Set();
  const queue = depots.filter((id) => !interdicted.has(id));
  queue.forEach((id) => supplied.add(id));
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const region = state.map.regions[queue[cursor]];
    for (const neighborId of region.neighbors) {
      if (supplied.has(neighborId) || interdicted.has(neighborId)) continue;
      if (state.map.regions[neighborId]?.ownerId !== ownerId) continue;
      supplied.add(neighborId);
      queue.push(neighborId);
    }
  }
  return supplied;
}

export function isRegionSupplied(state, regionId, ownerId = state.map.regions[regionId]?.ownerId) {
  return Boolean(ownerId !== undefined && ownerId !== null && getSupplyNetwork(state, ownerId).has(regionId));
}

function hasSkill(player, skill) {
  return Boolean(player?.skills?.includes(skill));
}

export function calculateReinforcements(state, playerId) {
  const owned = state.map.regions.filter((region) => region.ownerId === playerId);
  if (!owned.length) return 0;
  const largestGroup = connectedRegionCount(state, playerId);
  const supplied = getSupplyNetwork(state, playerId);
  const suppliedCount = supplied.size;
  const cities = owned.filter((region) => region.terrain === "city" && supplied.has(region.id)).length;
  const baseSupply = Math.max(1, Math.floor((largestGroup + suppliedCount) / 6)) + cities;
  const multiplier = SUPPLY_RATES[state.config.supplyRate] ?? SUPPLY_RATES.low;
  const supplyBoost = state.turn.supplyBoostUsed && state.turn.supplyBoostPlayerId === playerId ? 1 : 0;
  return Math.ceil(baseSupply * multiplier) + supplyBoost;
}

function distributeReinforcements(state, playerId, rng) {
  const requested = calculateReinforcements(state, playerId);
  const player = state.players.find((entry) => entry.id === playerId);
  let placed = 0;
  for (let index = 0; index < requested; index += 1) {
    const ownedEligible = state.map.regions.filter(
      (region) => region.ownerId === playerId && region.units.length < UNIT_CAP,
    );
    const supplied = getSupplyNetwork(state, playerId);
    const suppliedEligible = ownedEligible.filter((region) => supplied.has(region.id));
    const mayUseAnyRegion = hasSkill(player, "quartermaster") && index % 3 === 0;
    const eligible = mayUseAnyRegion || !suppliedEligible.length ? ownedEligible : suppliedEligible;
    if (!eligible.length) break;
    const region = rng.pick(eligible);
    region.units.push(randomUnitForRegion(region, rng));
    placed += 1;
  }
  return { requested, placed };
}

export function endTurn(currentState) {
  if (currentState.phase !== "playing") return currentState;
  if (requiresCardDiscard(currentState)) throw new Error("Discard a card before ending the turn");
  const state = clone(currentState);
  const player = getActivePlayer(state);
  const rng = new SeededRandom(state.rngState);
  const reinforcement = distributeReinforcements(state, player.id, rng);
  state.rngState = rng.state;
  state.log.unshift({
    type: "reinforcements",
    playerId: player.id,
    amount: reinforcement.placed,
    requested: reinforcement.requested,
    round: state.turn.round,
  });

  if (state.cards) {
    state.cards.effects = state.cards.effects.filter((effect) => !(
      effect.playerId === player.id && ["fireSupport", "luckyRoll"].includes(effect.type)
    ));
  }

  const previousIndex = state.turn.activePlayerIndex;
  let nextIndex = previousIndex;
  for (let offset = 1; offset <= state.players.length; offset += 1) {
    const candidate = (previousIndex + offset) % state.players.length;
    if (state.players[candidate].active) {
      nextIndex = candidate;
      break;
    }
  }
  state.turn.activePlayerIndex = nextIndex;
  state.turn.supplyBoostUsed = false;
  state.turn.supplyBoostPlayerId = null;
  if (nextIndex <= previousIndex) state.turn.round += 1;
  if (state.cards) {
    state.cards.effects = state.cards.effects.filter((effect) => (
      effect.type !== "interdiction" || effect.untilRound >= state.turn.round
    ));
    const nextPlayerId = state.players[nextIndex].id;
    state.cards.effects = state.cards.effects.filter((effect) => !(
      effect.playerId === nextPlayerId && effect.type === "fortification"
    ));
    const drawn = drawCard(state, nextPlayerId, rng);
    if (drawn) state.log.unshift({
      type: "cardDrawn",
      playerId: nextPlayerId,
      cardType: drawn.type,
      round: state.turn.round,
    });
  }
  state.rngState = rng.state;
  state.log.unshift({ type: "turnStarted", playerId: state.players[nextIndex].id, round: state.turn.round });
  state.log = state.log.slice(0, 200);
  return state;
}

function sumDistribution(modifiers) {
  let distribution = new Map([[0, 1]]);
  for (const modifier of modifiers) {
    const next = new Map();
    for (const [sum, count] of distribution) {
      for (let face = 1; face <= 6; face += 1) {
        const value = sum + face + modifier;
        next.set(value, (next.get(value) ?? 0) + count);
      }
    }
    distribution = next;
  }
  return distribution;
}

export function computeBattleOdds(state, sourceId, targetId, stance = null) {
  const source = state.map.regions[sourceId];
  const target = state.map.regions[targetId];
  if (!source || !target) return 0;
  const summary = getBattleModifierSummary(state, sourceId, targetId, stance);
  const luckyRerolls = (state.cards?.effects ?? []).filter((effect) => (
    effect.type === "luckyRoll" && effect.playerId === source.ownerId && effect.regionId === sourceId
  )).length;
  const dieDistribution = (modifiers, passes) => {
    if (!passes) return sumDistribution(modifiers);
    let distribution = new Map([[0, 1]]);
    for (const modifier of modifiers) {
      const faces = new Map();
      const expand = (face, pass) => {
        if (face <= 2 && pass < passes) {
          for (let next = 1; next <= 6; next += 1) expand(next, pass + 1);
          return;
        }
        const weight = 6 ** (passes - pass);
        faces.set(face + modifier, (faces.get(face + modifier) ?? 0) + weight);
      };
      for (let face = 1; face <= 6; face += 1) expand(face, 0);
      const next = new Map();
      for (const [sum, count] of distribution) {
        for (const [value, faceCount] of faces) next.set(sum + value, (next.get(sum + value) ?? 0) + count * faceCount);
      }
      distribution = next;
    }
    return distribution;
  };
  const attacker = dieDistribution(dieModifiers(source.units, target.terrain, "attacker", summary.stance), luckyRerolls);
  const defenderPlayer = state.players.find((player) => player.id === target.ownerId);
  const defenderUnits = !isRegionSupplied(state, targetId, target.ownerId)
    && !hasSkill(defenderPlayer, "fortressDoctrine") && target.units.length > 1
    ? target.units.slice(0, -1) : target.units;
  const defender = sumDistribution(dieModifiers(defenderUnits, target.terrain, "defender"));
  let wins = 0;
  let outcomes = 0;
  for (const [attackerSum, attackerCount] of attacker) {
    for (const [defenderSum, defenderCount] of defender) {
      const combinations = attackerCount * defenderCount;
      outcomes += combinations;
      const attackerTotal = attackerSum + summary.attackerCardBonus + summary.breakthroughBonus - summary.attackerEnvironmentPenalty;
      const defenderTotal = defenderSum + summary.defenderCardBonus + summary.reconSupplyIntel
        - summary.engineeringDefenseReduction - summary.barrageBonus;
      if (attackerTotal > defenderTotal) wins += combinations;
    }
  }
  return outcomes ? wins / outcomes : 0;
}

export function serializeGame(state) {
  return JSON.stringify(state);
}

export function validateGameState(state) {
  if (!state || state.schemaVersion !== SCHEMA_VERSION || !state.config || !state.map) return false;
  if (!Array.isArray(state.players) || !Array.isArray(state.map.regions)) return false;
  if (state.players.length < 2 || state.players.length > 6) return false;
  if (!Number.isInteger(state.turn?.activePlayerIndex)) return false;
  if (!state.players[state.turn.activePlayerIndex]) return false;
  if (state.config.supplyRate !== undefined && !Object.hasOwn(SUPPLY_RATES, state.config.supplyRate)) return false;
  if (!Object.hasOwn(RIVER_DENSITIES, state.config.riverDensity)) return false;
  if (typeof state.turn.supplyBoostUsed !== "boolean") return false;
  if (state.turn.supplyBoostPlayerId !== null && !Number.isInteger(state.turn.supplyBoostPlayerId)) return false;
  if (typeof state.config.cardsEnabled !== "boolean") return false;
  if (!Array.isArray(state.config.cardPool) || !state.config.cardPool.every((type) => CARD_TYPES.includes(type))) return false;
  if (!Array.isArray(state.config.skillPool) || !state.config.skillPool.every((type) => SKILL_TYPES.includes(type))) return false;
  if (!Number.isInteger(state.config.skillSlots) || state.config.skillSlots < 2 || state.config.skillSlots > 3) return false;
  if (!state.cards || !Array.isArray(state.cards.drawPile) || !Array.isArray(state.cards.discardPile) || !Array.isArray(state.cards.effects)) return false;
  if (!state.players.every((player, index) => (
    Array.isArray(player.hand)
    && Array.isArray(player.skills)
    && player.skills.every((skill) => SKILL_TYPES.includes(skill))
    && player.hand.length <= CARD_HAND_LIMIT + (index === state.turn.activePlayerIndex ? 1 : 0)
    && (player.commanderName === undefined || (
      typeof player.commanderName === "string" && player.commanderName.length >= 1 && player.commanderName.length <= 80
    ))
  ))) return false;
  const cardContainers = [
    ...state.cards.drawPile,
    ...state.cards.discardPile,
    ...state.players.flatMap((player) => player.hand),
  ];
  if (!cardContainers.every((card) => (
    card && typeof card.id === "string" && CARD_TYPES.includes(card.type)
  ))) return false;
  if (new Set(cardContainers.map((card) => card.id)).size !== cardContainers.length) return false;
  if (state.config.cardsEnabled && cardContainers.length !== state.config.cardPool
    .reduce((sum, type) => sum + CARD_DECK_COUNTS[type], 0)) return false;
  if (!state.config.cardsEnabled && cardContainers.length !== 0) return false;
  if (!state.cards.effects.every((effect) => (
    ["fireSupport", "fortification", "luckyRoll", "interdiction"].includes(effect.type)
    && typeof effect.cardId === "string"
    && state.players.some((player) => player.id === effect.playerId)
    && state.map.regions.some((region) => region.id === effect.regionId)
  ))) return false;
  if (!Array.isArray(state.map.rivers) || !state.map.rivers.every(([first, second]) => (
    Number.isInteger(first) && Number.isInteger(second)
    && first >= 0 && second >= 0 && first < state.map.regions.length && second < state.map.regions.length
    && first !== second
  ))) return false;
  if (new Set(state.map.rivers.map(([first, second]) => `${Math.min(first, second)}:${Math.max(first, second)}`)).size !== state.map.rivers.length) return false;
  if (!Array.isArray(state.map.riverPaths) || !state.map.riverPaths.every((path) => (
    Array.isArray(path) && path.length >= 3
    && path.every((id) => Number.isInteger(id) && id >= 0 && id < state.map.regions.length)
    && path.at(-1) !== undefined && state.map.regions[path.at(-1)].isCoastal
    && path.slice(1).every((id, index) => {
      const first = path[index];
      const edge = `${Math.min(first, id)}:${Math.max(first, id)}`;
      return state.map.rivers.some(([a, b]) => `${Math.min(a, b)}:${Math.max(a, b)}` === edge);
    })
  ))) return false;
  const samePoint = (first, second) => (
    Math.abs(first.x - second.x) < 0.02 && Math.abs(first.y - second.y) < 0.02
  );
  const knownRiverPairs = new Set(state.map.rivers.map(([first, second]) => `${Math.min(first, second)}:${Math.max(first, second)}`));
  if (!Array.isArray(state.map.riverRoutes) || !state.map.riverRoutes.every((route) => (
    Array.isArray(route) && route.length >= 5
    && route.every((segment, index) => (
      segment && Number.isFinite(segment.from?.x) && Number.isFinite(segment.from?.y)
      && Number.isFinite(segment.to?.x) && Number.isFinite(segment.to?.y)
      && Math.hypot(segment.to.x - segment.from.x, segment.to.y - segment.from.y) <= HEX_SIZE + 0.02
      && Array.isArray(segment.regions) && segment.regions.length === 2
      && Number.isInteger(segment.regions[0]) && segment.regions[0] >= 0 && segment.regions[0] < state.map.regions.length
      && Number.isInteger(segment.regions[1]) && segment.regions[1] >= 0 && segment.regions[1] < state.map.regions.length
      && knownRiverPairs.has(`${Math.min(...segment.regions)}:${Math.max(...segment.regions)}`)
      && (index === 0 || samePoint(route[index - 1].to, segment.from))
      && (index === route.length - 1 ? segment.mouth === true : segment.mouth !== true)
    ))
    && route.at(-1).regions.some((regionId) => state.map.regions[regionId].isCoastal)
  ))) return false;
  return state.map.regions.every((region, index) => (
    region.id === index
    && Array.isArray(region.neighbors)
    && Array.isArray(region.cells)
    && region.cells.length >= MIN_REGION_CELLS
    && Array.isArray(region.units)
    && region.units.length >= 1
    && region.units.length <= UNIT_CAP
    && region.units.every((unit) => UNIT_TYPES.includes(unit))
    && new Set(region.units).size <= 3
    && TERRAIN_TYPES.includes(region.terrain)
    && typeof region.isCoastal === "boolean"
    && state.players.some((player) => player.id === region.ownerId)
  ));
}

export function deserializeGame(serialized) {
  try {
    const parsed = JSON.parse(serialized);
    let state = parsed?.schemaVersion === 3 ? {
      ...parsed,
      schemaVersion: 4,
      config: {
        ...parsed.config,
        cardPool: [...BASE_CARD_POOL],
        skillPool: [],
        skillSlots: 2,
        skillLoadout: [],
      },
      players: parsed.players.map((player) => ({ ...player, skills: [] })),
    } : parsed;
    if (state?.schemaVersion === 4) {
      state = {
        ...state,
        schemaVersion: SCHEMA_VERSION,
        config: { ...state.config, riverDensity: state.config.riverDensity ?? "normal" },
        turn: {
          ...state.turn,
          supplyBoostUsed: Boolean(state.turn?.supplyBoostUsed),
          supplyBoostPlayerId: Number.isInteger(state.turn?.supplyBoostPlayerId) ? state.turn.supplyBoostPlayerId : null,
        },
        map: {
          ...state.map,
          rivers: Array.isArray(state.map.rivers) ? state.map.rivers : [],
          riverPaths: Array.isArray(state.map.riverPaths) ? state.map.riverPaths : [],
          riverRoutes: Array.isArray(state.map.riverRoutes) ? state.map.riverRoutes : [],
          regions: state.map.regions.map((region) => ({ ...region, isCoastal: Boolean(region.isCoastal) })),
        },
      };
    }
    if (state?.schemaVersion === SCHEMA_VERSION && state.map) {
      const riverRoutes = Array.isArray(state.map.riverRoutes)
        ? state.map.riverRoutes.flatMap((route) => {
          if (!Array.isArray(route) || route.at(-1)?.regions?.[1] !== null) return [route];
          const internal = route.slice(0, -1);
          if (internal.length < 5) return [];
          return [internal.map((segment, index) => ({
            ...segment,
            ...(index === internal.length - 1 ? { mouth: true } : {}),
          }))];
        })
        : [];
      state = {
        ...state,
        map: {
          ...state.map,
          riverPaths: Array.isArray(state.map.riverPaths) ? state.map.riverPaths : [],
          riverRoutes,
        },
      };
    }
    if (!validateGameState(state)) return null;
    assignCommanderNames(state.players, state.config.seed);
    return state;
  } catch {
    return null;
  }
}
