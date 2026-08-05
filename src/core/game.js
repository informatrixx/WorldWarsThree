import { generateMap, MAP_SIZES } from "./map-generator.js";
import { randomSeed, SeededRandom } from "./random.js";

export const SCHEMA_VERSION = 1;
export const UNIT_CAP = 8;
export const UNIT_TYPES = Object.freeze(["infantry", "armor", "artillery"]);
export const TERRAIN_TYPES = Object.freeze(["plains", "forest", "hills", "city"]);
export const VICTORY_MODES = Object.freeze(["conquest", "headquarters"]);
export const DIFFICULTIES = Object.freeze(["easy", "normal", "hard"]);

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
  const locale = config.locale === "en" ? "en" : "de";
  if (!Number.isInteger(playerCount) || playerCount < 2 || playerCount > 6) {
    throw new RangeError("playerCount must be an integer between 2 and 6");
  }
  if (!MAP_SIZES[mapSize]) throw new RangeError(`Unknown map size: ${mapSize}`);
  if (!DIFFICULTIES.includes(difficulty)) throw new RangeError(`Unknown difficulty: ${difficulty}`);
  if (!VICTORY_MODES.includes(victoryMode)) throw new RangeError(`Unknown victory mode: ${victoryMode}`);
  return {
    playerCount,
    mapSize,
    difficulty,
    victoryMode,
    locale,
    seed: String(config.seed || randomSeed()),
  };
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
    owned.forEach((region, index) => {
      if (index < cityCount) region.terrain = "city";
      else if (index < cityCount + forestCount) region.terrain = "forest";
      else if (index < cityCount + forestCount + hillCount) region.terrain = "hills";
      else region.terrain = "plains";
    });
  }
}

function classPool(total, rng) {
  const infantry = Math.round(total * 0.5);
  const armor = Math.round(total * 0.3);
  const artillery = total - infantry - armor;
  return rng.shuffle([
    ...Array(infantry).fill("infantry"),
    ...Array(armor).fill("armor"),
    ...Array(artillery).fill("artillery"),
  ]);
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
    const pool = classPool(budget, rng);
    owned.forEach((region) => {
      region.units.push(pool.pop());
    });
    while (pool.length) {
      const eligible = owned.filter((region) => region.units.length < caps[region.id]);
      if (!eligible.length) break;
      rng.weighted(eligible, (region) => (caps[region.id] - region.units.length) ** 2).units.push(pool.pop());
    }
    if (pool.length) throw new Error("Unable to distribute the safe unit budget");
  }
  return budget;
}

export function createGame(inputConfig = {}) {
  const config = normalizeConfig(inputConfig);
  const map = generateMap({ size: config.mapSize, seed: config.seed });
  const rng = new SeededRandom(`${config.seed}:game`);
  const players = Array.from({ length: config.playerCount }, (_, index) => ({
    id: index,
    style: PLAYER_STYLES[index],
    isHuman: index === 0,
    active: true,
    headquartersRegionId: null,
  }));
  const regionDistances = assignOwnersAndHeadquarters(map.regions, players, rng);
  assignBalancedTerrain(map.regions, players, rng);
  const startingUnitBudget = assignBalancedUnits(map.regions, players, regionDistances, rng);

  return {
    schemaVersion: SCHEMA_VERSION,
    config,
    map,
    players,
    startingUnitBudget,
    rngState: rng.state,
    turn: { round: 1, activePlayerIndex: 0 },
    phase: "playing",
    winnerId: null,
    log: [{ type: "gameStarted", round: 1, seed: config.seed }],
  };
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
  ) return [];
  return source.neighbors.filter((id) => state.map.regions[id].ownerId !== activePlayer.id);
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

function dieModifiers(units, terrain, role) {
  let supportedArtillery = 0;
  return units.map((type) => {
    if (type === "infantry" && role === "defender" && ["forest", "city"].includes(terrain)) return 1;
    if (type === "armor" && role === "attacker" && terrain === "plains") return 1;
    if (type === "artillery" && role === "attacker" && supportedArtillery < 2) {
      supportedArtillery += 1;
      return 1;
    }
    return 0;
  });
}

export function getBattleModifierSummary(state, sourceId, targetId) {
  const source = state.map.regions[sourceId];
  const target = state.map.regions[targetId];
  if (!source || !target) return null;
  const attackerBonus = dieModifiers(source.units, target.terrain, "attacker")
    .reduce((sum, modifier) => sum + modifier, 0);
  const defenderBonus = dieModifiers(target.units, target.terrain, "defender")
    .reduce((sum, modifier) => sum + modifier, 0);
  return {
    attackerBonus,
    defenderBonus,
    netBonus: attackerBonus - defenderBonus,
  };
}

function rollArmy(units, terrain, role, rng, forcedRolls) {
  const modifiers = dieModifiers(units, terrain, role);
  return units.map((type, index) => {
    const base = forcedRolls?.[index] ?? rng.int(1, 6);
    if (!Number.isInteger(base) || base < 1 || base > 6) throw new RangeError("Forced rolls must be W6 results");
    return { type, base, modifier: modifiers[index], total: base + modifiers[index] };
  });
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

function eliminatePlayer(state, defeatedId, victorId) {
  const defeated = state.players.find((player) => player.id === defeatedId);
  if (!defeated?.active) return 0;
  defeated.active = false;
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

function updateEliminationsAndVictory(state) {
  for (const player of state.players) {
    if (player.active && !state.map.regions.some((region) => region.ownerId === player.id)) {
      player.active = false;
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
  const state = clone(currentState);
  const source = state.map.regions[sourceId];
  const target = state.map.regions[targetId];
  const attackerId = source.ownerId;
  const defenderId = target.ownerId;
  const rng = new SeededRandom(state.rngState);
  const attackerDice = rollArmy(source.units, target.terrain, "attacker", rng, options.attackerRolls);
  const defenderDice = rollArmy(target.units, target.terrain, "defender", rng, options.defenderRolls);
  const attackerTotal = attackerDice.reduce((sum, die) => sum + die.total, 0);
  const defenderTotal = defenderDice.reduce((sum, die) => sum + die.total, 0);
  const attackerWon = attackerTotal > defenderTotal;
  const { garrison, remaining } = selectGarrison(source.units);

  source.units = [garrison];
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
    attackerWon,
  };
  state.log.unshift({ type: "battle", round: state.turn.round, ...battle });
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

export function calculateReinforcements(state, playerId) {
  const owned = state.map.regions.filter((region) => region.ownerId === playerId);
  if (!owned.length) return 0;
  const largestGroup = connectedRegionCount(state, playerId);
  const cities = owned.filter((region) => region.terrain === "city").length;
  return Math.max(1, Math.floor(largestGroup / 3)) + cities;
}

function distributeReinforcements(state, playerId, rng) {
  const requested = calculateReinforcements(state, playerId);
  let placed = 0;
  for (let index = 0; index < requested; index += 1) {
    const eligible = state.map.regions.filter(
      (region) => region.ownerId === playerId && region.units.length < UNIT_CAP,
    );
    if (!eligible.length) break;
    const region = rng.pick(eligible);
    const type = rng.weighted([
      { type: "infantry", weight: 0.5 },
      { type: "armor", weight: 0.3 },
      { type: "artillery", weight: 0.2 },
    ]).type;
    region.units.push(type);
    placed += 1;
  }
  return { requested, placed };
}

export function endTurn(currentState) {
  if (currentState.phase !== "playing") return currentState;
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
  if (nextIndex <= previousIndex) state.turn.round += 1;
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

export function computeBattleOdds(state, sourceId, targetId) {
  const source = state.map.regions[sourceId];
  const target = state.map.regions[targetId];
  if (!source || !target) return 0;
  const attacker = sumDistribution(dieModifiers(source.units, target.terrain, "attacker"));
  const defender = sumDistribution(dieModifiers(target.units, target.terrain, "defender"));
  let wins = 0;
  let outcomes = 0;
  for (const [attackerSum, attackerCount] of attacker) {
    for (const [defenderSum, defenderCount] of defender) {
      const combinations = attackerCount * defenderCount;
      outcomes += combinations;
      if (attackerSum > defenderSum) wins += combinations;
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
  return state.map.regions.every((region, index) => (
    region.id === index
    && Array.isArray(region.neighbors)
    && Array.isArray(region.cells)
    && Array.isArray(region.units)
    && region.units.length >= 1
    && region.units.length <= UNIT_CAP
    && region.units.every((unit) => UNIT_TYPES.includes(unit))
    && TERRAIN_TYPES.includes(region.terrain)
    && state.players.some((player) => player.id === region.ownerId)
  ));
}

export function deserializeGame(serialized) {
  try {
    const state = JSON.parse(serialized);
    return validateGameState(state) ? state : null;
  } catch {
    return null;
  }
}
