import test from "node:test";
import assert from "node:assert/strict";

import { getLegalAttacks } from "../src/core/game.js";
import { RoomManager } from "../server/room-manager.js";

function inbox() {
  const messages = [];
  return { messages, send: (message) => messages.push(message) };
}

function createPlayingRoom(manager) {
  const hostInbox = inbox();
  const guestInbox = inbox();
  const created = manager.createRoom({ nickname: "Host", config: { playerCount: 2, cardsEnabled: false, mapSize: "small", seed: "server-test" }, send: hostInbox.send });
  const joined = manager.joinRoom(created.room.code, { nickname: "Guest", send: guestInbox.send });
  manager.setReady(created.room.code, joined.player.id, true);
  manager.start(created.room.code, created.player.id);
  return { room: created.room, host: created.player, guest: joined.player, hostInbox, guestInbox };
}

test("private rooms start with two humans and hide foreign hands", () => {
  const manager = new RoomManager();
  const { room, host, guest } = createPlayingRoom(manager);
  assert.equal(room.status, "playing");
  assert.equal(room.state.players[0].isHuman, true);
  assert.equal(room.state.players[1].isHuman, true);
  const hostView = manager.snapshotFor(room, host.id);
  const guestView = manager.snapshotFor(room, guest.id);
  assert.deepEqual(hostView.state.players[1].hand, []);
  assert.deepEqual(guestView.state.players[0].hand, []);
  assert.equal(hostView.state.players[0].nickname, "Host");
  assert.equal(guestView.state.players[1].nickname, "Guest");
  assert.equal(hostView.room.players.length, 2);
});

test("online room configuration preserves the host's map settings", () => {
  const manager = new RoomManager();
  const created = manager.createRoom({
    nickname: "Host",
    config: {
      playerCount: 3,
      aiFill: true,
      mapSize: "large",
      riverDensity: "many",
      supplyRate: "veryHigh",
      difficulty: "hard",
      victoryMode: "conquest",
      cardsEnabled: false,
      seed: "configured-online-map",
    },
    send: inbox().send,
  });
  const joined = manager.joinRoom(created.room.code, { nickname: "Guest", send: inbox().send });
  manager.setReady(created.room.code, joined.player.id, true);
  manager.start(created.room.code, created.player.id);

  assert.deepEqual(
    Object.fromEntries(["mapSize", "riverDensity", "supplyRate", "difficulty", "victoryMode", "cardsEnabled", "seed"].map((key) => [key, created.room.state.config[key]])),
    { mapSize: "large", riverDensity: "many", supplyRate: "veryHigh", difficulty: "hard", victoryMode: "conquest", cardsEnabled: false, seed: "configured-online-map" },
  );
});

test("the host can reseed an untouched online map without leaving the room", () => {
  const manager = new RoomManager();
  const { room, host, guest } = createPlayingRoom(manager);
  const code = room.code;
  const previousSeed = room.state.config.seed;
  const revision = room.revision;

  manager.handleAction(code, host.id, { revision, actionId: "reseed-1", action: { type: "reseed_map" } });

  assert.equal(room.code, code);
  assert.equal(room.status, "playing");
  assert.equal(room.revision, revision + 1);
  assert.notEqual(room.state.config.seed, previousSeed);
  assert.equal(room.state.players[host.id].nickname, "Host");
  assert.equal(room.state.players[guest.id].nickname, "Guest");
  assert.throws(
    () => manager.reseed(room.code, guest.id),
    /Only the host/,
  );
});

test("AI-filled seats resolve their turns with attacks instead of only being skipped", () => {
  const manager = new RoomManager();
  const hostInbox = inbox();
  const guestInbox = inbox();
  const created = manager.createRoom({
    nickname: "Host",
    config: { playerCount: 4, aiFill: true, cardsEnabled: false, mapSize: "small", seed: "ai-filled-turns" },
    send: hostInbox.send,
  });
  const joined = manager.joinRoom(created.room.code, { nickname: "Guest", send: guestInbox.send });
  manager.setReady(created.room.code, joined.player.id, true);
  manager.start(created.room.code, created.player.id);
  manager.handleAction(created.room.code, created.player.id, {
    revision: created.room.revision, actionId: "host-end", action: { type: "end_turn" },
  });
  manager.handleAction(created.room.code, joined.player.id, {
    revision: created.room.revision, actionId: "guest-end", action: { type: "end_turn" },
  });

  const update = hostInbox.messages.at(-1);
  assert.ok(update.automatedBattles.length > 0);
  assert.equal(update.automatedBattleFrames.length, update.automatedBattles.length);
  assert.equal(update.automatedBattleFrames[0].visualRegions.length, created.room.state.map.regions.length);
  assert.ok(created.room.state.log.some((entry) => entry.type === "battle"));
});

test("server accepts only the active player's legal action and advances revision", () => {
  const manager = new RoomManager();
  const { room, host } = createPlayingRoom(manager);
  const attack = getLegalAttacks(room.state)[0];
  assert.ok(attack);
  const revision = room.revision;
  manager.handleAction(room.code, host.id, { revision, actionId: "attack-1", action: { type: "attack", ...attack } });
  assert.equal(room.revision, revision + 1);
  assert.throws(() => manager.handleAction(room.code, host.id, { revision, action: { type: "end_turn" } }), /Stale game revision/);
});

test("first timeout skips and second timeout assigns the seat to AI", () => {
  let now = 1000;
  const manager = new RoomManager({ now: () => now, turnTimeoutMs: 1000 });
  const { room } = createPlayingRoom(manager);
  now += 1000;
  manager.tick();
  assert.equal(room.players.get(0).missedTurns, 1);
  now += 1000;
  manager.tick();
  assert.equal(room.players.get(1).missedTurns, 1);
  now += 1000;
  manager.tick();
  assert.equal(room.players.get(0).aiControlled, true);
});

test("reconnect token restores a disconnected player slot", () => {
  const manager = new RoomManager();
  const { room, guest } = createPlayingRoom(manager);
  manager.disconnect(room.code, guest.id);
  const replacementInbox = inbox();
  const restored = manager.reconnect(room.code, guest.token, replacementInbox.send);
  assert.equal(restored.player.id, guest.id);
  assert.equal(room.players.get(guest.id).connected, true);
});
