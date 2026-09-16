import {
  RESOURCE_TYPES,
  addResource,
  applyFailureLoss,
  clamp,
  consumeResources,
  createRng,
  generateForest,
  randRange
} from "./core.js";

const SAVE_KEY = "dimensionalTrainSaveV1";
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d", { alpha: false });
ctx.imageSmoothingEnabled = false;

const ui = {
  menu: document.getElementById("menuScreen"),
  hud: document.getElementById("hud"),
  timer: document.getElementById("timerDisplay"),
  seed: document.getElementById("seedDisplay"),
  state: document.getElementById("stateDisplay"),
  resources: document.getElementById("resourceDisplay"),
  tool: document.getElementById("toolDisplay"),
  helpHint: document.getElementById("helpHint"),
  message: document.getElementById("message"),
  pause: document.getElementById("pauseOverlay"),
  settings: document.getElementById("settingsOverlay"),
  howTo: document.getElementById("howToOverlay"),
  workbench: document.getElementById("workbenchOverlay"),
  recipes: document.getElementById("recipeList"),
  debug: document.getElementById("debugPanel"),
  debugStats: document.getElementById("debugStats"),
  muteToggle: document.getElementById("muteToggle"),
  volumeRange: document.getElementById("volumeRange"),
  fullscreenBtn: document.getElementById("fullscreenBtn"),
  seedInput: document.getElementById("seedInput"),
  continueBtn: document.querySelector('button[data-action="continue"]')
};

const TOOL_ORDER = ["axe", "pickaxe", "sword"];
const TOOLS = {
  axe: { label: "Axe", targets: ["tree", "bush"], cooldown: 0.42, range: 66 },
  pickaxe: { label: "Pickaxe", targets: ["rock"], cooldown: 0.46, range: 66 },
  sword: { label: "Sword", targets: ["slime"], cooldown: 0.33, range: 72 }
};

const RECIPES = {
  axe: { wood: 3, fiber: 2 },
  pickaxe: { wood: 3, stone: 3 },
  sword: { stone: 4, wood: 2 }
};

const bus = new EventTarget();
const keys = new Set();
const mouse = { x: 480, y: 270, worldX: 0, worldY: 0, down: false };

function createPool(size, factory) {
  return Array.from({ length: size }, () => ({ active: false, ...factory() }));
}

function activateFromPool(pool, setup) {
  const item = pool.find((entry) => !entry.active);
  if (!item) return null;
  item.active = true;
  setup(item);
  return item;
}

class AudioSystem {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.volume = 0.6;
  }

  ensure() {
    if (!this.enabled) return;
    if (this.ctx) return;
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    } catch {
      this.enabled = false;
    }
  }

  setMuted(muted) {
    this.ensure();
    if (!this.master) return;
    this.master.gain.value = muted ? 0 : this.volume;
  }

  setVolume(value, muted) {
    this.volume = value;
    this.ensure();
    if (!this.master) return;
    this.master.gain.value = muted ? 0 : value;
  }

  tone(freq = 440, duration = 0.08, type = "square", gain = 0.09, sweep = 0) {
    this.ensure();
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const amp = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (sweep) osc.frequency.linearRampToValueAtTime(freq + sweep, now + duration);
    amp.gain.setValueAtTime(gain, now);
    amp.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(amp);
    amp.connect(this.master);
    osc.start(now);
    osc.stop(now + duration);
  }

  play(name) {
    const sounds = {
      gather: () => this.tone(420, 0.06, "square", 0.05, 90),
      pickup: () => this.tone(660, 0.08, "triangle", 0.06, 120),
      hit: () => this.tone(170, 0.09, "sawtooth", 0.06, -40),
      slash: () => this.tone(240, 0.05, "triangle", 0.04, 170),
      tick: () => this.tone(900, 0.03, "square", 0.05),
      panic: () => this.tone(1200, 0.05, "square", 0.06, -300),
      enemy: () => this.tone(140, 0.15, "sawtooth", 0.07, -45),
      horn: () => this.tone(120, 0.7, "sawtooth", 0.09, -25),
      ui: () => this.tone(520, 0.06, "triangle", 0.05, 40)
    };
    sounds[name]?.();
  }
}

const audio = new AudioSystem();

const state = {
  screen: "menu",
  modal: null,
  paused: false,
  showFps: true,
  showDebug: false,
  messageTimer: 0,
  messageText: "",
  fps: 0,
  frames: 0,
  fpsClock: 0,
  lastTickSecond: 45,
  inventoryCapacity: 20,
  inventory: { wood: 0, stone: 0, fiber: 0, apple: 0 },
  expeditionGains: { wood: 0, stone: 0, fiber: 0, apple: 0 },
  timeStreak: 0,
  trainExpanded: false,
  settings: { muted: false, volume: 0.6 },
  nextSeed: Math.floor(Math.random() * 900000) + 10000,
  currentSeed: null,
  player: {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    r: 12,
    facing: 0,
    flash: 0,
    invuln: 0,
    knockX: 0,
    knockY: 0
  },
  camera: { x: 0, y: 0 },
  equipped: "axe",
  attackCooldown: 0,
  toolState: {
    axe: { owned: true, level: 1 },
    pickaxe: { owned: true, level: 1 },
    sword: { owned: true, level: 1 }
  },
  expedition: {
    active: false,
    timer: 45,
    leftTrain: false,
    state: "idle"
  },
  world: {
    nodes: [],
    slimes: [],
    pickupApples: []
  },
  floatingTexts: createPool(80, () => ({ x: 0, y: 0, vy: 0, ttl: 0, text: "", color: "#fff" })),
  particles: createPool(200, () => ({ x: 0, y: 0, vx: 0, vy: 0, ttl: 0, color: "#fff", size: 2 }))
};

function trainBounds() {
  return state.trainExpanded
    ? { left: -390, right: 230, top: -160, bottom: 160 }
    : { left: -230, right: 230, top: -160, bottom: 160 };
}

const points = {
  spawn: { x: -120, y: 0 },
  door: { x: 230, y: 0 },
  workbench: { x: -30, y: -80 },
  storage: { x: -160, y: 85 },
  expansion: { x: 120, y: 95 }
};

function showMessage(text, duration = 2.2) {
  state.messageText = text;
  state.messageTimer = duration;
  ui.message.textContent = text;
  ui.message.classList.remove("hidden");
}

function hideMessage() {
  ui.message.classList.add("hidden");
}

function saveGame() {
  const data = {
    inventory: state.inventory,
    toolState: state.toolState,
    equipped: state.equipped,
    trainExpanded: state.trainExpanded,
    settings: state.settings,
    nextSeed: state.nextSeed
  };
  localStorage.setItem(SAVE_KEY, JSON.stringify(data));
}

function hasSave() {
  return Boolean(localStorage.getItem(SAVE_KEY));
}

function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    state.inventory = { ...state.inventory, ...(data.inventory || {}) };
    state.toolState = { ...state.toolState, ...(data.toolState || {}) };
    state.equipped = data.equipped || "axe";
    state.trainExpanded = Boolean(data.trainExpanded);
    state.settings = { ...state.settings, ...(data.settings || {}) };
    state.nextSeed = Number(data.nextSeed) || state.nextSeed;
    audio.setVolume(state.settings.volume, state.settings.muted);
    return true;
  } catch {
    return false;
  }
}

function resetProfile() {
  localStorage.removeItem(SAVE_KEY);
  state.inventory = { wood: 0, stone: 0, fiber: 0, apple: 0 };
  state.expeditionGains = { wood: 0, stone: 0, fiber: 0, apple: 0 };
  state.toolState = {
    axe: { owned: true, level: 1 },
    pickaxe: { owned: true, level: 1 },
    sword: { owned: true, level: 1 }
  };
  state.trainExpanded = false;
  state.nextSeed = Math.floor(Math.random() * 900000) + 10000;
  state.equipped = "axe";
}

function resetRun() {
  state.player.x = points.spawn.x;
  state.player.y = points.spawn.y;
  state.player.vx = 0;
  state.player.vy = 0;
  state.expedition.active = false;
  state.expedition.timer = 45;
  state.expedition.leftTrain = false;
  state.expedition.state = "idle";
  state.currentSeed = null;
  state.expeditionGains = { wood: 0, stone: 0, fiber: 0, apple: 0 };
  state.world.nodes.length = 0;
  state.world.slimes.length = 0;
  state.world.pickupApples.length = 0;
  state.timeStreak = 0;
}

function openScreen(screen) {
  state.screen = screen;
  ui.menu.classList.toggle("hidden", screen !== "menu");
  ui.hud.classList.toggle("hidden", screen !== "playing");
}

function openModal(name) {
  state.modal = name;
  ui.pause.classList.toggle("hidden", name !== "pause");
  ui.settings.classList.toggle("hidden", name !== "settings");
  ui.howTo.classList.toggle("hidden", name !== "howto");
  ui.workbench.classList.toggle("hidden", name !== "workbench");
}

function closeModal() {
  openModal(null);
}

function startGame(fromSave = false) {
  if (!fromSave) {
    resetProfile();
    saveGame();
  }
  resetRun();
  openScreen("playing");
  closeModal();
}

function inventoryUsed() {
  return RESOURCE_TYPES.reduce((sum, type) => sum + (state.inventory[type] || 0), 0);
}

function gainResource(type, amount) {
  const added = addResource(state.inventory, type, amount, state.inventoryCapacity);
  if (added > 0 && state.expedition.active) {
    state.expeditionGains[type] += added;
  }
  bus.dispatchEvent(new Event("inventory"));
  if (added < amount) showMessage("Inventory full (20 slots)", 1.3);
  return added;
}

function spendResources(costs) {
  const ok = consumeResources(state.inventory, costs);
  if (ok) bus.dispatchEvent(new Event("inventory"));
  return ok;
}

function spawnText(x, y, text, color = "#ffffff") {
  activateFromPool(state.floatingTexts, (item) => {
    item.x = x;
    item.y = y;
    item.vy = -14;
    item.ttl = 0.9;
    item.text = text;
    item.color = color;
  });
}

function spawnParticles(x, y, color, count = 8) {
  const rng = createRng((x * 13.7 + y * 41.9) | 0);
  for (let i = 0; i < count; i += 1) {
    activateFromPool(state.particles, (p) => {
      p.x = x;
      p.y = y;
      p.vx = randRange(rng, -80, 80);
      p.vy = randRange(rng, -90, 15);
      p.ttl = randRange(rng, 0.2, 0.55);
      p.color = color;
      p.size = randRange(rng, 1, 3);
    });
  }
}

function inSafeZone() {
  return Math.hypot(state.player.x - points.spawn.x, state.player.y - points.spawn.y) < 120;
}

function nearPoint(point, radius = 40) {
  return Math.hypot(state.player.x - point.x, state.player.y - point.y) <= radius;
}

function generateExpedition(seed = state.nextSeed) {
  const created = generateForest(seed, {
    safeX: points.door.x + 70,
    safeY: 0,
    minX: 280,
    count: 170,
    slimeCount: 11
  });
  state.world.nodes = created.resources.map((node) => ({
    ...node,
    r: node.kind === "rock" ? 18 : node.kind === "tree" ? 16 : 14,
    maxHp: node.hp,
    flash: 0
  }));
  state.world.slimes = created.slimes.map((slime, index) => ({
    id: `slime-${seed}-${index}`,
    x: slime.x,
    y: slime.y,
    vx: 0,
    vy: 0,
    r: 13,
    hp: 3,
    state: "idle",
    cool: randRange(createRng(seed + index), 0.3, 1.2),
    flash: 0,
    wander: randRange(createRng(seed + index * 21), 0.5, 1.7)
  }));
  state.world.pickupApples.length = 0;
  state.currentSeed = seed;
  state.nextSeed = seed + 1;
}

function startExpedition() {
  generateExpedition(state.nextSeed);
  state.expedition.active = true;
  state.expedition.timer = 45;
  state.expedition.leftTrain = false;
  state.expedition.state = "exploring";
  state.expeditionGains = { wood: 0, stone: 0, fiber: 0, apple: 0 };
  state.lastTickSecond = 45;
  showMessage(`Expedition started. Seed ${state.currentSeed}`);
  saveGame();
}

function finishExpeditionSuccess() {
  state.expedition.active = false;
  state.expedition.state = "success";
  state.expedition.timer = 45;
  state.expedition.leftTrain = false;
  state.timeStreak = 0;
  showMessage("Extraction successful. Resources secured.", 2.8);
  audio.play("ui");
  saveGame();
}

function failExpedition() {
  state.expedition.active = false;
  state.expedition.state = "failed";
  const losses = applyFailureLoss(state.inventory, state.expeditionGains, 0.5);
  state.expedition.timer = 45;
  state.expedition.leftTrain = false;
  state.timeStreak = 0;
  state.player.x = points.spawn.x;
  state.player.y = points.spawn.y;
  state.player.vx = 0;
  state.player.vy = 0;
  const parts = Object.entries(losses).map(([k, v]) => `${k}-${v}`);
  showMessage(parts.length ? `Train departed! Lost 50% unrefined: ${parts.join(", ")}` : "Train departed!", 3.2);
  audio.play("horn");
  bus.dispatchEvent(new Event("inventory"));
  saveGame();
}

function recoverTime(amount) {
  if (!state.expedition.active) return;
  const before = state.expedition.timer;
  state.expedition.timer = clamp(state.expedition.timer + amount, 0, 45);
  if (state.expedition.timer > before) {
    spawnText(state.player.x, state.player.y - 28, `+${amount} SEC`, "#81ff8d");
    audio.play("pickup");
  }
}

function currentInteractionHint() {
  if (nearPoint(points.door, 38)) {
    if (!state.expedition.active) return "Press E: Depart Expedition";
    if (state.expedition.active && inSafeZone() && state.expedition.leftTrain) return "Extraction zone reached";
  }
  if (nearPoint(points.workbench, 42)) return "Press E: Workbench";
  if (nearPoint(points.storage, 42)) return "Storage Bay";
  if (!state.trainExpanded && nearPoint(points.expansion, 42)) return "Press E: Expand Train (Wood 8, Stone 6)";
  return "";
}

function slimeHitPlayer(slime) {
  if (state.player.invuln > 0) return;
  state.player.invuln = 0.65;
  state.player.flash = 0.18;
  const dx = state.player.x - slime.x;
  const dy = state.player.y - slime.y;
  const len = Math.hypot(dx, dy) || 1;
  state.player.knockX += (dx / len) * 180;
  state.player.knockY += (dy / len) * 180;
  if (state.expedition.active && !inSafeZone()) {
    state.expedition.timer = Math.max(0, state.expedition.timer - 3);
    spawnText(state.player.x, state.player.y - 22, "-3 SEC", "#ff7474");
    state.timeStreak = 0;
    audio.play("enemy");
  }
}

function damageSlime(slime, dmg = 1) {
  slime.hp -= dmg;
  slime.flash = 0.13;
  spawnParticles(slime.x, slime.y, "#7df4a4", 9);
  spawnText(slime.x, slime.y - 20, `-${dmg}`, "#d5ffd8");
  if (slime.hp <= 0) {
    slime.dead = true;
    if (Math.random() < 0.2) {
      state.world.pickupApples.push({ x: slime.x, y: slime.y, r: 8, ttl: 20 });
    }
  }
}

function attack() {
  if (state.attackCooldown > 0 || state.screen !== "playing" || state.modal) return;
  const tool = state.equipped;
  const info = TOOLS[tool];
  const owned = state.toolState[tool]?.owned;
  if (!owned) {
    showMessage(`${info.label} not owned. Craft it at workbench.`, 1.7);
    return;
  }

  const gatherBoost = 1 + Math.min(0.5, state.timeStreak * 0.03);
  state.attackCooldown = info.cooldown / gatherBoost;

  if (tool === "sword") {
    audio.play("slash");
    let hit = false;
    for (const slime of state.world.slimes) {
      if (slime.dead) continue;
      const d = Math.hypot(slime.x - state.player.x, slime.y - state.player.y);
      if (d <= info.range) {
        const dx = slime.x - state.player.x;
        const dy = slime.y - state.player.y;
        const ang = Math.atan2(dy, dx);
        let delta = Math.abs(ang - state.player.facing);
        if (delta > Math.PI) delta = Math.abs(delta - Math.PI * 2);
        if (delta <= 0.95) {
          damageSlime(slime, 1 + Math.floor((state.toolState.sword.level - 1) / 2));
          const push = 120;
          slime.vx += Math.cos(ang) * push;
          slime.vy += Math.sin(ang) * push;
          hit = true;
        }
      }
    }
    if (hit) audio.play("hit");
    return;
  }

  let target = null;
  let minDist = Infinity;
  for (const node of state.world.nodes) {
    if (node.hp <= 0) continue;
    if (!info.targets.includes(node.kind)) continue;
    const d = Math.hypot(node.x - state.player.x, node.y - state.player.y);
    if (d <= info.range && d < minDist) {
      minDist = d;
      target = node;
    }
  }

  if (!target) return;
  target.hp -= 1;
  target.flash = 0.1;
  state.timeStreak += 1;
  spawnParticles(target.x, target.y, target.kind === "rock" ? "#a9b0c8" : "#86d76b", 8);
  audio.play("gather");
  if (target.hp <= 0) {
    target.hp = 0;
    if (target.kind === "tree") {
      gainResource("wood", 2 + (Math.random() < 0.5 ? 1 : 0));
      gainResource("fiber", Math.random() < 0.5 ? 1 : 0);
    } else if (target.kind === "rock") {
      gainResource("stone", 2 + (Math.random() < 0.5 ? 1 : 0));
    } else {
      gainResource("fiber", 1 + (Math.random() < 0.6 ? 1 : 0));
      if (Math.random() < 0.65) {
        state.world.pickupApples.push({ x: target.x + randRange(Math.random, -8, 8), y: target.y + randRange(Math.random, -8, 8), r: 8, ttl: 18 });
      }
    }
  }
}

function interact() {
  if (state.screen !== "playing") return;
  if (state.modal === "workbench") {
    closeModal();
    return;
  }
  if (nearPoint(points.workbench, 42)) {
    openModal("workbench");
    return;
  }
  if (!state.trainExpanded && nearPoint(points.expansion, 42)) {
    if (spendResources({ wood: 8, stone: 6 })) {
      state.trainExpanded = true;
      spawnParticles(points.expansion.x, points.expansion.y, "#ffe57a", 22);
      showMessage("Train expansion constructed.");
      saveGame();
    } else {
      showMessage("Need Wood 8 + Stone 6", 1.4);
    }
    return;
  }
  if (nearPoint(points.storage, 42)) {
    showMessage(`Storage ${inventoryUsed()}/${state.inventoryCapacity}`);
    return;
  }

  if (nearPoint(points.door, 38)) {
    if (!state.expedition.active) startExpedition();
  }
}

function updateSlimes(dt) {
  for (const slime of state.world.slimes) {
    if (slime.dead) continue;
    slime.flash = Math.max(0, slime.flash - dt);
    slime.cool -= dt;
    const dx = state.player.x - slime.x;
    const dy = state.player.y - slime.y;
    const dist = Math.hypot(dx, dy) || 1;

    if (dist < 30 && slime.cool <= 0) {
      slime.state = "attack";
      slime.cool = 0.75;
      slimeHitPlayer(slime);
    } else if (dist < 240) {
      slime.state = "chase";
      slime.vx += (dx / dist) * 240 * dt;
      slime.vy += (dy / dist) * 240 * dt;
    } else {
      slime.state = "idle";
      slime.wander -= dt;
      if (slime.wander <= 0) {
        slime.wander = randRange(Math.random, 0.6, 1.6);
        slime.vx += randRange(Math.random, -80, 80);
        slime.vy += randRange(Math.random, -80, 80);
      }
    }

    slime.vx *= 0.88;
    slime.vy *= 0.88;
    slime.x += slime.vx * dt;
    slime.y += slime.vy * dt;
  }

  state.world.slimes = state.world.slimes.filter((s) => !s.dead);
}

function updatePickups(dt) {
  for (const item of state.world.pickupApples) {
    item.ttl -= dt;
    if (item.ttl <= 0) {
      item.dead = true;
      continue;
    }
    const d = Math.hypot(item.x - state.player.x, item.y - state.player.y);
    if (d < state.player.r + item.r + 2) {
      const added = gainResource("apple", 1);
      if (added > 0) {
        recoverTime(3);
      }
      item.dead = true;
    }
  }
  state.world.pickupApples = state.world.pickupApples.filter((p) => !p.dead);
}

function movePlayer(dt) {
  const xInput = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
  const yInput = (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0) - (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0);
  const accel = 680;
  const maxSpeed = 180;

  state.player.vx += xInput * accel * dt;
  state.player.vy += yInput * accel * dt;

  const drag = xInput === 0 && yInput === 0 ? 0.82 : 0.92;
  state.player.vx *= drag;
  state.player.vy *= drag;

  state.player.vx += state.player.knockX * dt;
  state.player.vy += state.player.knockY * dt;
  state.player.knockX *= 0.82;
  state.player.knockY *= 0.82;

  const speed = Math.hypot(state.player.vx, state.player.vy);
  if (speed > maxSpeed) {
    const scale = maxSpeed / speed;
    state.player.vx *= scale;
    state.player.vy *= scale;
  }

  state.player.x += state.player.vx * dt;
  handleCollisions("x");
  state.player.y += state.player.vy * dt;
  handleCollisions("y");

  const wx = state.camera.x - canvas.width / 2 + mouse.x;
  const wy = state.camera.y - canvas.height / 2 + mouse.y;
  mouse.worldX = wx;
  mouse.worldY = wy;
  state.player.facing = Math.atan2(mouse.worldY - state.player.y, mouse.worldX - state.player.x);
}

function handleCollisions(axis) {
  const bounds = trainBounds();
  const p = state.player;
  const inTrainRect = p.x > bounds.left && p.x < bounds.right && p.y > bounds.top && p.y < bounds.bottom;
  const doorGap = Math.abs(p.y - points.door.y) < 42;

  if (inTrainRect) {
    if (p.x < bounds.left + p.r) p.x = bounds.left + p.r;
    if (p.x > bounds.right - p.r && !doorGap) p.x = bounds.right - p.r;
    if (p.y < bounds.top + p.r) p.y = bounds.top + p.r;
    if (p.y > bounds.bottom - p.r) p.y = bounds.bottom - p.r;
  }

  if (p.x < -420) p.x = -420;
  if (p.x > 1880) p.x = 1880;
  if (p.y < -760) p.y = -760;
  if (p.y > 760) p.y = 760;

  for (const node of state.world.nodes) {
    if (node.hp <= 0) continue;
    const dx = p.x - node.x;
    const dy = p.y - node.y;
    const dist = Math.hypot(dx, dy);
    const min = p.r + node.r;
    if (dist > 0 && dist < min) {
      const push = (min - dist) / dist;
      if (axis === "x") p.x += dx * push;
      if (axis === "y") p.y += dy * push;
    }
  }
}

function updateWorld(dt) {
  state.attackCooldown = Math.max(0, state.attackCooldown - dt);
  state.player.flash = Math.max(0, state.player.flash - dt);
  state.player.invuln = Math.max(0, state.player.invuln - dt);

  movePlayer(dt);
  updateSlimes(dt);
  updatePickups(dt);

  for (const node of state.world.nodes) node.flash = Math.max(0, node.flash - dt);

  if (state.expedition.active && !inSafeZone()) {
    state.expedition.leftTrain = true;
    state.expedition.timer = Math.max(0, state.expedition.timer - dt);
    const second = Math.ceil(state.expedition.timer);
    if (second !== state.lastTickSecond && second <= 10 && second >= 0) {
      state.lastTickSecond = second;
      audio.play(second <= 5 ? "panic" : "tick");
    }
    if (state.expedition.timer <= 0) {
      failExpedition();
    }
  }

  if (state.expedition.active && inSafeZone() && state.expedition.leftTrain) {
    state.expedition.state = "ready_extract";
    finishExpeditionSuccess();
  }

  for (const text of state.floatingTexts) {
    if (!text.active) continue;
    text.ttl -= dt;
    if (text.ttl <= 0) {
      text.active = false;
      continue;
    }
    text.y += text.vy * dt;
  }

  for (const p of state.particles) {
    if (!p.active) continue;
    p.ttl -= dt;
    if (p.ttl <= 0) {
      p.active = false;
      continue;
    }
    p.vy += 160 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }

  state.camera.x += (state.player.x - state.camera.x) * 0.12;
  state.camera.y += (state.player.y - state.camera.y) * 0.12;
}

function drawNode(node) {
  const hit = node.flash > 0;
  if (node.kind === "tree") {
    ctx.fillStyle = hit ? "#d8ffa4" : "#3d8f4f";
    ctx.fillRect(node.x - 10, node.y - 14, 20, 22);
    ctx.fillStyle = "#7c4f2f";
    ctx.fillRect(node.x - 3, node.y + 8, 6, 10);
  } else if (node.kind === "rock") {
    ctx.fillStyle = hit ? "#f0f4ff" : "#7a8597";
    ctx.beginPath();
    ctx.moveTo(node.x - 12, node.y + 8);
    ctx.lineTo(node.x - 4, node.y - 12);
    ctx.lineTo(node.x + 10, node.y - 9);
    ctx.lineTo(node.x + 13, node.y + 9);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.fillStyle = hit ? "#d0ff95" : "#64a34f";
    ctx.beginPath();
    ctx.arc(node.x, node.y, 12, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawWorld() {
  ctx.fillStyle = "#14211e";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.translate(canvas.width / 2 - state.camera.x, canvas.height / 2 - state.camera.y);

  const bounds = trainBounds();

  ctx.fillStyle = "#21303b";
  ctx.fillRect(250, -760, 1700, 1520);

  ctx.fillStyle = "#2a2f45";
  ctx.fillRect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top);
  ctx.strokeStyle = "#738aa5";
  ctx.strokeRect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top);

  ctx.fillStyle = "#58496b";
  ctx.fillRect(points.door.x - 8, points.door.y - 40, 16, 80);

  ctx.fillStyle = "#8d7240";
  ctx.fillRect(points.workbench.x - 20, points.workbench.y - 10, 40, 20);

  ctx.fillStyle = "#556070";
  ctx.fillRect(points.storage.x - 18, points.storage.y - 18, 36, 36);

  ctx.fillStyle = state.trainExpanded ? "#8fcf8f" : "#7c5454";
  ctx.fillRect(points.expansion.x - 20, points.expansion.y - 12, 40, 24);

  ctx.strokeStyle = "rgba(147,189,214,0.25)";
  ctx.beginPath();
  ctx.arc(points.spawn.x, points.spawn.y, 120, 0, Math.PI * 2);
  ctx.stroke();

  for (const node of state.world.nodes) {
    if (node.hp > 0) drawNode(node);
  }

  for (const apple of state.world.pickupApples) {
    ctx.fillStyle = "#e85d5d";
    ctx.beginPath();
    ctx.arc(apple.x, apple.y, apple.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#89d882";
    ctx.fillRect(apple.x - 1, apple.y - 10, 2, 4);
  }

  for (const slime of state.world.slimes) {
    ctx.fillStyle = slime.flash > 0 ? "#d3ffe7" : "#56d89c";
    ctx.beginPath();
    ctx.arc(slime.x, slime.y, slime.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#102d1f";
    ctx.fillRect(slime.x - 5, slime.y - 3, 3, 3);
    ctx.fillRect(slime.x + 2, slime.y - 3, 3, 3);
  }

  for (const p of state.particles) {
    if (!p.active) continue;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, p.size, p.size);
  }

  const playerColor = state.player.flash > 0 ? "#ffd4d4" : "#f6f6f6";
  ctx.save();
  ctx.translate(state.player.x, state.player.y);
  ctx.rotate(state.player.facing);
  ctx.fillStyle = playerColor;
  ctx.beginPath();
  ctx.moveTo(14, 0);
  ctx.lineTo(-10, 9);
  ctx.lineTo(-10, -9);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = "#ffffff";
  ctx.font = "12px monospace";
  for (const t of state.floatingTexts) {
    if (!t.active) continue;
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, t.x, t.y);
  }

  ctx.restore();
}

function refreshHud() {
  const timer = state.expedition.active ? state.expedition.timer : 45;
  ui.timer.textContent = `${timer.toFixed(1)}s`;
  ui.timer.style.color = timer <= 5 ? "#ff6060" : timer <= 10 ? "#ffd76b" : "#f7f7f7";
  ui.seed.textContent = `Seed: ${state.currentSeed ?? state.nextSeed}`;

  const zone = inSafeZone() ? "Train Safe Zone" : "Expedition Zone";
  const exState = state.expedition.active ? `Expedition (${state.expedition.state})` : "Idle";
  ui.state.textContent = `${zone} • ${exState}`;

  ui.resources.textContent = `Wood ${state.inventory.wood} • Stone ${state.inventory.stone} • Fiber ${state.inventory.fiber} • Apple ${state.inventory.apple} • Slots ${inventoryUsed()}/${state.inventoryCapacity}`;

  const eqLabel = TOOLS[state.equipped].label;
  ui.tool.textContent = `Tool: ${eqLabel} (${state.toolState[state.equipped].owned ? "Owned" : "Missing"}) • Streak ${state.timeStreak}`;

  const hint = currentInteractionHint();
  ui.helpHint.textContent = hint || "E: interact • 1/2/3 tools • ESC pause • F1 debug";

  ui.debugStats.textContent = [
    `FPS: ${state.fps}`,
    `Entities: nodes ${state.world.nodes.filter((n) => n.hp > 0).length}, slimes ${state.world.slimes.length}, apples ${state.world.pickupApples.length}`,
    `Seed: ${state.currentSeed ?? state.nextSeed}`,
    `Pos: ${state.player.x.toFixed(1)}, ${state.player.y.toFixed(1)}`,
    `Timer: ${timer.toFixed(2)}`,
    `State: ${state.screen}/${state.modal ?? "none"}/${state.expedition.state}`
  ].join("\n");
}

function refreshRecipes() {
  ui.recipes.innerHTML = "";
  for (const tool of TOOL_ORDER) {
    const row = document.createElement("div");
    row.className = "recipe";
    const costs = RECIPES[tool];
    const costText = Object.entries(costs)
      .map(([key, value]) => `${key}:${value}`)
      .join(" ");
    const btn = document.createElement("button");
    btn.textContent = state.toolState[tool].owned ? `Upgrade ${TOOLS[tool].label} (Lv ${state.toolState[tool].level})` : `Craft ${TOOLS[tool].label}`;
    btn.addEventListener("click", () => {
      if (!spendResources(costs)) {
        showMessage("Not enough resources.", 1.2);
        return;
      }
      state.toolState[tool].owned = true;
      state.toolState[tool].level += 1;
      showMessage(`${TOOLS[tool].label} ready.`, 1.5);
      audio.play("ui");
      saveGame();
      refreshRecipes();
    });

    const text = document.createElement("div");
    text.textContent = `${TOOLS[tool].label} (${costText})`;

    row.append(text, btn);
    ui.recipes.appendChild(row);
  }
}

function togglePause() {
  if (state.screen !== "playing" || state.modal === "workbench") return;
  if (state.modal === "pause") {
    closeModal();
    state.paused = false;
  } else {
    openModal("pause");
    state.paused = true;
  }
}

function applySettingsToUi() {
  ui.muteToggle.checked = state.settings.muted;
  ui.volumeRange.value = String(state.settings.volume);
  ui.seedInput.value = String(state.nextSeed);
  audio.setVolume(state.settings.volume, state.settings.muted);
}

function refreshContinueAvailability() {
  ui.continueBtn.disabled = !hasSave();
}

function setupUi() {
  document.querySelectorAll("button[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      audio.play("ui");
      const action = btn.getAttribute("data-action");
      if (action === "start") startGame(false);
      if (action === "continue") {
        if (!loadGame()) {
          showMessage("No save found.", 1.3);
          refreshContinueAvailability();
          return;
        }
        startGame(true);
      }
      if (action === "settings") openModal("settings");
      if (action === "howto") openModal("howto");
      if (action === "reset") {
        if (window.confirm("Reset all save data?")) {
          resetProfile();
          saveGame();
          showMessage("Save reset.", 1.5);
          refreshContinueAvailability();
        }
      }
      if (action === "resume") {
        state.paused = false;
        closeModal();
      }
      if (action === "menu") {
        state.paused = false;
        closeModal();
        openScreen("menu");
        saveGame();
      }
      if (action === "closeSettings" || action === "closeHowTo" || action === "closeWorkbench") {
        closeModal();
      }
    });
  });

  document.querySelectorAll("button[data-debug]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.getAttribute("data-debug");
      if (action === "addResources") {
        gainResource("wood", 5); gainResource("stone", 5); gainResource("fiber", 5); gainResource("apple", 5);
      }
      if (action === "addTime") recoverTime(5);
      if (action === "subTime") state.expedition.timer = Math.max(0, state.expedition.timer - 5);
      if (action === "spawnSlime") {
        state.world.slimes.push({ id: `debug-${Date.now()}`, x: state.player.x + 80, y: state.player.y, vx: 0, vy: 0, r: 13, hp: 3, state: "idle", cool: 0, flash: 0, wander: 1 });
      }
      if (action === "killSlimes") state.world.slimes.length = 0;
      if (action === "regen") generateExpedition(state.currentSeed ?? state.nextSeed);
      if (action === "expandTrain") state.trainExpanded = true;
      if (action === "resetRun") resetRun();
      if (action === "toggleFps") state.showFps = !state.showFps;
      if (action === "applySeed") {
        const num = Number(ui.seedInput.value);
        if (Number.isFinite(num)) {
          state.nextSeed = num;
          generateExpedition(num);
        }
      }
      saveGame();
    });
  });

  ui.muteToggle.addEventListener("change", () => {
    state.settings.muted = ui.muteToggle.checked;
    audio.setMuted(state.settings.muted);
    saveGame();
  });

  ui.volumeRange.addEventListener("input", () => {
    state.settings.volume = Number(ui.volumeRange.value);
    audio.setVolume(state.settings.volume, state.settings.muted);
    saveGame();
  });

  ui.fullscreenBtn.addEventListener("click", () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  });

  window.addEventListener("keydown", (event) => {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) event.preventDefault();
    if (event.code === "F1") {
      event.preventDefault();
      state.showDebug = !state.showDebug;
      ui.debug.classList.toggle("hidden", !state.showDebug);
      return;
    }
    if (event.code === "Escape") {
      event.preventDefault();
      togglePause();
      return;
    }
    if (event.code === "KeyE") {
      audio.ensure();
      interact();
      return;
    }
    if (event.code === "Digit1") state.equipped = "axe";
    if (event.code === "Digit2") state.equipped = "pickaxe";
    if (event.code === "Digit3") state.equipped = "sword";
    keys.add(event.code);
  });

  window.addEventListener("keyup", (event) => {
    keys.delete(event.code);
  });

  canvas.addEventListener("mousemove", (event) => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * canvas.width;
    mouse.y = ((event.clientY - rect.top) / rect.height) * canvas.height;
  });

  canvas.addEventListener("mousedown", () => {
    mouse.down = true;
    audio.ensure();
    attack();
  });

  canvas.addEventListener("mouseup", () => {
    mouse.down = false;
  });

  bus.addEventListener("inventory", () => {
    refreshRecipes();
    saveGame();
  });

  applySettingsToUi();
  refreshContinueAvailability();
}

setupUi();
openScreen("menu");
openModal(null);
refreshRecipes();

let last = performance.now();
function loop(now) {
  let dt = (now - last) / 1000;
  last = now;
  dt = Math.min(dt, 0.05);

  state.frames += 1;
  state.fpsClock += dt;
  if (state.fpsClock >= 1) {
    state.fps = state.frames;
    state.frames = 0;
    state.fpsClock = 0;
  }

  if (state.screen === "playing" && !state.paused && !state.modal) {
    updateWorld(dt);
  }

  drawWorld();
  refreshHud();

  if (state.messageTimer > 0) {
    state.messageTimer -= dt;
    if (state.messageTimer <= 0) hideMessage();
  }

  if (!state.showFps && ui.debugStats.textContent.includes("FPS")) {
    ui.debugStats.textContent = ui.debugStats.textContent.replace(/FPS:[^\n]*\n?/, "");
  }

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
