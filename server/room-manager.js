import { randomBytes, randomUUID } from "node:crypto";

import { playAiTurn } from "../src/core/ai.js";
import {
  CARD_TYPES,
  createGame,
  discardCard,
  endTurn,
  getActivePlayer,
  playCard,
  resolveAttack,
  serializeGame,
  SKILL_TYPES,
  requiresCardDiscard,
} from "../src/core/game.js";

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DEFAULT_TURN_TIMEOUT_MS = 60_000;
const DEFAULT_ROOM_TTL_MS = 15 * 60_000;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeRoomCode(existing) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const bytes = randomBytes(6);
    const code = [...bytes].map((value) => ROOM_CODE_ALPHABET[value % ROOM_CODE_ALPHABET.length]).join("");
    if (!existing.has(code)) return code;
  }
  throw new Error("Unable to allocate a room code");
}

function normalizeRoomConfig(input = {}) {
  const playerCount = Math.max(2, Math.min(6, Number(input.playerCount) || 2));
  const cardPool = Array.isArray(input.cardPool) ? [...new Set(input.cardPool.filter((type) => CARD_TYPES.includes(type)))] : undefined;
  const skillPool = Array.isArray(input.skillPool) ? [...new Set(input.skillPool.filter((type) => SKILL_TYPES.includes(type)))] : undefined;
  return {
    playerCount,
    aiFill: input.aiFill !== false,
    mapSize: input.mapSize,
    riverDensity: input.riverDensity,
    supplyRate: input.supplyRate,
    difficulty: input.difficulty,
    victoryMode: input.victoryMode,
    cardsEnabled: input.cardsEnabled,
    cardPool,
    skillPool,
    skillSlots: input.skillSlots,
    skillLoadout: [],
    locale: input.locale,
    seed: input.seed,
  };
}

function forceEndTurn(state) {
  let next = state;
  while (requiresCardDiscard(next)) next = discardCard(next, getActivePlayer(next).hand[0].id);
  return endTurn(next);
}

function battleVisualState(state) {
  return state.map.regions.map((region) => ({
    ownerId: region.ownerId,
    units: region.units,
    isHeadquarters: region.isHeadquarters,
  }));
}

export function projectStateForPlayer(state, playerId) {
  const projection = clone(state);
  delete projection.rngState;
  projection.players = projection.players.map((player) => ({
    ...player,
    hand: player.id === playerId ? player.hand : [],
    reconnectOnly: undefined,
  }));
  return projection;
}

function publicRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    status: room.status,
    config: room.config,
    players: [...room.players.values()].map((player) => ({
      id: player.id,
      nickname: player.nickname,
      ready: player.ready,
      connected: player.connected,
      aiControlled: player.aiControlled,
    })),
    turnDeadline: room.turnDeadline,
    revision: room.revision,
  };
}

export class RoomManager {
  constructor({ now = () => Date.now(), roomTtlMs = DEFAULT_ROOM_TTL_MS, turnTimeoutMs = DEFAULT_TURN_TIMEOUT_MS } = {}) {
    this.now = now;
    this.roomTtlMs = roomTtlMs;
    this.turnTimeoutMs = turnTimeoutMs;
    this.rooms = new Map();
  }

  createRoom({ nickname, config = {}, send } = {}) {
    if (!nickname?.trim()) throw new Error("Nickname is required");
    const code = makeRoomCode(this.rooms);
    const token = randomUUID();
    const room = {
      code,
      hostId: 0,
      status: "lobby",
      config: normalizeRoomConfig(config),
      players: new Map([[0, {
        id: 0, nickname: nickname.trim().slice(0, 32), token, send, connected: true, ready: true, aiControlled: false, missedTurns: 0,
      }]]),
      state: null,
      revision: 0,
      turnDeadline: null,
      finishedAt: null,
    };
    this.rooms.set(code, room);
    return { room, player: room.players.get(0) };
  }

  getRoom(code) {
    return this.rooms.get(String(code || "").toUpperCase()) ?? null;
  }

  joinRoom(code, { nickname, send, token } = {}) {
    const room = this.getRoom(code);
    if (!room) throw new Error("Room not found");
    if (token) return this.reconnect(room.code, token, send);
    if (room.status !== "lobby") throw new Error("Room has already started");
    if ([...room.players.values()].filter((player) => !player.aiControlled).length >= room.config.playerCount) throw new Error("Room is full");
    if ([...room.players.values()].some((player) => player.nickname.toLowerCase() === nickname.trim().toLowerCase())) throw new Error("Nickname is already in use");
    const id = [...Array(room.config.playerCount).keys()].find((candidate) => !room.players.has(candidate));
    const player = { id, nickname: nickname.trim().slice(0, 32), token: randomUUID(), send, connected: true, ready: false, aiControlled: false, missedTurns: 0 };
    room.players.set(id, player);
    this.emitRoom(room);
    return { room, player };
  }

  reconnect(code, token, send) {
    const room = this.getRoom(code);
    const player = room && [...room.players.values()].find((entry) => entry.token === token && !entry.aiControlled);
    if (!room || !player) throw new Error("Reconnect token is invalid");
    player.send = send;
    player.connected = true;
    return { room, player };
  }

  disconnect(code, playerId) {
    const room = this.getRoom(code);
    const player = room?.players.get(playerId);
    if (!player) return;
    player.connected = false;
    player.send = null;
    this.emitRoom(room);
  }

  setReady(code, playerId, ready) {
    const room = this.requirePlayer(code, playerId);
    if (room.status !== "lobby") throw new Error("Room has already started");
    room.players.get(playerId).ready = Boolean(ready);
    this.emitRoom(room);
  }

  initializeMatchState(room) {
    room.state = createGame(room.config);
    room.players.forEach((player, id) => {
      const statePlayer = room.state.players[id];
      if (!statePlayer) return;
      statePlayer.isHuman = !player.aiControlled;
      if (!player.aiControlled) statePlayer.nickname = player.nickname;
    });
  }

  start(code, playerId, config = {}) {
    const room = this.requirePlayer(code, playerId);
    if (room.hostId !== playerId) throw new Error("Only the host can start the room");
    if (room.status !== "lobby") throw new Error("Room has already started");
    const humans = [...room.players.values()].filter((player) => !player.aiControlled);
    if (humans.length < 2) throw new Error("At least two human players are required");
    if (humans.some((player) => !player.ready)) throw new Error("All human players must be ready");
    room.config = normalizeRoomConfig({ ...room.config, ...config });
    if (!room.config.aiFill && humans.length < room.config.playerCount) throw new Error("The room is not full");
    for (let id = 0; id < room.config.playerCount; id += 1) {
      if (room.players.has(id)) continue;
      room.players.set(id, {
        id,
        nickname: `KI ${id + 1}`,
        token: null,
        send: null,
        connected: false,
        ready: true,
        aiControlled: true,
        missedTurns: 0,
      });
    }
    this.initializeMatchState(room);
    room.status = "playing";
    room.revision += 1;
    this.scheduleTurn(room);
    this.runAutomatedTurns(room);
    this.emitRoom(room);
    return room;
  }

  reseed(code, playerId, actionId = null) {
    const room = this.requirePlayer(code, playerId);
    if (room.status !== "playing" || !room.state) throw new Error("Room is not playing");
    if (room.hostId !== playerId) throw new Error("Only the host can generate a new map");
    const active = getActivePlayer(room.state);
    const untouched = room.state.turn.round === 1
      && active.id === playerId
      && active.isHuman
      && room.state.log.every((entry) => ["gameStarted", "cardDrawn"].includes(entry.type));
    if (!untouched) throw new Error("A new map can only be generated before the first action");
    let seed = randomBytes(8).toString("hex");
    if (seed === room.state.config.seed) seed = `${seed}-new`;
    room.config = { ...room.config, seed };
    this.initializeMatchState(room);
    room.revision += 1;
    this.scheduleTurn(room);
    this.runAutomatedTurns(room);
    this.emitRoom(room, { actionId, accepted: true, reseeded: true });
    return room;
  }

  handleAction(code, playerId, message) {
    const room = this.requirePlayer(code, playerId);
    if (room.status !== "playing" || !room.state) throw new Error("Room is not playing");
    if (message.revision !== room.revision) throw new Error("Stale game revision");
    const action = message.action ?? message;
    if (action.type === "reseed_map") return this.reseed(code, playerId, message.actionId);
    const active = getActivePlayer(room.state);
    if (active.id !== playerId || room.players.get(playerId).aiControlled) throw new Error("It is not your turn");
    let result;
    let battle = null;
    if (action.type === "attack") {
      result = resolveAttack(room.state, action.sourceId, action.targetId, { stance: action.stance ?? null });
      battle = result.battle;
    }
    else if (action.type === "play_card") result = playCard(room.state, action.cardId, action.selection).state;
    else if (action.type === "discard_card") result = discardCard(room.state, action.cardId);
    else if (action.type === "end_turn") result = endTurn(room.state);
    else throw new Error("Unknown action");
    room.state = result?.state ?? result;
    room.players.get(playerId).missedTurns = 0;
    room.revision += 1;
    this.scheduleTurn(room);
    const automated = this.runAutomatedTurns(room);
    this.emitRoom(room, {
      actionId: message.actionId,
      accepted: true,
      battle,
      automatedBattles: automated.battles,
      automatedBattleFrames: automated.frames,
    });
    return room;
  }

  tick() {
    const now = this.now();
    for (const room of this.rooms.values()) {
      if (room.status === "playing" && room.turnDeadline !== null && now >= room.turnDeadline) this.timeoutTurn(room);
      if (room.status === "finished" && room.finishedAt !== null && now - room.finishedAt >= this.roomTtlMs) this.rooms.delete(room.code);
    }
  }

  timeoutTurn(room) {
    const active = getActivePlayer(room.state);
    const player = room.players.get(active.id);
    player.missedTurns += 1;
    if (player.missedTurns >= 2) {
      player.aiControlled = true;
      room.state.players[active.id].isHuman = false;
    }
    room.state = forceEndTurn(room.state);
    room.revision += 1;
    this.scheduleTurn(room);
    this.runAutomatedTurns(room);
    this.emitRoom(room, { timeout: true, playerId: active.id, aiTakeover: player.aiControlled });
  }

  runAutomatedTurns(room) {
    const battles = [];
    const frames = [];
    while (room.state?.phase === "playing") {
      const active = getActivePlayer(room.state);
      const player = room.players.get(active.id);
      if (!player?.aiControlled && active.isHuman) break;
      const result = playAiTurn(room.state);
      room.state = result.state;
      battles.push(...result.battles);
      frames.push(...result.battles.map((battle, index) => ({
        battle,
        visualRegions: battleVisualState(result.battleStates[index]),
      })));
      room.revision += 1;
      if (room.state.phase === "playing") this.scheduleTurn(room);
    }
    if (room.state?.phase === "finished") {
      room.status = "finished";
      room.finishedAt = this.now();
      room.turnDeadline = null;
    }
    return { battles, frames };
  }

  scheduleTurn(room) {
    room.turnDeadline = room.state?.phase === "playing" ? this.now() + this.turnTimeoutMs : null;
  }

  requirePlayer(code, playerId) {
    const room = this.getRoom(code);
    if (!room || !room.players.has(playerId)) throw new Error("Room or player not found");
    return room;
  }

  emitRoom(room, extra = {}) {
    const message = { type: "room_state", room: publicRoom(room), ...extra };
    for (const player of room.players.values()) {
      player.send?.({ ...message, state: room.state ? projectStateForPlayer(room.state, player.id) : null });
    }
  }

  snapshotFor(room, playerId) {
    return {
      type: "room_state",
      room: publicRoom(room),
      state: room.state ? projectStateForPlayer(room.state, playerId) : null,
    };
  }

  serializedState(code) {
    const room = this.getRoom(code);
    return room?.state ? serializeGame(room.state) : null;
  }
}

export { DEFAULT_ROOM_TTL_MS, DEFAULT_TURN_TIMEOUT_MS };
