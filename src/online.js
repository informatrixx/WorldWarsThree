const RECONNECT_PREFIX = "dicefront-dominion:reconnect:";

function websocketUrl() {
  const url = new URL("./ws", window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export class OnlineClient {
  constructor({ onMessage = () => {}, onStatus = () => {} } = {}) {
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.socket = null;
    this.roomCode = null;
    this.playerId = null;
    this.revision = 0;
    this.actionCounter = 0;
  }

  connect() {
    if (typeof WebSocket === "undefined") {
      this.onStatus("unsupported");
      return Promise.reject(new Error("WebSocket is not available"));
    }
    this.onStatus("connecting");
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(websocketUrl());
      this.socket = socket;
      socket.addEventListener("open", () => { this.onStatus("connected"); resolve(); });
      socket.addEventListener("error", () => { this.onStatus("error"); reject(new Error("Multiplayer connection failed")); });
      socket.addEventListener("close", () => this.onStatus("disconnected"));
      socket.addEventListener("message", (event) => {
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message.roomCode) this.roomCode = message.roomCode;
        if (Number.isInteger(message.playerId)) this.playerId = message.playerId;
        if (message.room?.revision !== undefined) this.revision = message.room.revision;
        if (message.reconnectToken && message.roomCode) {
          try { localStorage.setItem(`${RECONNECT_PREFIX}${message.roomCode}`, message.reconnectToken); } catch { /* storage is optional */ }
        }
        this.onMessage(message);
      });
    });
  }

  send(message) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error("Not connected");
    this.socket.send(JSON.stringify(message));
  }

  createRoom(nickname, config) { this.send({ type: "create_room", nickname, config }); }

  joinRoom(roomCode, nickname) {
    let reconnectToken = null;
    try { reconnectToken = localStorage.getItem(`${RECONNECT_PREFIX}${roomCode.toUpperCase()}`); } catch { /* storage is optional */ }
    this.send({ type: "join_room", roomCode, nickname, ...(reconnectToken ? { reconnectToken } : {}) });
  }

  setReady(ready) { this.send({ type: "ready", ready }); }

  start(config) { this.send({ type: "start_game", config }); }

  action(action) {
    this.send({ type: "action", actionId: `${Date.now()}-${this.actionCounter += 1}`, revision: this.revision, action });
  }

  close() {
    this.socket?.close();
    this.socket = null;
  }
}

