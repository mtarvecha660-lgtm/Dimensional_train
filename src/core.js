export const RESOURCE_TYPES = ["wood", "stone", "fiber", "apple"];

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function createRng(seed) {
  let t = Number(seed) || 1;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function randRange(rng, min, max) {
  return min + (max - min) * rng();
}

export function addResource(inventory, type, amount, capacity) {
  const used = RESOURCE_TYPES.reduce((sum, key) => sum + (inventory[key] || 0), 0);
  const free = Math.max(0, capacity - used);
  const added = Math.max(0, Math.min(amount, free));
  inventory[type] = (inventory[type] || 0) + added;
  return added;
}

export function consumeResources(inventory, costs) {
  const enough = Object.entries(costs).every(([type, amount]) => (inventory[type] || 0) >= amount);
  if (!enough) return false;
  for (const [type, amount] of Object.entries(costs)) {
    inventory[type] -= amount;
  }
  return true;
}

export function applyFailureLoss(inventory, expeditionGains, fraction = 0.5) {
  const losses = {};
  for (const type of RESOURCE_TYPES) {
    const gain = expeditionGains[type] || 0;
    const loss = Math.ceil(gain * fraction);
    if (loss > 0) {
      inventory[type] = Math.max(0, (inventory[type] || 0) - loss);
      losses[type] = loss;
    }
  }
  return losses;
}

export function generateForest(seed, options = {}) {
  const rng = createRng(seed);
  const config = {
    width: options.width ?? 1400,
    height: options.height ?? 1200,
    minX: options.minX ?? 280,
    safeX: options.safeX ?? 300,
    safeY: options.safeY ?? 0,
    safeRadius: options.safeRadius ?? 200,
    count: options.count ?? 150,
    slimeCount: options.slimeCount ?? 10
  };

  const resources = [];
  const slimes = [];

  for (let i = 0; i < config.count; i += 1) {
    const x = randRange(rng, config.minX, config.minX + config.width);
    const y = randRange(rng, -config.height / 2, config.height / 2);
    const nearSafe = Math.hypot(x - config.safeX, y - config.safeY) < config.safeRadius;
    const corridor = x < config.minX + 300 && Math.abs(y) < 70;
    if (nearSafe || corridor) continue;

    const roll = rng();
    let kind = "tree";
    if (roll > 0.68) kind = "rock";
    if (roll > 0.86) kind = "bush";

    resources.push({
      id: `r${i}`,
      kind,
      x,
      y,
      hp: kind === "rock" ? 4 : kind === "tree" ? 3 : 2
    });
  }

  for (let i = 0; i < config.slimeCount; i += 1) {
    const x = randRange(rng, config.minX + 220, config.minX + config.width);
    const y = randRange(rng, -config.height / 2 + 80, config.height / 2 - 80);
    if (Math.hypot(x - config.safeX, y - config.safeY) < config.safeRadius + 120) continue;
    slimes.push({ id: `s${i}`, x, y, hp: 3 });
  }

  return { resources, slimes };
}
