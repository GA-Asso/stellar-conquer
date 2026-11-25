// IA del rival: economía, expansión de la estación, eras, conquista de planetas y oleadas.
import { ERA_UP, MODULES, UNITS } from './defs';
import { hexDist, worldToHex } from './hex';
import {
  asteroids, canAfford, canPlace, coreOf, dist, freePorts, modules, planets, popCap, popUsed, units,
} from './sim';
import type { Command, ModuleType, Side, SimState, Unit, UnitType, Vec } from './types';

export type Difficulty = 'facil' | 'normal' | 'dificil';

export interface AiMemory {
  side: Side;
  difficulty: Difficulty;
  wave: number;
  nextWaveTick: number;
  raiders: Set<number>;
}

export function createAi(side: Side, difficulty: Difficulty = 'normal'): AiMemory {
  const first = { facil: 9 * 60, normal: 6 * 60, dificil: 4 * 60 }[difficulty] * 20;
  return { side, difficulty, wave: 0, nextWaveTick: first, raiders: new Set() };
}

const DRONES_BY_ERA = [0, 12, 18, 24, 28];

// orden de construcción: [módulo, cuántos debe haber]
const PLAN: [ModuleType, number][] = [
  ['habitat', 1], ['solar', 1], ['hangar', 1], ['factory', 1], ['lab', 1], ['habitat', 2], ['solar', 2],
  ['anchor', 1], ['turret', 1], ['habitat', 3], ['hangar', 2], ['solar', 3], ['turret', 2], ['factory', 2],
  ['habitat', 4], ['solar', 4], ['habitat', 5], ['beacon', 1],
];

export function aiThink(s: SimState, mem: AiMemory): Command[] {
  const side = mem.side;
  const pl = s.players[side];
  if (!pl.alive || s.winner !== null) return [];
  const out: Command[] = [];
  const core = coreOf(s, side);
  if (!core) return out;
  const my = units(s, side);
  const mods = modules(s, side);
  const drones = my.filter(u => u.type === 'drone');
  const army = my.filter(u => u.type !== 'drone');
  const used = popUsed(s, side), cap = popCap(s, side);
  const reserve = { lumens: 0, metal: 0, energy: 0 };

  // 1) drones
  const wantDrones = DRONES_BY_ERA[pl.era];
  if (drones.length < wantDrones && core.queue.length < 2 && used < cap && canAfford(pl.res, UNITS.drone.cost)) {
    out.push({ kind: 'train', module: core.id, unit: 'drone' });
  }

  // 2) expansión de la estación
  const building = mods.find(m => m.built < 1);
  if (building) {
    const helpers = drones.filter(d => d.order.kind === 'build' && d.order.target === building.id);
    if (helpers.length === 0) {
      const d = closest(drones, building.pos);
      if (d) out.push({ kind: 'repair', units: [d.id], target: building.id });
    }
  } else {
    let want: ModuleType | null = null;
    if (cap - used <= 3 && cap < 120) want = 'habitat';
    else {
      for (const [type, n] of PLAN) {
        if (pl.era < MODULES[type].era) continue;
        if (mods.filter(m => m.type === type).length < n) { want = type; break; }
      }
    }
    if (want && canAfford(pl.res, MODULES[want].cost)) {
      const hex = pickSpot(s, side, want);
      const builders = drones.filter(d => d.order.kind !== 'build').sort((a, b) => dist(a.pos, core.pos) - dist(b.pos, core.pos)).slice(0, want === 'beacon' ? 5 : 2);
      if (hex && builders.length) out.push({ kind: 'build', units: builders.map(b => b.id), module: want, hex });
    } else if (want) {
      Object.assign(reserve, MODULES[want].cost);
    }
  }

  // 3) era
  const next = pl.era + 1;
  if (next <= 4 && !core.queue.some(q => q.item === 'era') && mods.some(m => m.type === 'lab' && m.built >= 1)
    && drones.length >= wantDrones - 3) {
    const up = ERA_UP[next as 2 | 3 | 4];
    if (canAfford(pl.res, up.cost)) out.push({ kind: 'era', module: core.id });
    else Object.assign(reserve, up.cost);
  }

  // 4) recolección: drones ociosos al recurso que más falta
  const idle = drones.filter(d => d.order.kind === 'idle');
  if (idle.length) {
    const gathering = drones.filter(d => d.order.kind === 'gather');
    const onLumen = gathering.filter(d => {
      const t = d.order.kind === 'gather' ? s.entities.get(d.order.target) : undefined;
      return t?.kind === 'asteroid' && t.res === 'lumen';
    }).length;
    for (const d of idle) {
      const res = onLumen <= gathering.length - onLumen ? 'lumen' : 'metal';
      const a = bestAsteroid(s, side, res) ?? bestAsteroid(s, side, res === 'lumen' ? 'metal' : 'lumen');
      if (a) out.push({ kind: 'gather', units: [d.id], target: a });
    }
  }

  // 5) ejército
  const spare = (k: 'lumens' | 'metal' | 'energy') => pl.res[k] - reserve[k];
  for (const m of mods) {
    if (m.built < 1 || m.queue.length >= 2 || m.type === 'core') continue;
    const options = MODULES[m.type].trains.filter(t => UNITS[t].era <= pl.era).reverse();
    for (const t of options) {
      const c = UNITS[t].cost;
      if (spare('lumens') >= c.lumens && spare('metal') >= c.metal && spare('energy') >= c.energy && used + UNITS[t].pop <= cap) {
        out.push({ kind: 'train', module: m.id, unit: t as UnitType });
        break;
      }
    }
  }

  // 6) defensa: si hay enemigos cerca de la estación, todo el ejército ocioso acude
  const threat = units(s).find(u => u.side !== side && mods.some(m => dist(m.pos, u.pos) < 70));
  if (threat) {
    const free = army.filter(u => !mem.raiders.has(u.id) && u.order.kind !== 'attack');
    if (free.length) out.push({ kind: 'attack', units: free.map(u => u.id), target: threat.id });
  }

  // 7) robots a conquistar planetas
  const robots = army.filter(u => UNITS[u.type].cls === 'robot' && u.order.kind === 'idle' && !mem.raiders.has(u.id));
  if (robots.length >= 2) {
    const target = planets(s)
      .filter(p => p.owner !== side)
      .sort((a, b) => dist(a.pos, core.pos) - dist(b.pos, core.pos))[0];
    if (target) {
      const group = robots.slice(0, 3);
      out.push({ kind: 'move', units: group.map(r => r.id), to: { x: target.pos.x, z: target.pos.z + target.radius + 2 }, aggressive: true });
    }
  }

  // 8) oleadas contra el núcleo enemigo
  for (const id of mem.raiders) if (!s.entities.has(id)) mem.raiders.delete(id);
  const minWave = { facil: 6, normal: 8, dificil: 10 }[mem.difficulty] + mem.wave * 3;
  const ships = army.filter(u => UNITS[u.type].cls === 'ship' && !mem.raiders.has(u.id));
  if (s.tick >= mem.nextWaveTick && ships.length + robots.length >= minWave) {
    const enemyCore = coreOf(s, side === 0 ? 1 : 0);
    if (enemyCore) {
      const wave = [...ships, ...robots];
      wave.forEach(u => mem.raiders.add(u.id));
      out.push({ kind: 'move', units: wave.map(u => u.id), to: { ...enemyCore.pos }, aggressive: true });
      mem.wave++;
      mem.nextWaveTick = s.tick + { facil: 240, normal: 180, dificil: 120 }[mem.difficulty] * 20;
    }
  }
  // los asaltantes que se quedaron sin orden siguen hacia el núcleo
  const enemyCore = coreOf(s, side === 0 ? 1 : 0);
  const lost = my.filter(u => mem.raiders.has(u.id) && u.order.kind === 'idle');
  if (enemyCore && lost.length) out.push({ kind: 'move', units: lost.map(u => u.id), to: { ...enemyCore.pos }, aggressive: true });

  return out;
}

function closest(list: Unit[], p: Vec): Unit | undefined {
  let best: Unit | undefined, bd = Infinity;
  for (const u of list) { const d = dist(u.pos, p); if (d < bd) { bd = d; best = u; } }
  return best;
}

function bestAsteroid(s: SimState, side: Side, res: 'lumen' | 'metal'): number | null {
  const drops = modules(s, side).filter(m => m.built >= 1 && MODULES[m.type].dropsite);
  let best: number | null = null, bd = Infinity;
  for (const a of asteroids(s)) {
    if (a.res !== res || a.amount <= 0) continue;
    for (const d of drops) {
      const dd = dist(a.pos, d.pos);
      if (dd < bd) { bd = dd; best = a.id; }
    }
  }
  return bd < 160 ? best : null;
}

function pickSpot(s: SimState, side: Side, type: ModuleType) {
  const core = coreOf(s, side)!;
  if (type === 'anchor') {
    // ancla junto al campo más rico que no tenga punto de descarga cerca
    const drops = modules(s, side).filter(m => MODULES[m.type].dropsite);
    const candidates = asteroids(s)
      .filter(a => drops.every(d => dist(d.pos, a.pos) > 55) && dist(a.pos, core.pos) < 170)
      .sort((a, b) => dist(a.pos, core.pos) - dist(b.pos, core.pos));
    for (const a of candidates) {
      const toCore = Math.atan2(core.pos.z - a.pos.z, core.pos.x - a.pos.x);
      for (let r = 18; r <= 30; r += 4) {
        const hex = worldToHex({ x: a.pos.x + Math.cos(toCore) * r, z: a.pos.z + Math.sin(toCore) * r });
        if (canPlace(s, side, 'anchor', hex).ok) return hex;
      }
    }
    return null;
  }
  const ports = freePorts(s, side, type);
  if (!ports.length) return null;
  // compacta la estación alrededor del núcleo; las torretas van hacia el enemigo
  const enemy = coreOf(s, side === 0 ? 1 : 0);
  ports.sort((a, b) => {
    if (type === 'turret' && enemy) return hexDist(a, enemy.hex) - hexDist(b, enemy.hex);
    return hexDist(a, core.hex) - hexDist(b, core.hex);
  });
  return ports[0];
}
