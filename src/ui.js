import { chooseAiAttack } from "./core/ai.js";
import {
  createGame,
  deserializeGame,
  endTurn,
  getActivePlayer,
  getLegalTargets,
  resolveAttack,
  serializeGame,
} from "./core/game.js";
import { cellKey, getHexPoints } from "./core/map-generator.js";
import { randomSeed } from "./core/random.js";
import { playerName, translate } from "./i18n.js";

const SAVE_KEY = "dicefront-dominion:save:v1";
const LOCALE_KEY = "dicefront-dominion:locale";
const HEX_DIRECTIONS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const EDGE_CORNERS = [[0, 1], [5, 0], [4, 5], [3, 4], [2, 3], [1, 2]];

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function number(value) {
  return Number(value.toFixed(2));
}

function unitCounts(units) {
  return units.reduce((counts, type) => {
    counts[type] += 1;
    return counts;
  }, { infantry: 0, armor: 0, artillery: 0 });
}

function unitAsset(type) {
  return `assets/units/${type}.png`;
}

function dominantUnit(units) {
  const counts = unitCounts(units);
  return ["armor", "artillery", "infantry"]
    .sort((first, second) => counts[second] - counts[first])[0];
}

function terrainSymbol(terrain) {
  return { plains: "◇", forest: "♠", hills: "▲", city: "▦" }[terrain] ?? "◇";
}

function regionBoundary(region, ownerByCell) {
  const segments = [];
  for (const cell of region.cells) {
    const corners = getHexPoints(cell.q, cell.r);
    HEX_DIRECTIONS.forEach(([dq, dr], index) => {
      if (ownerByCell.get(cellKey(cell.q + dq, cell.r + dr)) === region.id) return;
      const [fromIndex, toIndex] = EDGE_CORNERS[index];
      const from = corners[fromIndex];
      const to = corners[toIndex];
      segments.push(`M${number(from.x)},${number(from.y)}L${number(to.x)},${number(to.y)}`);
    });
  }
  return segments.join("");
}

export class GameApp {
  constructor(root) {
    this.root = root;
    this.locale = this.loadLocale();
    this.state = null;
    this.savedState = this.loadSavedGame();
    this.selectedSource = null;
    this.selectedTarget = null;
    this.camera = null;
    this.cameraSeed = null;
    this.aiRunning = false;
    this.aiTimer = null;
    this.toast = null;
    this.toastTimer = null;
    this.onKeyDown = this.onKeyDown.bind(this);
    window.addEventListener("keydown", this.onKeyDown);
  }

  t(key, variables) {
    return translate(this.locale, key, variables);
  }

  loadLocale() {
    try {
      return localStorage.getItem(LOCALE_KEY) === "en" ? "en" : "de";
    } catch {
      return "de";
    }
  }

  loadSavedGame() {
    try {
      return deserializeGame(localStorage.getItem(SAVE_KEY));
    } catch {
      return null;
    }
  }

  save() {
    if (!this.state) return;
    try {
      localStorage.setItem(SAVE_KEY, serializeGame(this.state));
      this.savedState = this.state;
    } catch {
      // The match remains playable if private browsing blocks storage.
    }
  }

  clearSave() {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      // Nothing else is required.
    }
    this.savedState = null;
  }

  start() {
    this.renderSetup();
  }

  setLocale(locale) {
    this.locale = locale === "en" ? "en" : "de";
    try {
      localStorage.setItem(LOCALE_KEY, this.locale);
    } catch {
      // Language still changes for the current session.
    }
    if (this.state) {
      this.state.config.locale = this.locale;
      this.save();
      this.renderGame();
    } else {
      this.renderSetup();
    }
  }

  renderLanguageSwitch() {
    return `
      <div class="language-switch" role="group" aria-label="${escapeHtml(this.t("language"))}">
        <button type="button" data-locale="de" class="${this.locale === "de" ? "active" : ""}" aria-pressed="${this.locale === "de"}">DE</button>
        <button type="button" data-locale="en" class="${this.locale === "en" ? "active" : ""}" aria-pressed="${this.locale === "en"}">EN</button>
      </div>
    `;
  }

  bindLanguageSwitches() {
    this.root.querySelectorAll("[data-locale]").forEach((button) => {
      button.addEventListener("click", () => this.setLocale(button.dataset.locale));
    });
  }

  renderSetup() {
    this.state = null;
    this.selectedSource = null;
    this.selectedTarget = null;
    this.camera = null;
    this.root.innerHTML = `
      <main class="setup-shell">
        <div class="ambient-grid" aria-hidden="true"></div>
        <header class="setup-header">
          <a class="brand" href="./" aria-label="${escapeHtml(this.t("title"))}">
            <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
            <span><strong>Dicefront</strong><small>Dominion</small></span>
          </a>
          ${this.renderLanguageSwitch()}
        </header>
        <section class="hero">
          <div class="hero-copy">
            <p class="eyebrow">PROCEDURAL TACTICAL COMMAND</p>
            <h1>${escapeHtml(this.t("title"))}</h1>
            <p class="hero-subtitle">${escapeHtml(this.t("subtitle"))}</p>
            <p class="hero-lead">${escapeHtml(this.t("setupLead"))}</p>
            <div class="feature-row" aria-hidden="true">
              <span>W6</span><span>36—90</span><span>2—6</span><span>∞ SEEDS</span>
            </div>
          </div>
          <form class="setup-card" id="setup-form">
            <div class="panel-kicker">${escapeHtml(this.t("configure"))}</div>
            ${this.savedState ? `<button class="button button-secondary continue-button" type="button" id="continue-game">${escapeHtml(this.t("continueGame"))}<span>→</span></button><div class="divider"><span>${escapeHtml(this.t("newGame"))}</span></div>` : ""}
            <label>
              <span>${escapeHtml(this.t("playerCount"))}</span>
              <select name="playerCount">
                ${[2, 3, 4, 5, 6].map((count) => `<option value="${count}" ${count === 4 ? "selected" : ""}>${count}</option>`).join("")}
              </select>
            </label>
            <label>
              <span>${escapeHtml(this.t("mapSize"))}</span>
              <select name="mapSize">
                <option value="small">${escapeHtml(this.t("small"))}</option>
                <option value="medium" selected>${escapeHtml(this.t("medium"))}</option>
                <option value="large">${escapeHtml(this.t("large"))}</option>
              </select>
            </label>
            <div class="form-grid">
              <label>
                <span>${escapeHtml(this.t("difficulty"))}</span>
                <select name="difficulty">
                  <option value="easy">${escapeHtml(this.t("easy"))}</option>
                  <option value="normal" selected>${escapeHtml(this.t("normal"))}</option>
                  <option value="hard">${escapeHtml(this.t("hard"))}</option>
                </select>
              </label>
              <label>
                <span>${escapeHtml(this.t("victoryMode"))}</span>
                <select name="victoryMode">
                  <option value="headquarters" selected>${escapeHtml(this.t("headquarters"))}</option>
                  <option value="conquest">${escapeHtml(this.t("conquest"))}</option>
                </select>
              </label>
            </div>
            <label>
              <span>${escapeHtml(this.t("seed"))}</span>
              <div class="seed-field">
                <input name="seed" id="seed-input" maxlength="80" placeholder="${escapeHtml(this.t("seedHint"))}">
                <button type="button" id="random-seed" title="${escapeHtml(this.t("randomSeed"))}" aria-label="${escapeHtml(this.t("randomSeed"))}">↻</button>
              </div>
            </label>
            <button class="button button-primary" type="submit">${escapeHtml(this.t("startGame"))}<span>→</span></button>
            <p class="save-note">● ${escapeHtml(this.t("localSave"))}</p>
          </form>
        </section>
        <footer>${escapeHtml(this.t("footer"))}</footer>
      </main>
    `;
    this.bindLanguageSwitches();
    this.root.querySelector("#random-seed").addEventListener("click", () => {
      this.root.querySelector("#seed-input").value = randomSeed();
    });
    this.root.querySelector("#continue-game")?.addEventListener("click", () => {
      this.state = this.savedState;
      this.locale = this.state.config.locale ?? this.locale;
      this.camera = null;
      this.renderGame();
    });
    this.root.querySelector("#setup-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      this.state = createGame({
        playerCount: Number(data.get("playerCount")),
        mapSize: data.get("mapSize"),
        difficulty: data.get("difficulty"),
        victoryMode: data.get("victoryMode"),
        seed: String(data.get("seed") || "").trim() || randomSeed(),
        locale: this.locale,
      });
      this.camera = null;
      this.save();
      this.renderGame();
    });
  }

  resetCamera() {
    const bounds = this.state.map.bounds;
    const paddingX = bounds.width * 0.035;
    const paddingY = bounds.height * 0.05;
    this.camera = {
      x: bounds.x - paddingX,
      y: bounds.y - paddingY,
      width: bounds.width + paddingX * 2,
      height: bounds.height + paddingY * 2,
    };
    this.cameraSeed = this.state.config.seed;
  }

  playerStats(player) {
    const regions = this.state.map.regions.filter((region) => region.ownerId === player.id);
    return {
      regions: regions.length,
      units: regions.reduce((sum, region) => sum + region.units.length, 0),
    };
  }

  renderPlayers() {
    const activeId = getActivePlayer(this.state).id;
    return this.state.players.map((player) => {
      const stats = this.playerStats(player);
      return `
        <div class="player-chip ${activeId === player.id ? "active" : ""} ${!player.active ? "inactive" : ""}" style="--player:${player.style.color};--accent:${player.style.accent}">
          <span class="player-swatch"></span>
          <span class="player-data">
            <strong>${escapeHtml(playerName(this.state, player.id, this.locale))}</strong>
            <small>${player.active ? `${this.t("territories", { count: stats.regions })} · ${this.t("armyCount", { count: stats.units })}` : this.t("eliminated")}</small>
          </span>
        </div>
      `;
    }).join("");
  }

  renderPatternDefinitions() {
    const patterns = [
      '<path d="M-2 8L8-2M2 12L12 2"/>',
      '<circle cx="3" cy="3" r="1.2"/><circle cx="9" cy="9" r="1.2"/>',
      '<path d="M6 0V12M0 6H12"/>',
      '<path d="M0 4Q3 1 6 4T12 4M0 10Q3 7 6 10T12 10"/>',
      '<path d="M0 0H12V12H0ZM6 0V12M0 6H12"/>',
      '<path d="M0 2L6 8L12 2M0 8L6 14L12 8"/>',
    ];
    return this.state.players.map((player, index) => `
      <pattern id="player-pattern-${player.id}" width="12" height="12" patternUnits="userSpaceOnUse">
        <g fill="none" stroke="${player.style.accent}" stroke-width="1.1" opacity=".5">${patterns[index]}</g>
      </pattern>
    `).join("");
  }

  renderMap() {
    const ownerByCell = new Map();
    this.state.map.regions.forEach((region) => region.cells.forEach((cell) => {
      ownerByCell.set(cellKey(cell.q, cell.r), region.id);
    }));
    const legalTargets = this.selectedSource === null ? [] : getLegalTargets(this.state, this.selectedSource);
    const regions = this.state.map.regions.map((region) => {
      const player = this.state.players[region.ownerId];
      const counts = unitCounts(region.units);
      const leadingUnit = dominantUnit(region.units);
      const points = region.cells.map((cell) => {
        const polygon = getHexPoints(cell.q, cell.r).map((point) => `${number(point.x)},${number(point.y)}`).join(" ");
        return `<polygon points="${polygon}" class="region-cell"/><polygon points="${polygon}" class="region-pattern"/>`;
      }).join("");
      const selectedClass = region.id === this.selectedSource
        ? "selected-source"
        : legalTargets.includes(region.id)
          ? "legal-target"
          : "";
      const label = this.t("ariaRegion", {
        region: this.t("region", { id: region.id + 1 }),
        owner: playerName(this.state, player.id, this.locale),
        terrain: this.t(region.terrain),
        units: this.t("units", { count: region.units.length }),
      });
      return `
        <g class="region terrain-${region.terrain} ${selectedClass}" data-region-id="${region.id}" tabindex="0" role="button"
          aria-label="${escapeHtml(label)}" style="--region-color:${player.style.color};--region-accent:${player.style.accent};--pattern:url(#player-pattern-${player.id})">
          ${points}
          <path class="region-boundary" d="${regionBoundary(region, ownerByCell)}"/>
          <g class="region-marker" transform="translate(${number(region.center.x)} ${number(region.center.y)})">
            <image class="map-unit-sprite" href="${unitAsset(leadingUnit)}" x="-26" y="-40" width="52" height="52" preserveAspectRatio="xMidYMid meet"/>
            <circle class="unit-count-badge" cx="14" cy="4" r="15"/>
            <text class="unit-total" x="14" y="9">${region.units.length}</text>
            <text class="terrain-symbol" x="-29" y="-15">${terrainSymbol(region.terrain)}</text>
            ${region.isHeadquarters ? '<path class="hq-marker" d="M23-41 31-33 23-25 15-33Z"/><text class="hq-label" x="23" y="-30">HQ</text>' : ""}
            <text class="unit-mix" y="34">●${counts.infantry} ◆${counts.armor} ▲${counts.artillery}</text>
          </g>
        </g>
      `;
    }).join("");
    const viewBox = `${number(this.camera.x)} ${number(this.camera.y)} ${number(this.camera.width)} ${number(this.camera.height)}`;
    return `
      <svg id="battle-map" viewBox="${viewBox}" aria-label="${escapeHtml(this.t("ariaMap"))}" role="application">
        <defs>${this.renderPatternDefinitions()}</defs>
        <rect class="map-background" x="${this.state.map.bounds.x - 1000}" y="${this.state.map.bounds.y - 1000}" width="${this.state.map.bounds.width + 2000}" height="${this.state.map.bounds.height + 2000}"/>
        <g class="map-regions">${regions}</g>
      </svg>
    `;
  }

  selectedRegionPanel() {
    const source = this.selectedSource === null ? null : this.state.map.regions[this.selectedSource];
    const instruction = !source
      ? this.t("selectSource")
      : !getLegalTargets(this.state, source.id).length
        ? this.t("noTargets")
        : this.t("selectTarget");
    const card = (region, label) => {
      if (!region) return "";
      const counts = unitCounts(region.units);
      const player = this.state.players[region.ownerId];
      return `
        <div class="region-summary" style="--player:${player.style.color}">
          <span class="summary-label">${escapeHtml(label)}</span>
          <div><strong>${escapeHtml(this.t("region", { id: region.id + 1 }))}</strong>${region.isHeadquarters ? `<b class="tag">${this.t("headquartersShort")}</b>` : ""}</div>
          <small>${escapeHtml(playerName(this.state, player.id, this.locale))} · ${escapeHtml(this.t(region.terrain))}</small>
          <div class="unit-breakdown">
            <span title="${escapeHtml(this.t("infantry"))}"><img src="${unitAsset("infantry")}" alt="">${counts.infantry}</span>
            <span title="${escapeHtml(this.t("armor"))}"><img src="${unitAsset("armor")}" alt="">${counts.armor}</span>
            <span title="${escapeHtml(this.t("artillery"))}"><img src="${unitAsset("artillery")}" alt="">${counts.artillery}</span>
          </div>
        </div>
      `;
    };
    return `
      <section class="side-panel selection-panel">
        <div class="panel-kicker">${escapeHtml(this.t("attack"))}</div>
        ${instruction ? `<p class="instruction">${escapeHtml(instruction)}</p>` : ""}
        <div class="selection-cards">${card(source, this.t("source"))}</div>
        ${source ? `<button class="text-button" id="cancel-selection">× ${escapeHtml(this.t("cancel"))}</button>` : ""}
      </section>
    `;
  }

  formatLog(entry) {
    if (entry.type === "gameStarted") return this.t("gameStarted", { seed: entry.seed });
    if (entry.type === "battle") {
      return this.t(entry.attackerWon ? "logBattleWon" : "logBattleLost", {
        attacker: playerName(this.state, entry.attackerId, this.locale),
        defender: playerName(this.state, entry.defenderId, this.locale),
        target: entry.targetId + 1,
        attackTotal: entry.attackerTotal,
        defenseTotal: entry.defenderTotal,
      });
    }
    if (entry.type === "reinforcements") return this.t("logReinforcements", {
      player: playerName(this.state, entry.playerId, this.locale), amount: entry.amount,
    });
    if (entry.type === "turnStarted") return this.t("logTurn", {
      player: playerName(this.state, entry.playerId, this.locale), round: entry.round,
    });
    if (entry.type === "playerEliminated") return this.t("logEliminated", {
      player: playerName(this.state, entry.playerId, this.locale),
      victor: entry.victorId === null ? "—" : playerName(this.state, entry.victorId, this.locale),
    });
    if (entry.type === "gameWon") return this.t("logWon", {
      player: playerName(this.state, entry.playerId, this.locale), round: entry.round,
    });
    return entry.type;
  }

  renderLog() {
    return `
      <section class="side-panel log-panel">
        <div class="panel-kicker">${escapeHtml(this.t("battleLog"))}</div>
        <ol>${this.state.log.slice(0, 12).map((entry, index) => `<li class="log-${entry.type} ${index === 0 ? "latest" : ""}">${escapeHtml(this.formatLog(entry))}</li>`).join("")}</ol>
      </section>
    `;
  }

  renderVictoryModal() {
    if (this.state.phase !== "finished") return "";
    const humanWon = this.state.winnerId === 0;
    return `
      <div class="modal-layer" role="dialog" aria-modal="true">
        <div class="victory-modal ${humanWon ? "won" : "lost"}">
          <div class="victory-emblem">${humanWon ? "◆" : "×"}</div>
          <p class="eyebrow">MISSION COMPLETE</p>
          <h2>${escapeHtml(this.t(humanWon ? "victory" : "defeat"))}</h2>
          <p>${escapeHtml(this.t("victoryText", { player: playerName(this.state, this.state.winnerId, this.locale) }))}</p>
          <button class="button button-primary" id="back-to-setup">${escapeHtml(this.t("backToSetup"))}</button>
        </div>
      </div>
    `;
  }

  renderGame() {
    if (!this.state) return this.renderSetup();
    if (!this.camera || this.cameraSeed !== this.state.config.seed) this.resetCamera();
    const active = getActivePlayer(this.state);
    const humanTurn = active.isHuman && this.state.phase === "playing";
    this.root.innerHTML = `
      <main class="game-shell">
        <header class="game-header">
          <a class="brand compact" href="./" id="home-link">
            <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
            <span><strong>Dicefront</strong><small>Dominion</small></span>
          </a>
          <div class="turn-status">
            <span>${escapeHtml(this.t("round", { round: this.state.turn.round }))}</span>
            <strong style="--active-player:${active.style.color}">${escapeHtml(humanTurn ? this.t("yourTurn") : this.t("aiTurn", { player: playerName(this.state, active.id, this.locale) }))}</strong>
          </div>
          <div class="header-actions">
            ${this.renderLanguageSwitch()}
            <button class="icon-button" id="new-game-button" title="${escapeHtml(this.t("newGame"))}" aria-label="${escapeHtml(this.t("newGame"))}">＋</button>
          </div>
        </header>
        <div class="players-bar">${this.renderPlayers()}</div>
        <div class="game-layout">
          <section class="map-stage">
            <div class="map-meta">
              <span>${escapeHtml(this.t("mapProfile", { profile: this.t(this.state.map.profile) }))}</span>
              <button id="copy-seed" title="${escapeHtml(this.t("copySeed"))}"># ${escapeHtml(this.state.config.seed)}</button>
            </div>
            ${this.renderMap()}
            <div class="map-controls">
              <button data-zoom="1.22" aria-label="${escapeHtml(this.t("zoomIn"))}" title="${escapeHtml(this.t("zoomIn"))}">＋</button>
              <button data-zoom="0.82" aria-label="${escapeHtml(this.t("zoomOut"))}" title="${escapeHtml(this.t("zoomOut"))}">−</button>
              <button id="fit-map" aria-label="${escapeHtml(this.t("fitMap"))}" title="${escapeHtml(this.t("fitMap"))}">⌗</button>
            </div>
          </section>
          <aside class="game-sidebar">
            ${this.selectedRegionPanel()}
            <section class="side-panel help-panel">
              <div class="panel-kicker">${escapeHtml(this.t("helpTitle"))}</div>
              <p>${escapeHtml(this.t("helpText"))}</p>
              <div class="unit-legend">
                ${["infantry", "armor", "artillery"].map((type) => `<span><img src="${unitAsset(type)}" alt="">${escapeHtml(this.t(type))}</span>`).join("")}
              </div>
            </section>
            ${this.renderLog()}
            <button class="button button-primary end-turn" id="end-turn" ${humanTurn ? "" : "disabled"}>${escapeHtml(this.t("endTurn"))}<span>→</span></button>
          </aside>
        </div>
        ${this.toast ? `<div class="toast">${escapeHtml(this.toast)}</div>` : ""}
        ${this.renderVictoryModal()}
      </main>
    `;
    this.bindGameEvents();
    if (!active.isHuman && this.state.phase === "playing" && !this.aiRunning) this.beginAiTurn();
  }

  bindGameEvents() {
    this.bindLanguageSwitches();
    this.root.querySelector("#home-link").addEventListener("click", (event) => {
      event.preventDefault();
      this.requestNewGame();
    });
    this.root.querySelector("#new-game-button").addEventListener("click", () => this.requestNewGame());
    this.root.querySelectorAll("[data-region-id]").forEach((region) => {
      const select = () => this.selectRegion(Number(region.dataset.regionId));
      region.addEventListener("click", select);
      region.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          select();
        }
      });
    });
    this.root.querySelector("#cancel-selection")?.addEventListener("click", () => {
      this.selectedSource = null;
      this.selectedTarget = null;
      this.renderGame();
    });
    this.root.querySelector("#end-turn").addEventListener("click", () => this.finishHumanTurn());
    this.root.querySelector("#back-to-setup")?.addEventListener("click", () => {
      this.clearSave();
      this.renderSetup();
    });
    this.root.querySelectorAll("[data-zoom]").forEach((button) => button.addEventListener("click", () => {
      this.zoomCamera(Number(button.dataset.zoom));
    }));
    this.root.querySelector("#fit-map").addEventListener("click", () => {
      this.resetCamera();
      this.renderGame();
    });
    this.root.querySelector("#copy-seed").addEventListener("click", () => this.copySeed());
    this.bindMapNavigation();
  }

  bindMapNavigation() {
    const svg = this.root.querySelector("#battle-map");
    svg.addEventListener("wheel", (event) => {
      event.preventDefault();
      this.zoomCamera(event.deltaY < 0 ? 1.13 : 0.885, event.clientX, event.clientY, false);
      svg.setAttribute("viewBox", `${number(this.camera.x)} ${number(this.camera.y)} ${number(this.camera.width)} ${number(this.camera.height)}`);
    }, { passive: false });

    let drag = null;
    svg.addEventListener("pointerdown", (event) => {
      if (event.target.closest(".region")) return;
      drag = { x: event.clientX, y: event.clientY, camera: { ...this.camera } };
      svg.classList.add("dragging");
      svg.setPointerCapture(event.pointerId);
    });
    svg.addEventListener("pointermove", (event) => {
      if (!drag) return;
      const scaleX = drag.camera.width / svg.clientWidth;
      const scaleY = drag.camera.height / svg.clientHeight;
      this.camera.x = drag.camera.x - (event.clientX - drag.x) * scaleX;
      this.camera.y = drag.camera.y - (event.clientY - drag.y) * scaleY;
      svg.setAttribute("viewBox", `${number(this.camera.x)} ${number(this.camera.y)} ${number(this.camera.width)} ${number(this.camera.height)}`);
    });
    const stop = () => {
      drag = null;
      svg.classList.remove("dragging");
    };
    svg.addEventListener("pointerup", stop);
    svg.addEventListener("pointercancel", stop);
  }

  zoomCamera(factor, clientX, clientY, rerender = true) {
    const old = this.camera;
    const bounded = Math.min(4, Math.max(0.28, old.width / this.state.map.bounds.width / factor));
    const targetWidth = this.state.map.bounds.width * bounded;
    const targetHeight = old.height * (targetWidth / old.width);
    let anchorX = old.x + old.width / 2;
    let anchorY = old.y + old.height / 2;
    if (clientX !== undefined) {
      const svg = this.root.querySelector("#battle-map");
      const rect = svg.getBoundingClientRect();
      anchorX = old.x + ((clientX - rect.left) / rect.width) * old.width;
      anchorY = old.y + ((clientY - rect.top) / rect.height) * old.height;
    }
    const ratio = targetWidth / old.width;
    this.camera = {
      x: anchorX - (anchorX - old.x) * ratio,
      y: anchorY - (anchorY - old.y) * ratio,
      width: targetWidth,
      height: targetHeight,
    };
    if (rerender) this.renderGame();
  }

  selectRegion(regionId) {
    if (this.state.phase !== "playing") return;
    const active = getActivePlayer(this.state);
    if (!active.isHuman) return;
    const region = this.state.map.regions[regionId];
    if (region.ownerId === active.id) {
      if (region.units.length < 2) return;
      this.selectedSource = this.selectedSource === regionId ? null : regionId;
      this.selectedTarget = null;
    } else if (this.selectedSource !== null && getLegalTargets(this.state, this.selectedSource).includes(regionId)) {
      this.selectedTarget = regionId;
      this.performAttack();
      return;
    }
    this.renderGame();
  }

  performAttack() {
    if (this.selectedSource === null || this.selectedTarget === null) return;
    this.state = resolveAttack(this.state, this.selectedSource, this.selectedTarget).state;
    this.selectedSource = null;
    this.selectedTarget = null;
    this.save();
    this.renderGame();
  }

  finishHumanTurn() {
    if (!getActivePlayer(this.state).isHuman || this.state.phase !== "playing") return;
    this.selectedSource = null;
    this.selectedTarget = null;
    this.state = endTurn(this.state);
    this.save();
    this.renderGame();
  }

  beginAiTurn() {
    this.aiRunning = true;
    this.aiTimer = window.setTimeout(() => this.runAiStep(0), 280);
  }

  runAiStep(attackCount) {
    if (!this.state || this.state.phase !== "playing" || getActivePlayer(this.state).isHuman) {
      this.aiRunning = false;
      return;
    }
    const choice = chooseAiAttack(this.state, attackCount);
    if (!choice) {
      this.state = endTurn(this.state);
      this.aiRunning = false;
      this.save();
      this.renderGame();
      return;
    }
    this.state = resolveAttack(this.state, choice.sourceId, choice.targetId).state;
    this.save();
    this.renderGame();
    this.aiTimer = window.setTimeout(() => {
      this.runAiStep(attackCount + 1);
    }, 200);
  }

  requestNewGame() {
    if (this.state?.phase === "playing" && !window.confirm(this.t("confirmNew"))) return;
    if (this.aiTimer) window.clearTimeout(this.aiTimer);
    this.aiRunning = false;
    this.clearSave();
    this.renderSetup();
  }

  async copySeed() {
    try {
      await navigator.clipboard.writeText(this.state.config.seed);
      this.showToast(this.t("seedCopied"));
    } catch {
      this.showToast(this.state.config.seed);
    }
  }

  showToast(message) {
    this.toast = message;
    if (this.toastTimer) window.clearTimeout(this.toastTimer);
    this.renderGame();
    this.toastTimer = window.setTimeout(() => {
      this.toast = null;
      this.renderGame();
    }, 1600);
  }

  onKeyDown(event) {
    if (!this.state) return;
    if (event.key === "Escape") {
      this.selectedSource = null;
      this.selectedTarget = null;
      this.renderGame();
    }
    if (event.key.toLowerCase() === "f" && !event.ctrlKey && !event.metaKey) {
      this.resetCamera();
      this.renderGame();
    }
  }
}
