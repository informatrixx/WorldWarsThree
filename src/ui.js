import { chooseAiAttack, playAiCards } from "./core/ai.js";
import { SoundManager } from "./audio.js";
import {
  calculateReinforcements,
  createGame,
  deserializeGame,
  discardCard,
  endTurn,
  getActivePlayer,
  getBattleModifierSummary,
  getLegalCardTargets,
  getLegalTargets,
  playCard,
  requiresCardDiscard,
  resolveAttack,
  serializeGame,
} from "./core/game.js";
import { cellKey, getCellCenter, getHexPoints, hexDistance } from "./core/map-generator.js";
import { randomSeed } from "./core/random.js";
import { playerName, translate } from "./i18n.js";

const SAVE_KEY = "dicefront-dominion:save:v3";
const LOCALE_KEY = "dicefront-dominion:locale";
const SETUP_KEY = "dicefront-dominion:setup:v1";
const DEFAULT_SETUP = Object.freeze({
  playerCount: 4,
  mapSize: "medium",
  supplyRate: "low",
  difficulty: "normal",
  victoryMode: "headquarters",
  cardsEnabled: true,
  seed: "",
});
const COMBAT_ANIMATION_MS = 1100;
const TURN_NOTIFICATION_MS = 900;
const HEX_DIRECTIONS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const EDGE_CORNERS = [[0, 1], [5, 0], [4, 5], [3, 4], [2, 3], [1, 2]];
const DIE_FACES = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
const CARD_ICONS = Object.freeze({
  supplyDrop: "✚",
  redeploy: "⇄",
  fireSupport: "✦",
  fortification: "◆",
  luckyRoll: "⚄",
  mobilization: "⬡",
});

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

function signedModifier(value) {
  if (value > 0) return `+${value}`;
  if (value < 0) return `−${Math.abs(value)}`;
  return "±0";
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

function renderTerrainToken(terrain, label) {
  const shapes = {
    plains: '<path d="M-6 4H6M-5 0H4M-3-4H6"/>',
    forest: '<path d="M0-7-5-1h3l-4 5h5v4h2V4h5L2-1h3z"/>',
    hills: '<path d="M-7 5-2-3 1 1 4-5 8 5z"/>',
    city: '<path d="M-6 5V-2h4V5M0 5V-6h5V5M-7 5H7M2-3h1M2 0h1"/>',
  };
  return `
    <g class="token-terrain" transform="translate(-12 -10) scale(.56)" aria-hidden="true">
      <title>${escapeHtml(label)}</title>
      <g class="terrain-token-shape">${shapes[terrain] ?? shapes.plains}</g>
    </g>
  `;
}

function renderForceComposition(units, slots) {
  const counts = unitCounts(units);
  const entries = ["infantry", "armor", "artillery"]
    .filter((type) => counts[type] > 0);
  return entries.map((type, index) => {
    const cell = slots[index] ?? slots[0];
    const center = getCellCenter(cell.q, cell.r);
    return `
      <g class="force-type force-${type}" data-cell-q="${cell.q}" data-cell-r="${cell.r}" transform="translate(${number(center.x)} ${number(center.y)})">
        <image class="force-image" href="${unitAsset(type)}" x="-15" y="-18" width="30" height="30" preserveAspectRatio="xMidYMid meet"/>
        <circle class="force-count-bg" cx="10" cy="10" r="7"/>
        <text class="force-count" x="10" y="13">${counts[type]}</text>
      </g>
    `;
  }).join("");
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

function regionDisplayCells(region) {
  if (!region.cells?.length) return [];
  const owned = new Set(region.cells.map((cell) => cellKey(cell.q, cell.r)));
  const ranked = region.cells.map((cell) => {
    const center = getCellCenter(cell.q, cell.r);
    const friendlyNeighbors = HEX_DIRECTIONS.filter(([dq, dr]) => (
      owned.has(cellKey(cell.q + dq, cell.r + dr))
    )).length;
    const centroidDistance = (center.x - region.center.x) ** 2 + (center.y - region.center.y) ** 2;
    return { cell, friendlyNeighbors, centroidDistance };
  }).sort((first, second) => (
    second.friendlyNeighbors - first.friendlyNeighbors
    || first.centroidDistance - second.centroidDistance
  ));
  const anchor = ranked[0].cell;
  const selected = [anchor];
  const selectedKeys = new Set([cellKey(anchor.q, anchor.r)]);
  while (selected.length < Math.min(4, region.cells.length)) {
    const candidates = region.cells.filter((cell) => (
      !selectedKeys.has(cellKey(cell.q, cell.r))
      && HEX_DIRECTIONS.some(([dq, dr]) => selectedKeys.has(cellKey(cell.q + dq, cell.r + dr)))
    )).sort((first, second) => {
      const selectedNeighbors = (cell) => HEX_DIRECTIONS.filter(([dq, dr]) => (
        selectedKeys.has(cellKey(cell.q + dq, cell.r + dr))
      )).length;
      const firstCenter = getCellCenter(first.q, first.r);
      const secondCenter = getCellCenter(second.q, second.r);
      return selectedNeighbors(second) - selectedNeighbors(first)
        || hexDistance(anchor, first) - hexDistance(anchor, second)
        || ((firstCenter.x - region.center.x) ** 2 + (firstCenter.y - region.center.y) ** 2)
          - ((secondCenter.x - region.center.x) ** 2 + (secondCenter.y - region.center.y) ** 2);
    });
    if (!candidates.length) break;
    selected.push(candidates[0]);
    selectedKeys.add(cellKey(candidates[0].q, candidates[0].r));
  }
  return selected;
}

function renderCombatDice(dice) {
  return dice.map((die, index) => `
    <span class="combat-die ${die.rerolls ? "rerolled" : ""}" style="--die-index:${index}" title="${escapeHtml(die.type)}">
      <b>${DIE_FACES[die.base - 1]}</b>${die.modifier ? `<sup>+${die.modifier}</sup>` : ""}
    </span>
  `).join("");
}

export class GameApp {
  constructor(root) {
    this.root = root;
    this.locale = this.loadLocale();
    this.setupPreferences = this.loadSetupPreferences();
    this.state = null;
    this.savedState = this.loadSavedGame();
    this.selectedSource = null;
    this.selectedTarget = null;
    this.selectedCardId = null;
    this.cardSource = null;
    this.camera = null;
    this.cameraSeed = null;
    this.aiRunning = false;
    this.aiTimer = null;
    this.combatAnimation = null;
    this.combatAnimationTimer = null;
    this.toast = null;
    this.toastTimer = null;
    this.audio = new SoundManager();
    this.announcedWinnerId = null;
    this.turnNotification = null;
    this.turnNotificationTimer = null;
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

  loadSetupPreferences() {
    try {
      const stored = JSON.parse(localStorage.getItem(SETUP_KEY));
      return {
        playerCount: Number.isInteger(stored?.playerCount) && stored.playerCount >= 2 && stored.playerCount <= 6
          ? stored.playerCount : DEFAULT_SETUP.playerCount,
        mapSize: ["small", "medium", "large"].includes(stored?.mapSize)
          ? stored.mapSize : DEFAULT_SETUP.mapSize,
        supplyRate: ["low", "medium", "high", "veryHigh"].includes(stored?.supplyRate)
          ? stored.supplyRate : DEFAULT_SETUP.supplyRate,
        difficulty: ["easy", "normal", "hard"].includes(stored?.difficulty)
          ? stored.difficulty : DEFAULT_SETUP.difficulty,
        victoryMode: ["headquarters", "conquest"].includes(stored?.victoryMode)
          ? stored.victoryMode : DEFAULT_SETUP.victoryMode,
        cardsEnabled: typeof stored?.cardsEnabled === "boolean"
          ? stored.cardsEnabled : DEFAULT_SETUP.cardsEnabled,
        seed: typeof stored?.seed === "string" ? stored.seed.slice(0, 80) : DEFAULT_SETUP.seed,
      };
    } catch {
      return { ...DEFAULT_SETUP };
    }
  }

  saveSetupPreferences(preferences) {
    this.setupPreferences = { ...preferences };
    try {
      localStorage.setItem(SETUP_KEY, JSON.stringify(this.setupPreferences));
    } catch {
      // The selected options still remain available for the current page session.
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

  renderSoundButton() {
    const label = this.t(this.audio.enabled ? "soundOff" : "soundOn");
    return `
      <button type="button" class="icon-button sound-toggle ${this.audio.enabled ? "active" : "muted"}" data-sound-toggle
        title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}" aria-pressed="${this.audio.enabled}">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 9h4l5-4v14l-5-4H4z"/>
          ${this.audio.enabled ? '<path class="sound-waves" d="M16 9q3 3 0 6M18.5 6.5q5.5 5.5 0 11"/>' : '<path class="sound-waves" d="m16 9 5 6m0-6-5 6"/>'}
        </svg>
      </button>
    `;
  }

  bindLanguageSwitches() {
    this.root.querySelectorAll("[data-locale]").forEach((button) => {
      button.addEventListener("click", () => this.setLocale(button.dataset.locale));
    });
  }

  bindSoundToggles() {
    this.root.querySelectorAll("[data-sound-toggle]").forEach((button) => {
      button.addEventListener("click", async () => {
        await this.audio.toggle();
        const played = this.audio.enabled ? await this.audio.playEnabledCue() : true;
        if (!played && this.state) {
          this.showToast(this.t("soundBlocked"));
          return;
        }
        if (this.state) this.renderGame();
        else this.renderSetup();
      });
    });
  }

  playSound(playback) {
    void playback.then((played) => {
      if (!played && this.audio.enabled && this.state) this.showToast(this.t("soundBlocked"));
    }).catch(() => {
      if (this.audio.enabled && this.state) this.showToast(this.t("soundBlocked"));
    });
  }

  renderSetup() {
    this.state = null;
    this.selectedSource = null;
    this.selectedTarget = null;
    this.selectedCardId = null;
    this.cardSource = null;
    this.camera = null;
    const setup = this.setupPreferences;
    this.root.innerHTML = `
      <main class="setup-shell">
        <div class="ambient-grid" aria-hidden="true"></div>
        <header class="setup-header">
          <a class="brand" href="./" aria-label="${escapeHtml(this.t("title"))}">
            <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
            <span><strong>Dicefront</strong><small>Dominion</small></span>
          </a>
          <div class="header-actions">
            ${this.renderLanguageSwitch()}
            ${this.renderSoundButton()}
          </div>
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
                ${[2, 3, 4, 5, 6].map((count) => `<option value="${count}" ${count === setup.playerCount ? "selected" : ""}>${count}</option>`).join("")}
              </select>
            </label>
            <label>
              <span>${escapeHtml(this.t("mapSize"))}</span>
              <select name="mapSize">
                <option value="small" ${setup.mapSize === "small" ? "selected" : ""}>${escapeHtml(this.t("small"))}</option>
                <option value="medium" ${setup.mapSize === "medium" ? "selected" : ""}>${escapeHtml(this.t("medium"))}</option>
                <option value="large" ${setup.mapSize === "large" ? "selected" : ""}>${escapeHtml(this.t("large"))}</option>
              </select>
            </label>
            <label>
              <span>${escapeHtml(this.t("supplyRate"))}</span>
              <select name="supplyRate">
                <option value="low" ${setup.supplyRate === "low" ? "selected" : ""}>${escapeHtml(this.t("supplyLow"))}</option>
                <option value="medium" ${setup.supplyRate === "medium" ? "selected" : ""}>${escapeHtml(this.t("supplyMedium"))}</option>
                <option value="high" ${setup.supplyRate === "high" ? "selected" : ""}>${escapeHtml(this.t("supplyHigh"))}</option>
                <option value="veryHigh" ${setup.supplyRate === "veryHigh" ? "selected" : ""}>${escapeHtml(this.t("supplyVeryHigh"))}</option>
              </select>
            </label>
            <div class="form-grid">
              <label>
                <span>${escapeHtml(this.t("difficulty"))}</span>
                <select name="difficulty">
                  <option value="easy" ${setup.difficulty === "easy" ? "selected" : ""}>${escapeHtml(this.t("easy"))}</option>
                  <option value="normal" ${setup.difficulty === "normal" ? "selected" : ""}>${escapeHtml(this.t("normal"))}</option>
                  <option value="hard" ${setup.difficulty === "hard" ? "selected" : ""}>${escapeHtml(this.t("hard"))}</option>
                </select>
              </label>
              <label>
                <span>${escapeHtml(this.t("victoryMode"))}</span>
                <select name="victoryMode">
                  <option value="headquarters" ${setup.victoryMode === "headquarters" ? "selected" : ""}>${escapeHtml(this.t("headquarters"))}</option>
                  <option value="conquest" ${setup.victoryMode === "conquest" ? "selected" : ""}>${escapeHtml(this.t("conquest"))}</option>
                </select>
              </label>
            </div>
            <label class="toggle-field">
              <span><strong>${escapeHtml(this.t("tacticalCards"))}</strong><small>${escapeHtml(this.t("tacticalCardsHint"))}</small></span>
              <input type="checkbox" name="cardsEnabled" ${setup.cardsEnabled ? "checked" : ""}>
              <i aria-hidden="true"></i>
            </label>
            <label>
              <span>${escapeHtml(this.t("seed"))}</span>
              <div class="seed-field">
                <input name="seed" id="seed-input" maxlength="80" value="${escapeHtml(setup.seed)}" placeholder="${escapeHtml(this.t("seedHint"))}">
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
    this.bindSoundToggles();
    this.root.querySelector("#random-seed").addEventListener("click", () => {
      this.root.querySelector("#seed-input").value = randomSeed();
    });
    this.root.querySelector("#continue-game")?.addEventListener("click", () => {
      this.continueSavedGame();
    });
    this.root.querySelector("#setup-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const preferences = {
        playerCount: Number(data.get("playerCount")),
        mapSize: data.get("mapSize"),
        difficulty: data.get("difficulty"),
        victoryMode: data.get("victoryMode"),
        supplyRate: data.get("supplyRate"),
        cardsEnabled: data.get("cardsEnabled") === "on",
        seed: String(data.get("seed") || "").trim(),
      };
      this.state = createGame({
        ...preferences,
        seed: preferences.seed || randomSeed(),
        locale: this.locale,
      });
      this.saveSetupPreferences(preferences);
      this.camera = null;
      this.announcedWinnerId = null;
      this.audio.setMatchActive(true);
      this.save();
      this.announceCurrentTurn();
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

  continueSavedGame() {
    if (!this.savedState) return;
    if (this.aiTimer) window.clearTimeout(this.aiTimer);
    if (this.combatAnimationTimer) window.clearTimeout(this.combatAnimationTimer);
    if (this.turnNotificationTimer) window.clearTimeout(this.turnNotificationTimer);
    const restored = deserializeGame(serializeGame(this.savedState));
    if (!restored) {
      this.clearSave();
      this.renderSetup();
      return;
    }
    this.state = restored;
    this.savedState = restored;
    this.locale = restored.config.locale ?? this.locale;
    this.selectedSource = null;
    this.selectedTarget = null;
    this.selectedCardId = null;
    this.cardSource = null;
    this.camera = null;
    this.cameraSeed = null;
    this.aiRunning = false;
    this.aiTimer = null;
    this.combatAnimation = null;
    this.combatAnimationTimer = null;
    this.turnNotification = null;
    this.turnNotificationTimer = null;
    this.announcedWinnerId = null;
    this.audio.setMatchActive(true);
    if (this.state.phase === "playing" && getActivePlayer(this.state).isHuman) {
      this.announceCurrentTurn();
    } else {
      this.renderGame();
    }
  }

  mapDetailClass() {
    if (!this.camera || !this.state?.map?.bounds?.width) return "map-detail-overview";
    return this.camera.width / this.state.map.bounds.width <= 0.82
      ? "map-detail-tactical"
      : "map-detail-overview";
  }

  syncMapDetailClass(svg) {
    const tactical = this.mapDetailClass() === "map-detail-tactical";
    svg.classList.toggle("map-detail-tactical", tactical);
    svg.classList.toggle("map-detail-overview", !tactical);
  }

  playerStats(player) {
    const regions = this.state.map.regions.filter((region) => region.ownerId === player.id);
    return {
      regions: regions.length,
      units: regions.reduce((sum, region) => sum + region.units.length, 0),
      reinforcements: player.active ? calculateReinforcements(this.state, player.id) : 0,
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
            ${player.active ? `
              <span class="player-metrics">
                <span title="${escapeHtml(this.t("territories", { count: stats.regions }))}"><b>${stats.regions}</b><small>${escapeHtml(this.t("territoryMetric"))}</small></span>
                <span class="supply" title="${escapeHtml(this.t("reinforcementPreview", { count: stats.reinforcements }))}"><b>+${stats.reinforcements}</b><small>${escapeHtml(this.t("supplyMetric"))}</small></span>
                ${this.state.config.cardsEnabled ? `<span class="card-count" title="${escapeHtml(this.t("cardCount", { count: player.hand.length }))}"><b>${player.hand.length}</b><small>${escapeHtml(this.t("cardsMetric"))}</small></span>` : ""}
              </span>
            ` : `<small class="eliminated-label">${escapeHtml(this.t("eliminated"))}</small>`}
          </span>
        </div>
      `;
    }).join("");
  }

  renderRanking() {
    const ranked = this.state.players.map((player) => ({
      player,
      territories: this.state.map.regions.filter((region) => region.ownerId === player.id).length,
      units: this.state.map.regions
        .filter((region) => region.ownerId === player.id)
        .reduce((sum, region) => sum + region.units.length, 0),
    })).sort((first, second) => (
      second.territories - first.territories || first.player.id - second.player.id
    ));
    let previousTerritories = null;
    let rank = 0;
    return `
      <section class="side-panel ranking-panel">
        <div class="panel-kicker">${escapeHtml(this.t("ranking"))}</div>
        <ol class="ranking-list">
          ${ranked.map(({ player, territories, units }, index) => {
            if (territories !== previousTerritories) rank = index + 1;
            previousTerritories = territories;
            return `
              <li class="ranking-entry ${player.active ? "" : "inactive"}" style="--rank-color:${player.style.color};--rank-accent:${player.style.accent}">
                <b class="ranking-position">${rank}</b>
                <span class="ranking-name">${escapeHtml(playerName(this.state, player.id, this.locale))}</span>
                <span class="ranking-metrics">
                  <strong class="ranking-territories">${territories}<small>${escapeHtml(this.t("territoryMetric"))}</small></strong>
                  <strong class="ranking-units">${units}<small>${escapeHtml(this.t("troopMetric"))}</small></strong>
                </span>
              </li>
            `;
          }).join("")}
        </ol>
      </section>
    `;
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
    const cardTargets = this.selectedCardId === null
      ? []
      : getLegalCardTargets(this.state, this.selectedCardId, { sourceId: this.cardSource });
    const cardTargetSet = new Set(cardTargets);
    const legalTargets = this.selectedCardId !== null || this.selectedSource === null
      ? []
      : getLegalTargets(this.state, this.selectedSource);
    const legalTargetSet = new Set(legalTargets);
    const renderedRegions = this.state.map.regions.map((region) => {
      const player = this.state.players[region.ownerId];
      const animatedBattle = this.combatAnimation?.battle;
      const animatedAttacker = animatedBattle
        ? this.state.players[animatedBattle.attackerId]
        : null;
      const pendingAiBattle = Boolean(animatedAttacker && !animatedAttacker.isHuman);
      const pendingCapture = pendingAiBattle
        && animatedBattle.attackerWon
        && region.id === animatedBattle.targetId;
      const pendingAttack = pendingAiBattle && region.id === animatedBattle.sourceId;
      const visualPlayer = pendingCapture
        ? this.state.players[animatedBattle.defenderId]
        : player;
      const visualDice = pendingAttack ? animatedBattle.attackerDice
        : pendingCapture ? animatedBattle.defenderDice
          : null;
      const visualUnits = Array.isArray(visualDice)
        ? visualDice.map((die) => die.type)
        : region.units;
      const displayCells = regionDisplayCells(region);
      const forceSlots = displayCells.slice(0, 3);
      const infoCell = displayCells[3] ?? displayCells.at(-1);
      const infoCenter = getCellCenter(infoCell.q, infoCell.r);
      const points = region.cells.map((cell) => {
        const polygon = getHexPoints(cell.q, cell.r).map((point) => `${number(point.x)},${number(point.y)}`).join(" ");
        return `<polygon points="${polygon}" class="region-cell"/><polygon points="${polygon}" class="region-pattern"/>`;
      }).join("");
      const classes = [];
      const modifier = legalTargetSet.has(region.id)
        ? getBattleModifierSummary(this.state, this.selectedSource, region.id)
        : null;
      if (region.isHeadquarters) classes.push("headquarters");
      if (region.id === this.cardSource) classes.push("selected-card-source");
      else if (cardTargetSet.has(region.id)) classes.push("card-target");
      else if (region.id === this.selectedSource) classes.push("selected-source");
      else if (legalTargetSet.has(region.id)) classes.push("legal-target");
      if (this.selectedSource === null && region.id === this.combatAnimation?.battle.sourceId) classes.push("combat-source");
      if (this.selectedSource === null && region.id === this.combatAnimation?.battle.targetId) classes.push("combat-target");
      const selectedClass = classes.join(" ");
      let label = this.t("ariaRegion", {
        region: this.t("region", { id: region.id + 1 }),
        owner: playerName(this.state, player.id, this.locale),
        terrain: this.t(region.terrain),
        units: this.t("units", { count: region.units.length }),
      });
      if (modifier) label += `, ${this.t("ariaModifier", { value: signedModifier(modifier.netBonus) })}`;
      const effects = (this.state.cards?.effects ?? []).filter((effect) => effect.regionId === region.id);
      const effectCounts = effects.reduce((counts, effect) => {
        counts[effect.type] = (counts[effect.type] ?? 0) + 1;
        return counts;
      }, {});
      const effectMarkers = Object.entries(effectCounts).map(([type, count], index) => `
        <g class="card-effect effect-${type}" transform="translate(17 ${number(-10 + index * 12)})">
          <circle r="6.5"/><text y="2.6">${CARD_ICONS[type] ?? "◆"}</text>${count > 1 ? `<text class="effect-count" x="5.5" y="-4.5">${count}</text>` : ""}
        </g>
      `).join("");
      const regionStyle = `--region-color:${visualPlayer.style.color};--region-accent:${visualPlayer.style.accent};--pattern:url(#player-pattern-${visualPlayer.id})`;
      return {
        shape: `
          <g class="region terrain-${region.terrain} ${selectedClass}" data-region-id="${region.id}" tabindex="0" role="button"
            aria-label="${escapeHtml(label)}" style="${regionStyle}">
          ${points}
          <path class="region-boundary" d="${regionBoundary(region, ownerByCell)}"/>
          </g>`,
        marker: `
          <g class="region-marker-owner terrain-${region.terrain} ${selectedClass}" data-marker-region-id="${region.id}" style="${regionStyle}">
            <g class="region-marker">
              <g class="territory-formation">
                <g class="force-composition">${renderForceComposition(visualUnits, forceSlots)}</g>
                <g class="territory-info" data-cell-q="${infoCell.q}" data-cell-r="${infoCell.r}" transform="translate(${number(infoCenter.x)} ${number(infoCenter.y)})">
                  ${renderTerrainToken(region.terrain, this.t(region.terrain))}
                  <circle class="unit-total-bg" cx="7" cy="5" r="14"/>
                  <text class="unit-total" x="7" y="11">${visualUnits.length}</text>
                  ${region.isHeadquarters ? '<g class="hq-token"><rect x="-14" y="-23" width="28" height="11" rx="4"/><text y="-15">HQ</text></g>' : ""}
                  <g class="card-effect-markers">${effectMarkers}</g>
                  ${modifier ? `<g class="combat-modifier modifier-${modifier.netBonus > 0 ? "positive" : modifier.netBonus < 0 ? "negative" : "neutral"}" transform="translate(0 21)"><rect x="-15" y="-7" width="30" height="14" rx="5"/><text y="3">${signedModifier(modifier.netBonus)}</text></g>` : ""}
                </g>
              </g>
            </g>
          </g>
        `,
      };
    });
    const regions = renderedRegions.map(({ shape }) => shape).join("");
    const markers = renderedRegions.map(({ marker }) => marker).join("");
    const animatedBattle = this.combatAnimation?.battle;
    const animatedAttacker = animatedBattle
      ? this.state.players[animatedBattle.attackerId]
      : null;
    let attackArrow = "";
    if (animatedBattle && animatedAttacker && !animatedAttacker.isHuman) {
      const source = this.state.map.regions[animatedBattle.sourceId];
      const target = this.state.map.regions[animatedBattle.targetId];
      const sourceCell = source && regionDisplayCells(source)[0];
      const targetCell = target && regionDisplayCells(target)[0];
      if (sourceCell && targetCell) {
        const sourceCenter = getCellCenter(sourceCell.q, sourceCell.r);
        const targetCenter = getCellCenter(targetCell.q, targetCell.r);
        const dx = targetCenter.x - sourceCenter.x;
        const dy = targetCenter.y - sourceCenter.y;
        const distance = Math.hypot(dx, dy);
        if (distance > 0) {
          const startInset = Math.min(22, distance * .18);
          const endInset = Math.min(28, distance * .22);
          const start = {
            x: sourceCenter.x + (dx / distance) * startInset,
            y: sourceCenter.y + (dy / distance) * startInset,
          };
          const end = {
            x: targetCenter.x - (dx / distance) * endInset,
            y: targetCenter.y - (dy / distance) * endInset,
          };
          const bend = Math.min(24, distance * .1) * ((source.id + target.id) % 2 ? 1 : -1);
          const control = {
            x: (start.x + end.x) / 2 - (dy / distance) * bend,
            y: (start.y + end.y) / 2 + (dx / distance) * bend,
          };
          const path = `M${number(start.x)},${number(start.y)}Q${number(control.x)},${number(control.y)} ${number(end.x)},${number(end.y)}`;
          attackArrow = `
            <g class="ai-attack-arrow" aria-hidden="true">
              <circle class="ai-arrow-origin" cx="${number(start.x)}" cy="${number(start.y)}" r="8"/>
              <path class="ai-arrow-shadow" d="${path}"/>
              <path class="ai-arrow-line" d="${path}"/>
            </g>
          `;
        }
      }
    }
    const viewBox = `${number(this.camera.x)} ${number(this.camera.y)} ${number(this.camera.width)} ${number(this.camera.height)}`;
    return `
      <svg id="battle-map" class="${this.mapDetailClass()}" viewBox="${viewBox}" aria-label="${escapeHtml(this.t("ariaMap"))}" role="application">
        <defs>
          ${this.renderPatternDefinitions()}
        </defs>
        <rect class="map-background" x="${this.state.map.bounds.x - 1000}" y="${this.state.map.bounds.y - 1000}" width="${this.state.map.bounds.width + 2000}" height="${this.state.map.bounds.height + 2000}"/>
        <g class="map-regions">${regions}</g>
        <g class="map-combat-direction">${attackArrow}</g>
        <g class="map-markers">${markers}</g>
      </svg>
    `;
  }

  renderCardsPanel() {
    if (!this.state.config.cardsEnabled) return "";
    const human = this.state.players.find((player) => player.isHuman);
    const active = getActivePlayer(this.state);
    const overflow = active.isHuman && requiresCardDiscard(this.state);
    const selected = human.hand.find((card) => card.id === this.selectedCardId);
    const instruction = overflow
      ? this.t("discardCardPrompt")
      : selected
        ? this.t(selected.type === "redeploy" && this.cardSource === null ? "selectCardSource" : "selectCardTarget")
        : this.t("cardsHint");
    return `
      <section class="side-panel cards-panel ${overflow ? "cards-overflow" : ""}">
        <div class="cards-heading"><div class="panel-kicker">${escapeHtml(this.t("tacticalCards"))}</div><span>${human.hand.length}/3</span></div>
        <p class="card-instruction">${escapeHtml(instruction)}</p>
        <div class="card-hand">
          ${human.hand.map((card) => {
            const playable = getLegalCardTargets(this.state, card.id).length > 0;
            const rare = ["luckyRoll", "mobilization"].includes(card.type);
            return `
              <article class="tactical-card ${rare ? "rare" : "common"} ${this.selectedCardId === card.id ? "selected" : ""} ${!playable ? "unplayable" : ""}">
                <button type="button" class="card-play" data-card-id="${escapeHtml(card.id)}" ${active.isHuman && !overflow && playable ? "" : "disabled"}
                  title="${escapeHtml(this.t(`${card.type}Description`))}">
                  <span class="card-icon" aria-hidden="true">${CARD_ICONS[card.type]}</span>
                  <span><strong>${escapeHtml(this.t(card.type))}</strong><small>${escapeHtml(this.t(rare ? "rareCard" : "commonCard"))}</small></span>
                </button>
                ${overflow ? `<button type="button" class="card-discard" data-discard-card="${escapeHtml(card.id)}" title="${escapeHtml(this.t("discardCard"))}" aria-label="${escapeHtml(this.t("discardNamedCard", { card: this.t(card.type) }))}">×</button>` : ""}
              </article>
            `;
          }).join("") || `<p class="empty-hand">${escapeHtml(this.t("emptyHand"))}</p>`}
        </div>
        ${selected ? `<button type="button" class="text-button" id="cancel-card">× ${escapeHtml(this.t("cancelCard"))}</button>` : ""}
      </section>
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
          <div>
            <strong>${escapeHtml(this.t("region", { id: region.id + 1 }))}</strong>
            <span class="summary-meta"><b class="summary-strength" title="${escapeHtml(this.t("units", { count: region.units.length }))}">${region.units.length}</b>${region.isHeadquarters ? `<b class="tag">${this.t("headquartersShort")}</b>` : ""}</span>
          </div>
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
    if (entry.type === "cardDrawn") return this.state.players[entry.playerId].isHuman
      ? this.t("logCardDrawn", { card: this.t(entry.cardType) })
      : this.t("logCardDrawnHidden", { player: playerName(this.state, entry.playerId, this.locale) });
    if (entry.type === "cardPlayed") return this.t("logCardPlayed", {
      player: playerName(this.state, entry.playerId, this.locale),
      card: this.t(entry.cardType),
      target: entry.targetId === undefined ? entry.sourceId + 1 : entry.targetId + 1,
    });
    if (entry.type === "cardDiscarded") return this.state.players[entry.playerId].isHuman
      ? this.t("logCardDiscarded", { card: this.t(entry.cardType) })
      : this.t("logCardDiscardedHidden", { player: playerName(this.state, entry.playerId, this.locale) });
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

  renderCombatAnimation() {
    if (!this.combatAnimation) return "";
    const battle = this.combatAnimation.battle;
    const elapsed = Math.min(COMBAT_ANIMATION_MS, Math.max(0, Date.now() - (this.combatAnimation.startedAt ?? Date.now())));
    const attacker = this.state.players[battle.attackerId];
    const defender = this.state.players[battle.defenderId];
    return `
      <div class="combat-overlay" aria-hidden="true" style="--combat-resume:-${elapsed}ms;--combat-result-delay:${540 - elapsed}ms">
        <div class="combat-roll">
          <div class="combat-side combat-attacker" style="--combat-color:${attacker.style.color}">
            <span>${escapeHtml(this.t("attacker"))}</span>
            <div class="combat-dice">${renderCombatDice(battle.attackerDice)}</div>
            <strong class="combat-total">${battle.attackerTotal}${battle.attackerCardBonus ? `<small>+${battle.attackerCardBonus} ${CARD_ICONS.fireSupport}</small>` : ""}${battle.luckyRerolls ? `<small>${CARD_ICONS.luckyRoll} ×${battle.luckyRerolls}</small>` : ""}</strong>
          </div>
          <div class="combat-outcome ${battle.attackerWon ? "won" : "lost"}">
            <i>VS</i>
            <b>${escapeHtml(this.t(battle.attackerWon ? "attackWon" : "attackLost"))}</b>
          </div>
          <div class="combat-side combat-defender" style="--combat-color:${defender.style.color}">
            <span>${escapeHtml(this.t("defender"))}</span>
            <div class="combat-dice">${renderCombatDice(battle.defenderDice)}</div>
            <strong class="combat-total">${battle.defenderTotal}${battle.defenderCardBonus ? `<small>+${battle.defenderCardBonus} ${CARD_ICONS.fortification}</small>` : ""}</strong>
          </div>
        </div>
      </div>
    `;
  }

  renderTurnNotification() {
    if (!this.turnNotification) return "";
    const player = this.state.players[this.turnNotification.playerId];
    const message = player.isHuman
      ? this.t("yourTurnNotice")
      : this.t("playerTurnNotice", { player: playerName(this.state, player.id, this.locale) });
    return `
      <div class="turn-notification" role="status" aria-live="polite" style="--turn-color:${player.style.color}">
        <i aria-hidden="true"></i>
        <span>
          <small>${escapeHtml(this.t("round", { round: this.turnNotification.round }))}</small>
          <strong>${escapeHtml(message)}</strong>
        </span>
      </div>
    `;
  }

  renderVictoryModal() {
    if (this.state.phase !== "finished" || this.combatAnimation) return "";
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
            ${this.renderSoundButton()}
            <button class="icon-button" id="new-game-button" title="${escapeHtml(this.t("newGame"))}" aria-label="${escapeHtml(this.t("newGame"))}">＋</button>
          </div>
        </header>
        <div class="players-bar">${this.renderPlayers()}</div>
        <div class="game-layout">
          <section class="map-stage">
            <div class="map-meta">
              <span>${escapeHtml(this.t("mapProfile", { profile: this.t(this.state.map.profile) }))}</span>
              ${this.canReseedMap() ? `<button id="reseed-map" class="reseed-map" title="${escapeHtml(this.t("reseedMapTitle"))}">↻ ${escapeHtml(this.t("reseedMap"))}</button>` : ""}
              <button id="copy-seed" title="${escapeHtml(this.t("copySeed"))}"># ${escapeHtml(this.state.config.seed)}</button>
            </div>
            ${this.renderMap()}
            ${this.renderTurnNotification()}
            ${this.renderCombatAnimation()}
            <div class="map-controls">
              <button data-zoom="1.22" aria-label="${escapeHtml(this.t("zoomIn"))}" title="${escapeHtml(this.t("zoomIn"))}">＋</button>
              <button data-zoom="0.82" aria-label="${escapeHtml(this.t("zoomOut"))}" title="${escapeHtml(this.t("zoomOut"))}">−</button>
              <button id="fit-map" aria-label="${escapeHtml(this.t("fitMap"))}" title="${escapeHtml(this.t("fitMap"))}">⌗</button>
            </div>
          </section>
          <aside class="game-sidebar">
            ${this.renderRanking()}
            ${this.renderCardsPanel()}
            ${this.selectedRegionPanel()}
            <section class="side-panel help-panel">
              <div class="panel-kicker">${escapeHtml(this.t("helpTitle"))}</div>
              <p>${escapeHtml(this.t("helpText"))}</p>
              <div class="unit-legend">
                ${["infantry", "armor", "artillery"].map((type) => `<span><img src="${unitAsset(type)}" alt="">${escapeHtml(this.t(type))}</span>`).join("")}
              </div>
            </section>
            ${this.renderLog()}
            <button class="button button-primary end-turn" id="end-turn" ${humanTurn && !this.combatAnimation && !requiresCardDiscard(this.state) ? "" : "disabled"}>${escapeHtml(this.t("endTurn"))}<span>→</span></button>
          </aside>
        </div>
        ${this.toast ? `<div class="toast">${escapeHtml(this.toast)}</div>` : ""}
        ${this.renderVictoryModal()}
      </main>
    `;
    this.bindGameEvents();
    if (!active.isHuman && this.state.phase === "playing" && !this.aiRunning && !this.turnNotification) this.beginAiTurn();
  }

  bindGameEvents() {
    this.bindLanguageSwitches();
    this.bindSoundToggles();
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
    this.root.querySelectorAll("[data-card-id]").forEach((button) => button.addEventListener("click", () => {
      this.selectedCardId = this.selectedCardId === button.dataset.cardId ? null : button.dataset.cardId;
      this.cardSource = null;
      this.selectedSource = null;
      this.selectedTarget = null;
      this.playSound(this.audio.playSelection());
      this.renderGame();
    }));
    this.root.querySelectorAll("[data-discard-card]").forEach((button) => button.addEventListener("click", () => {
      this.state = discardCard(this.state, button.dataset.discardCard);
      this.selectedCardId = null;
      this.cardSource = null;
      this.playSound(this.audio.playCard());
      this.save();
      this.renderGame();
    }));
    this.root.querySelector("#cancel-card")?.addEventListener("click", () => {
      this.selectedCardId = null;
      this.cardSource = null;
      this.renderGame();
    });
    this.root.querySelector("#end-turn").addEventListener("click", () => this.finishHumanTurn());
    this.root.querySelector("#back-to-setup")?.addEventListener("click", () => {
      this.audio.setMatchActive(false);
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
    this.root.querySelector("#reseed-map")?.addEventListener("click", () => this.reseedMap());
    this.bindMapNavigation();
  }

  bindMapNavigation() {
    const svg = this.root.querySelector("#battle-map");
    svg.addEventListener("wheel", (event) => {
      event.preventDefault();
      this.zoomCamera(event.deltaY < 0 ? 1.13 : 0.885, event.clientX, event.clientY, false);
      svg.setAttribute("viewBox", `${number(this.camera.x)} ${number(this.camera.y)} ${number(this.camera.width)} ${number(this.camera.height)}`);
      this.syncMapDetailClass(svg);
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
    if (requiresCardDiscard(this.state)) return;
    if (this.selectedCardId !== null) {
      const legalTargets = getLegalCardTargets(this.state, this.selectedCardId, { sourceId: this.cardSource });
      if (!legalTargets.includes(regionId)) return;
      const card = active.hand.find((entry) => entry.id === this.selectedCardId);
      if (card?.type === "redeploy" && this.cardSource === null) {
        this.cardSource = regionId;
        this.playSound(this.audio.playSelection());
        this.renderGame();
        return;
      }
      this.performCard(regionId);
      return;
    }
    const region = this.state.map.regions[regionId];
    if (region.ownerId === active.id) {
      if (region.units.length < 2) return;
      const willSelect = this.selectedSource !== regionId;
      this.selectedSource = this.selectedSource === regionId ? null : regionId;
      this.selectedTarget = null;
      if (willSelect) this.playSound(this.audio.playSelection());
    } else if (this.selectedSource !== null && getLegalTargets(this.state, this.selectedSource).includes(regionId)) {
      this.selectedTarget = regionId;
      this.performAttack();
      return;
    }
    this.renderGame();
  }

  performCard(regionId) {
    if (this.selectedCardId === null) return;
    const card = getActivePlayer(this.state).hand.find((entry) => entry.id === this.selectedCardId);
    const selection = card?.type === "redeploy"
      ? { sourceId: this.cardSource, targetId: regionId }
      : { targetId: regionId };
    const played = playCard(this.state, this.selectedCardId, selection);
    this.state = played.state;
    this.selectedCardId = null;
    this.cardSource = null;
    this.selectedTarget = null;
    this.selectedSource = ["fireSupport", "luckyRoll"].includes(played.result.cardType)
      && getLegalTargets(this.state, regionId).length ? regionId : null;
    this.playSound(this.audio.playCard());
    this.save();
    this.renderGame();
  }

  performAttack() {
    if (this.selectedSource === null || this.selectedTarget === null) return;
    const result = resolveAttack(this.state, this.selectedSource, this.selectedTarget);
    this.state = result.state;
    this.selectedSource = null;
    this.selectedTarget = null;
    this.save();
    this.showCombatAnimation(result.battle);
  }

  finishHumanTurn() {
    if (!getActivePlayer(this.state).isHuman || this.state.phase !== "playing" || this.combatAnimation || requiresCardDiscard(this.state)) return;
    this.selectedSource = null;
    this.selectedTarget = null;
    this.selectedCardId = null;
    this.cardSource = null;
    this.playSound(this.audio.playEndTurn());
    this.state = endTurn(this.state);
    this.save();
    this.announceCurrentTurn();
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
    if (attackCount === 0) {
      const cards = playAiCards(this.state);
      this.state = cards.state;
      if (cards.played || cards.discarded) this.playSound(this.audio.playCard());
      this.save();
    }
    const choice = chooseAiAttack(this.state, attackCount);
    if (!choice) {
      this.state = endTurn(this.state);
      this.aiRunning = false;
      this.save();
      this.announceCurrentTurn();
      return;
    }
    const result = resolveAttack(this.state, choice.sourceId, choice.targetId);
    this.state = result.state;
    this.save();
    this.showCombatAnimation(result.battle, () => {
      this.runAiStep(attackCount + 1);
    });
  }

  showCombatAnimation(battle, onComplete) {
    if (this.combatAnimationTimer) window.clearTimeout(this.combatAnimationTimer);
    this.playSound(this.audio.playBattle(battle.attackerWon));
    this.combatAnimation = { battle, startedAt: Date.now() };
    this.renderGame();
    this.combatAnimationTimer = window.setTimeout(() => {
      this.combatAnimation = null;
      this.combatAnimationTimer = null;
      this.renderGame();
      if (this.state.phase === "finished" && this.announcedWinnerId !== this.state.winnerId) {
        this.announcedWinnerId = this.state.winnerId;
        this.playSound(this.audio.playGameEnd(this.state.winnerId === 0));
      }
      onComplete?.();
    }, COMBAT_ANIMATION_MS);
  }

  announceCurrentTurn() {
    if (!this.state || this.state.phase !== "playing") {
      this.turnNotification = null;
      this.renderGame();
      return;
    }
    if (this.turnNotificationTimer) window.clearTimeout(this.turnNotificationTimer);
    const active = getActivePlayer(this.state);
    this.turnNotification = { playerId: active.id, round: this.state.turn.round };
    this.playSound(this.audio.playTurnStart(active.isHuman));
    if (this.state.config.cardsEnabled) this.playSound(this.audio.playCardDraw());
    this.renderGame();
    this.turnNotificationTimer = window.setTimeout(() => {
      this.turnNotification = null;
      this.turnNotificationTimer = null;
      this.renderGame();
    }, TURN_NOTIFICATION_MS);
  }

  requestNewGame() {
    if (this.state?.phase === "playing" && !window.confirm(this.t("confirmNew"))) return;
    if (this.aiTimer) window.clearTimeout(this.aiTimer);
    if (this.combatAnimationTimer) window.clearTimeout(this.combatAnimationTimer);
    if (this.turnNotificationTimer) window.clearTimeout(this.turnNotificationTimer);
    this.aiRunning = false;
    this.combatAnimation = null;
    this.turnNotification = null;
    this.turnNotificationTimer = null;
    this.announcedWinnerId = null;
    this.audio.setMatchActive(false);
    this.clearSave();
    this.renderSetup();
  }

  canReseedMap() {
    if (!this.state || this.state.phase !== "playing" || this.state.turn.round !== 1) return false;
    if (!getActivePlayer(this.state).isHuman) return false;
    return this.state.log.every((entry) => ["gameStarted", "cardDrawn"].includes(entry.type));
  }

  reseedMap() {
    if (!this.canReseedMap()) return;
    if (this.turnNotificationTimer) window.clearTimeout(this.turnNotificationTimer);
    const previousSeed = this.state.config.seed;
    let seed = randomSeed();
    if (seed === previousSeed) seed = `${seed}-new`;
    this.state = createGame({ ...this.state.config, seed, locale: this.locale });
    this.selectedSource = null;
    this.selectedTarget = null;
    this.selectedCardId = null;
    this.cardSource = null;
    this.camera = null;
    this.cameraSeed = null;
    this.turnNotification = null;
    this.turnNotificationTimer = null;
    this.announcedWinnerId = null;
    this.save();
    this.announceCurrentTurn();
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
      this.selectedCardId = null;
      this.cardSource = null;
      this.renderGame();
    }
    if (event.key.toLowerCase() === "f" && !event.ctrlKey && !event.metaKey) {
      this.resetCamera();
      this.renderGame();
    }
  }
}
