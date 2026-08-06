import http from "node:http";
import { WebSocketServer } from "ws";

import { RoomManager } from "./room-manager.js";

const port = Number(process.env.PORT || 8787);
const wsPath = process.env.WS_PATH || "/codex/WorldWarsThree/ws";
const manager = new RoomManager();
const server = http.createServer((request, response) => {
  response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ error: "WebSocket endpoint only" }));
});
const websocketServer = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

function send(socket, message) {
  if (socket.readyState === 1) socket.send(JSON.stringify(message));
}

function authenticatedContext(context) {
  if (!context.roomCode || context.playerId === null) throw new Error("Join or create a room first");
}

websocketServer.on("connection", (socket) => {
  const context = { roomCode: null, playerId: null };
  const sendToPlayer = (message) => send(socket, message);

  socket.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
      if (!message || typeof message.type !== "string") throw new Error("Invalid message");
      if (message.type === "create_room") {
        const result = manager.createRoom({ nickname: message.nickname, config: message.config, send: sendToPlayer });
        context.roomCode = result.room.code;
        context.playerId = result.player.id;
        send(socket, {
          ...manager.snapshotFor(result.room, result.player.id),
          type: "room_created",
          roomCode: result.room.code,
          playerId: result.player.id,
          reconnectToken: result.player.token,
        });
        return;
      }
      if (message.type === "join_room") {
        const result = manager.joinRoom(message.roomCode, {
          nickname: message.nickname,
          token: message.reconnectToken,
          send: sendToPlayer,
        });
        context.roomCode = result.room.code;
        context.playerId = result.player.id;
        send(socket, {
          ...manager.snapshotFor(result.room, result.player.id),
          type: "room_joined",
          roomCode: result.room.code,
          playerId: result.player.id,
          reconnectToken: result.player.token,
        });
        manager.emitRoom(result.room);
        return;
      }
      authenticatedContext(context);
      if (message.type === "ready") manager.setReady(context.roomCode, context.playerId, message.ready);
      else if (message.type === "start_game") manager.start(context.roomCode, context.playerId, message.config);
      else if (message.type === "action") manager.handleAction(context.roomCode, context.playerId, message);
      else throw new Error("Unknown message type");
    } catch (error) {
      send(socket, { type: "error", message: error instanceof Error ? error.message : "Request failed", actionId: message?.actionId ?? null });
    }
  });

  socket.on("close", () => {
    if (context.roomCode && context.playerId !== null) manager.disconnect(context.roomCode, context.playerId);
  });
});

server.on("upgrade", (request, socket, head) => {
  const requestedPath = new URL(request.url, "http://localhost").pathname;
  if (requestedPath !== wsPath) {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }
  websocketServer.handleUpgrade(request, socket, head, (client) => websocketServer.emit("connection", client, request));
});

const timer = setInterval(() => manager.tick(), 1000);
timer.unref?.();
server.listen(port, "127.0.0.1", () => {
  console.log(`Dicefront multiplayer listening on 127.0.0.1:${port}${wsPath}`);
});

export { manager, server, websocketServer };
