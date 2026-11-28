// Motor de la simulación: un paso fijo a 20 Hz. Recibe comandos y avanza el estado.
import {
  ANOMALY, BEACON_LEDGERS_TO_WIN, DEPOSITS, DT, ERA_UP, GATHER, LEDGER_TICKS, MAP_HALF, MODULES, PLANET, POP_MAX, START_RES, UNITS,
} from './defs';
import { hexDist, hexKey, hexNeighbors, hexToWorld, worldToHex } from './hex';
import { Rng } from './rng';
import type {
  Asteroid, AsteroidKind, Command, Entity, Era, Hex, Module, ModuleType, Owner, Planet, Player, Res, Side, SimState,
  Unit, UnitType, Vec,
} from './types';

export interface SideCommand { side: Side; cmd: Command }

// ---------- utilidades ----------

export const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.z - b.z);
const other = (s: Side): Side => (s === 0 ? 1 : 0);

export function radiusOf(e: Entity): number {
  if (e.kind === 'unit') return UNITS[e.type].radius;
  if (e.kind === 'module') return MODULES[e.type].radius;
  return e.radius;
}

export function canAfford(res: Res, c: Res): boolean {
  return res.lumens >= c.lumens && res.metal >= c.metal && res.energy >= c.energy;
}
function pay(res: Res, c: Res) { res.lumens -= c.lumens; res.metal -= c.metal; res.energy -= c.energy; }
function refund(res: Res, c: Res, f = 1) {
  res.lumens += c.lumens * f; res.metal += c.metal * f; res.energy += c.energy * f;
}

export function units(s: SimState, side?: Side): Unit[] {
  const out: Unit[] = [];
  for (const e of s.entities.values()) if (e.kind === 'unit' && (side === undefined || e.side === side)) out.push(e);
  return out;
}
export function modules(s: SimState, side?: Side): Module[] {
  const out: Module[] = [];
  for (const e of s.entities.values()) if (e.kind === 'module' && (side === undefined || e.side === side)) out.push(e);
  return out;
}
export function asteroids(s: SimState): Asteroid[] {
  const out: Asteroid[] = [];
  for (const e of s.entities.values()) if (e.kind === 'asteroid') out.push(e);
  return out;
}
export function planets(s: SimState): Planet[] {
  const out: Planet[] = [];
  for (const e of s.entities.values()) if (e.kind === 'planet') out.push(e);
  return out;
}

export function popUsed(s: SimState, side: Side): number {
  let p = 0;
  for (const u of units(s, side)) p += UNITS[u.type].pop;
  return p;
}
export function popCap(s: SimState, side: Side): number {
  let p = 0;
  for (const m of modules(s, side)) if (m.built >= 1) p += MODULES[m.type].pop;
  return Math.min(POP_MAX, p);
}
export function hasBuilt(s: SimState, side: Side, type: ModuleType): boolean {
  return modules(s, side).some(m => m.type === type && m.built >= 1);
}
export function coreOf(s: SimState, side: Side): Module | undefined {
  return modules(s, side).find(m => m.type === 'core');
}

// ---------- creación ----------

export function addUnit(s: SimState, type: UnitType, side: Side, pos: Vec): Unit {
  const d = UNITS[type];
  const u: Unit = {
    id: s.nextId++, kind: 'unit', type, side, pos: { ...pos }, facing: 0, hp: d.hp, maxHp: d.hp,
    order: { kind: 'idle' }, carry: null, cooldown: 0, lastField: null,
  };
  s.entities.set(u.id, u);
  return u;
}

function addModule(s: SimState, type: ModuleType, side: Side, hex: Hex, built: number, parent: number | null): Module {
  const d = MODULES[type];
  const m: Module = {
    id: s.nextId++, kind: 'module', type, side, hex, pos: hexToWorld(hex), hp: Math.max(1, d.hp * Math.max(0.1, built)),
    maxHp: d.hp, built, parent, queue: [], cooldown: 0, rally: null,
  };
  s.entities.set(m.id, m);
  return m;
}

const PLANET_NAMES = ['Quórum', 'Horizonte', 'Lumenia', 'Soroban Prime', 'Ancla-7'];

export function createSim(seed = 1): SimState {
  const rng = new Rng(seed >>> 0 || 1);
  const s: SimState = {
    tick: 0, ledger: 0, seed, rngState: 0, nextId: 1, entities: new Map(),
    players: [mkPlayer(0), mkPlayer(1)], events: [], winner: null, winReason: '',
  };

  // bases en esquinas opuestas; el lado 1 es el espejo del lado 0
  const coreHex0 = worldToHex({ x: -255, z: 205 });
  const coreHex1 = { q: -coreHex0.q, r: -coreHex0.r };
  const core0 = addModule(s, 'core', 0, coreHex0, 1, null);
  const core1 = addModule(s, 'core', 1, coreHex1, 1, null);

  const mirror = (p: Vec): Vec => ({ x: -p.x, z: -p.z });
  const field = (center: Vec, res: AsteroidKind, n: number, spread: number): Vec[] => {
    const pts: Vec[] = [];
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, Math.PI * 2), r = rng.range(0, spread);
      pts.push({ x: center.x + Math.cos(a) * r, z: center.z + Math.sin(a) * r });
    }
    return pts.map(p => { addAsteroid(s, res, p, rng); return p; });
  };
  // campos propios: Lumens cerca, metal un poco más lejos
  const c0 = core0.pos;
  const nearFields: [Vec, AsteroidKind, number, number][] = [
    // a más de 85 u de la ciudadela: queda un anillo libre para que la estación crezca
    [{ x: c0.x + 92, z: c0.z + 10 }, 'lumen', 9, 13],
    [{ x: c0.x - 8, z: c0.z - 95 }, 'metal', 8, 12],
    [{ x: c0.x + 72, z: c0.z + 80 }, 'energy', 4, 7],
    [{ x: c0.x + 140, z: c0.z - 100 }, 'lumen', 8, 13],
    [{ x: c0.x - 40, z: c0.z - 195 }, 'metal', 9, 15],
    [{ x: c0.x + 205, z: c0.z - 20 }, 'metal', 6, 11],
    [{ x: c0.x + 60, z: c0.z - 170 }, 'energy', 5, 8],
  ];
  for (const [center, res, n, spread] of nearFields) {
    const pts = field(center, res, n, spread);
    for (const p of pts) addAsteroid(s, res, mirror(p), rng);
  }
  // campos centrales disputados
  const contested: [Vec, AsteroidKind, number, number][] = [
    [{ x: -52, z: -60 }, 'lumen', 10, 16],
    [{ x: 105, z: 38 }, 'metal', 10, 16],
    [{ x: 45, z: -68 }, 'energy', 6, 9],
    [{ x: -135, z: 98 }, 'lumen', 7, 12],
    [{ x: -180, z: -68 }, 'energy', 4, 7],
    [{ x: 0, z: 300 }, 'metal', 8, 13],
    [{ x: 300, z: 280 }, 'lumen', 7, 12],
  ];
  for (const [center, res, n, spread] of contested) {
    const pts = field(center, res, n, spread);
    for (const p of pts) addAsteroid(s, res, mirror(p), rng);
  }

  const planetPos: [Vec, number][] = [
    [{ x: 0, z: 0 }, 18],
    [{ x: -265, z: -180 }, 14], [{ x: 265, z: 180 }, 14],
    [{ x: -60, z: 265 }, 12], [{ x: 60, z: -265 }, 12],
  ];
  planetPos.forEach(([pos, radius], i) => {
    const p: Planet = { id: s.nextId++, kind: 'planet', name: PLANET_NAMES[i], pos, radius, owner: -1, capture: 0 };
    s.entities.set(p.id, p);
  });

  for (const [side, core] of [[0, core0], [1, core1]] as [Side, Module][]) {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      addUnit(s, 'drone', side, { x: core.pos.x + Math.cos(a) * 30, z: core.pos.z + Math.sin(a) * 30 });
    }
  }
  s.rngState = rng.state;
  return s;
}

function mkPlayer(side: Side): Player {
  return { side, res: { ...START_RES }, era: 1, alive: true, beaconLedgers: 0, lastHit: -1, gatherMult: 1, holdFire: false, maxDrones: 32 };
}

function addAsteroid(s: SimState, res: AsteroidKind, pos: Vec, rng: Rng) {
  const a: Asteroid = {
    id: s.nextId++, kind: 'asteroid', res, pos: { ...pos },
    amount: DEPOSITS[res].amount, radius: res === 'energy' ? rng.range(2.2, 3.2) : rng.range(2.6, 4.2),
  };
  s.entities.set(a.id, a);
}

// ---------- colocación de módulos ----------

/** celdas que ocupa un módulo: el Núcleo es una ciudadela de 7 celdas (la suya y sus 6 vecinas) */
export function footprint(m: Pick<Module, 'type' | 'hex'>): Hex[] {
  return m.type === 'core' ? [m.hex, ...hexNeighbors(m.hex)] : [m.hex];
}

export type PlaceCheck = { ok: true; parent: number | null } | { ok: false; reason: string };

export function canPlace(s: SimState, side: Side, type: ModuleType, hex: Hex): PlaceCheck {
  const d = MODULES[type];
  const pl = s.players[side];
  if (type === 'core') return { ok: false, reason: 'Solo hay un Núcleo' };
  if (pl.era < d.era) return { ok: false, reason: `Requiere la era ${d.era}` };
  if (type === 'beacon' && modules(s, side).some(m => m.type === 'beacon')) return { ok: false, reason: 'Ya tienes un Faro' };
  const pos = hexToWorld(hex);
  if (Math.abs(pos.x) > MAP_HALF - 10 || Math.abs(pos.z) > MAP_HALF - 10) return { ok: false, reason: 'Fuera del mapa' };

  const occupied = new Map<string, Module>();
  for (const m of modules(s)) for (const h of footprint(m)) occupied.set(hexKey(h), m);
  if (occupied.has(hexKey(hex))) return { ok: false, reason: 'Celda ocupada' };
  for (const e of s.entities.values()) {
    if (e.kind === 'asteroid' && dist(e.pos, pos) < e.radius + 11) return { ok: false, reason: 'Hay asteroides' };
    if (e.kind === 'planet' && dist(e.pos, pos) < e.radius + 12) return { ok: false, reason: 'Muy cerca de un planeta' };
  }
  let parent: Module | null = null;
  for (const n of hexNeighbors(hex)) {
    const m = occupied.get(hexKey(n));
    if (!m) continue;
    if (m.side !== side) return { ok: false, reason: 'Pegado a la estación enemiga' };
    if (!parent || m.type === 'core') parent = m;
  }
  if (d.freePlacement) {
    for (const m of modules(s, other(side))) if (hexDist(m.hex, hex) < 5) return { ok: false, reason: 'Muy cerca del enemigo' };
    return { ok: true, parent: parent ? parent.id : null };
  }
  if (!parent) return { ok: false, reason: 'Debe acoplarse a un puerto libre de tu estación' };
  return { ok: true, parent: parent.id };
}

// celdas libres donde se puede acoplar un módulo (para el fantasma del UI y la IA)
export function freePorts(s: SimState, side: Side, type: ModuleType): Hex[] {
  const seen = new Set<string>();
  const out: Hex[] = [];
  for (const m of modules(s, side)) {
    for (const n of footprint(m).flatMap(hexNeighbors)) {
      const k = hexKey(n);
      if (seen.has(k)) continue;
      seen.add(k);
      if (canPlace(s, side, type, n).ok) out.push(n);
    }
  }
  return out;
}

// ---------- comandos ----------

function ownedUnits(s: SimState, side: Side, ids: number[]): Unit[] {
  const out: Unit[] = [];
  for (const id of ids) {
    const e = s.entities.get(id);
    if (e && e.kind === 'unit' && e.side === side) out.push(e);
  }
  return out;
}

// posiciones en espiral alrededor del destino para que el grupo no se amontone
export function formation(to: Vec, n: number, spacing = 5): Vec[] {
  const out: Vec[] = [];
  for (let i = 0; i < n; i++) {
    if (i === 0) { out.push({ ...to }); continue; }
    const ring = Math.ceil((Math.sqrt(i) + 1) / 2);
    const a = i * 2.399963;
    const r = spacing * Math.sqrt(i) * 0.9 + ring * 0.1;
    out.push({ x: to.x + Math.cos(a) * r, z: to.z + Math.sin(a) * r });
  }
  return out;
}

// saca un punto de destino fuera de asteroides y planetas, para que nadie intente llegar a donde no cabe
function clearSpot(s: SimState, p: Vec, r: number): Vec {
  const out = { ...p };
  for (const e of s.entities.values()) {
    if (e.kind !== 'asteroid' && e.kind !== 'planet') continue;
    const min = e.radius + r + 1.5;
    const dx = out.x - e.pos.x, dz = out.z - e.pos.z;
    const d = Math.hypot(dx, dz);
    if (d >= min) continue;
    const k = d > 1e-3 ? min / d : 0;
    out.x = d > 1e-3 ? e.pos.x + dx * k : e.pos.x + min;
    out.z = d > 1e-3 ? e.pos.z + dz * k : e.pos.z;
  }
  return out;
}

export function applyCommand(s: SimState, side: Side, cmd: Command) {
  const pl = s.players[side];
  if (!pl.alive || s.winner !== null) return;
  switch (cmd.kind) {
    case 'move': {
      const us = ownedUnits(s, side, cmd.units);
      const spacing = Math.max(4, ...us.map(u => UNITS[u.type].radius * 2.4));
      // los más grandes van al centro, así el grupo no se cruza al llegar
      us.sort((a, b) => UNITS[b.type].radius - UNITS[a.type].radius || dist(a.pos, cmd.to) - dist(b.pos, cmd.to));
      const spots = formation(cmd.to, us.length, spacing).map((p, i) => clearSpot(s, p, UNITS[us[i]?.type ?? 'drone'].radius));
      us.forEach((u, i) => { u.order = { kind: 'move', to: spots[i], aggressive: !!cmd.aggressive }; u.stall = 0; u.lastDist = undefined; });
      break;
    }
    case 'attack': {
      const t = s.entities.get(cmd.target);
      if (!t || (t.kind !== 'unit' && t.kind !== 'module') || t.side === side) return;
      for (const u of ownedUnits(s, side, cmd.units)) u.order = { kind: 'attack', target: t.id };
      break;
    }
    case 'gather': {
      const t = s.entities.get(cmd.target);
      if (!t || t.kind !== 'asteroid') return;
      for (const u of ownedUnits(s, side, cmd.units)) {
        if (u.type === 'drone') { u.order = { kind: 'gather', target: t.id, phase: 'go' }; u.lastField = { ...t.pos }; }
        else u.order = { kind: 'move', to: { ...t.pos }, aggressive: false };
      }
      break;
    }
    case 'build': {
      const chk = canPlace(s, side, cmd.module, cmd.hex);
      if (!chk.ok) return;
      const c = MODULES[cmd.module].cost;
      if (!canAfford(pl.res, c)) return;
      const drones = ownedUnits(s, side, cmd.units).filter(u => u.type === 'drone');
      if (drones.length === 0) return;
      pay(pl.res, c);
      const m = addModule(s, cmd.module, side, cmd.hex, 0, chk.parent);
      for (const u of drones) u.order = { kind: 'build', target: m.id };
      break;
    }
    case 'repair': {
      const t = s.entities.get(cmd.target);
      if (!t || t.kind !== 'module' || t.side !== side) return;
      for (const u of ownedUnits(s, side, cmd.units)) if (u.type === 'drone') u.order = { kind: 'build', target: t.id };
      break;
    }
    case 'train': {
      const m = s.entities.get(cmd.module);
      if (!m || m.kind !== 'module' || m.side !== side || m.built < 1) return;
      const md = MODULES[m.type], ud = UNITS[cmd.unit];
      if (!md.trains.includes(cmd.unit) || pl.era < ud.era || m.queue.length >= 6) return;
      if (!canAfford(pl.res, ud.cost)) return;
      pay(pl.res, ud.cost);
      m.queue.push({ item: cmd.unit, progress: 0, total: ud.trainTime });
      break;
    }
    case 'era': {
      const m = s.entities.get(cmd.module);
      if (!m || m.kind !== 'module' || m.side !== side || m.type !== 'core') return;
      const next = (pl.era + 1) as Era;
      if (next > 4 || m.queue.some(q => q.item === 'era')) return;
      if (!hasBuilt(s, side, 'lab')) return;
      const up = ERA_UP[next as 2 | 3 | 4];
      if (!canAfford(pl.res, up.cost)) return;
      pay(pl.res, up.cost);
      m.queue.push({ item: 'era', progress: 0, total: up.time });
      break;
    }
    case 'cancel': {
      const m = s.entities.get(cmd.module);
      if (!m || m.kind !== 'module' || m.side !== side) return;
      if (m.built < 1) {
        // cancelar un módulo en ensamblaje devuelve el 75 %
        refund(pl.res, MODULES[m.type].cost, 0.75);
        s.entities.delete(m.id);
        return;
      }
      const q = m.queue.pop();
      if (!q) return;
      if (q.item === 'era') refund(pl.res, ERA_UP[(pl.era + 1) as 2 | 3 | 4].cost);
      else refund(pl.res, UNITS[q.item].cost);
      break;
    }
    case 'rally': {
      const m = s.entities.get(cmd.module);
      if (m && m.kind === 'module' && m.side === side) m.rally = { ...cmd.to };
      break;
    }
  }
}

// ---------- paso ----------

export function step(s: SimState, cmds: SideCommand[] = []) {
  s.events = [];
  if (s.winner !== null) return;
  for (const c of cmds) applyCommand(s, c.side, c.cmd);
  obstacles = [];
  moving.clear();
  // solo los planetas estorban al vuelo: las naves pasan por encima de los asteroides (en un campo denso,
  // esquivar roca a roca las dejaba rebotando y atascadas)
  for (const e of s.entities.values()) if (e.kind === 'planet') obstacles.push(e);

  for (const e of [...s.entities.values()]) {
    if (!s.entities.has(e.id)) continue;
    if (e.kind === 'unit') stepUnit(s, e);
    else if (e.kind === 'module') stepModule(s, e);
  }
  separate(s);
  stepPlanets(s);
  stepEnergy(s);
  reap(s);

  s.tick++;
  if (s.tick % LEDGER_TICKS === 0) closeLedger(s);
}

function stepEnergy(s: SimState) {
  for (const m of modules(s)) {
    if (m.built < 1) continue;
    s.players[m.side].res.energy += MODULES[m.type].energy * DT;
  }
}

function closeLedger(s: SimState) {
  s.ledger++;
  s.events.push({ kind: 'ledger', seq: s.ledger });
  for (const p of planets(s)) if (p.owner !== -1) s.players[p.owner].res.lumens += PLANET.incomePerLedger;
  if (s.ledger % ANOMALY.everyLedgers === 0) spawnAnomaly(s);
  for (const m of modules(s)) {
    const inc = MODULES[m.type].perLedger;
    if (inc && m.built >= 1) refund(s.players[m.side].res, inc);
  }
  for (const pl of s.players) {
    const beacon = modules(s, pl.side).find(m => m.type === 'beacon' && m.built >= 1);
    pl.beaconLedgers = beacon ? pl.beaconLedgers + 1 : 0;
    if (pl.beaconLedgers >= BEACON_LEDGERS_TO_WIN && s.winner === null) {
      s.winner = pl.side;
      s.winReason = 'El Faro de Consenso alcanzó el quórum';
    }
  }
}

// una anomalía: un campo nuevo en zona neutral y su espejo al otro lado del centro
function spawnAnomaly(s: SimState) {
  const rng = new Rng(s.rngState || s.seed || 1);
  const kinds: AsteroidKind[] = ['energy', 'lumen', 'metal'];
  const res = kinds[(s.ledger / ANOMALY.everyLedgers) % 3 | 0];
  for (let attempt = 0; attempt < 20; attempt++) {
    const a = rng.range(0, Math.PI * 2), r = rng.range(75, 260);
    const c = { x: Math.cos(a) * r, z: Math.sin(a) * r };
    const clear = (p: Vec) => [...s.entities.values()].every(e =>
      e.kind === 'unit' || dist(e.pos, p) > (e.kind === 'planet' ? e.radius + 25 : e.kind === 'module' ? 50 : 18));
    if (!clear(c) || !clear({ x: -c.x, z: -c.z })) continue;
    for (const center of [c, { x: -c.x, z: -c.z }]) {
      for (let i = 0; i < ANOMALY.rocks; i++) {
        const b = rng.range(0, Math.PI * 2), d = rng.range(0, ANOMALY.spread);
        addAsteroid(s, res, { x: center.x + Math.cos(b) * d, z: center.z + Math.sin(b) * d }, rng);
      }
      s.events.push({ kind: 'anomaly', pos: center, res });
    }
    break;
  }
  s.rngState = rng.state;
}

function reap(s: SimState) {
  for (const e of [...s.entities.values()]) {
    if (e.kind === 'unit' || e.kind === 'module') {
      if (e.hp > 0) continue;
      s.entities.delete(e.id);
      s.events.push({ kind: 'death', pos: { ...e.pos }, size: radiusOf(e), side: e.side });
      if (e.kind === 'module' && e.type === 'core') {
        s.players[e.side].alive = false;
        if (s.winner === null) { s.winner = other(e.side); s.winReason = 'Núcleo Estelar destruido'; }
      }
    } else if (e.kind === 'asteroid' && e.amount <= 0) {
      s.entities.delete(e.id);
    }
  }
}

let obstacles: Planet[] = [];
// unidades que se movieron por su cuenta este tick
const moving = new Set<number>();

function moveTowards(u: Unit, to: Vec, stop: number): boolean {
  const dx = to.x - u.pos.x, dz = to.z - u.pos.z;
  const d = Math.hypot(dx, dz);
  // tolerancia: la separación entre unidades puede alejarla unas décimas del punto exacto
  if (d <= stop + 0.4) return true;
  let nx = dx / d, nz = dz / d;
  // rodea el planeta más cercano que corte el camino
  const ur = UNITS[u.type].radius;
  const look = Math.min(d, 30);
  let block: { t: number; side: number; r: number; ox: number; oz: number } | null = null;
  for (const o of obstacles) {
    const r = radiusOf(o) + ur + 0.8;
    const ox = o.pos.x - u.pos.x, oz = o.pos.z - u.pos.z;
    if (Math.abs(o.pos.x - to.x) + Math.abs(o.pos.z - to.z) < 0.5) continue;
    const t = ox * nx + oz * nz;
    if (t < -r || t > look + r) continue;
    const perp = ox * nz - oz * nx;
    if (Math.abs(perp) >= r) continue;
    // el destino está dentro del obstáculo (p. ej. un módulo a ensamblar): no se esquiva
    if (Math.hypot(o.pos.x - to.x, o.pos.z - to.z) < r + stop) continue;
    if (!block || t < block.t) block = { t, side: perp >= 0 ? 1 : -1, r, ox, oz };
  }
  if (block) {
    // tangente al círculo del obstáculo, del lado contrario a donde está su centro
    const ol = Math.hypot(block.ox, block.oz) || 1;
    const tx = -block.oz / ol * block.side, tz = block.ox / ol * block.side;
    const w = ol < block.r + 2 ? 1 : 0.8;
    nx = nx * (1 - w) + tx * w; nz = nz * (1 - w) + tz * w;
    const l = Math.hypot(nx, nz) || 1;
    nx /= l; nz /= l;
  }
  const sp = Math.min(UNITS[u.type].speed * DT, d - stop);
  moving.add(u.id);
  u.pos.x += nx * sp;
  u.pos.z += nz * sp;
  u.facing = Math.atan2(nx, nz);
  u.pos.x = Math.max(-MAP_HALF, Math.min(MAP_HALF, u.pos.x));
  u.pos.z = Math.max(-MAP_HALF, Math.min(MAP_HALF, u.pos.z));
  return false;
}

function face(u: Unit, p: Vec) { u.facing = Math.atan2(p.x - u.pos.x, p.z - u.pos.z); }

function damageMult(attackerShipMul: number, attackerModMul: number, target: Unit | Module): number {
  if (target.kind === 'module') return attackerModMul;
  return UNITS[target.type].cls === 'ship' ? attackerShipMul : 1;
}

function nearestEnemy(s: SimState, side: Side, pos: Vec, range: number, unitsOnly = false): Unit | Module | null {
  let best: Unit | Module | null = null, bd = Infinity;
  for (const e of s.entities.values()) {
    if (e.kind !== 'unit' && e.kind !== 'module') continue;
    if (e.side === side) continue;
    if (unitsOnly && e.kind !== 'unit') continue;
    const d = dist(e.pos, pos) - radiusOf(e);
    // prioriza unidades armadas sobre módulos y drones
    const pri = e.kind === 'unit' ? (e.type === 'drone' ? 8 : 0) : 15;
    if (d <= range && d + pri < bd) { bd = d + pri; best = e; }
  }
  return best;
}

function nearestDropsite(s: SimState, side: Side, pos: Vec): Module | null {
  let best: Module | null = null, bd = Infinity;
  for (const m of modules(s, side)) {
    if (m.built < 1 || !MODULES[m.type].dropsite) continue;
    const d = dist(m.pos, pos);
    if (d < bd) { bd = d; best = m; }
  }
  return best;
}

function nearestAsteroid(s: SimState, res: AsteroidKind | null, pos: Vec, maxD: number): Asteroid | null {
  let best: Asteroid | null = null, bd = maxD;
  for (const a of asteroids(s)) {
    if (res && a.res !== res) continue;
    if (a.amount <= 0) continue;
    const d = dist(a.pos, pos);
    if (d < bd) { bd = d; best = a; }
  }
  return best;
}

// la mayor protección de escudo que alcanza a un objetivo (los escudos no se suman); cuenta su tamaño, así
// la cúpula cubre la ciudadela aunque su centro quede lejos
function shieldAt(s: SimState, side: Side, pos: Vec, size = 0): number {
  let best = 0;
  for (const m of modules(s, side)) {
    const sh = MODULES[m.type].shield;
    if (!sh || m.built < 1 || dist(m.pos, pos) - size > sh.radius) continue;
    best = Math.max(best, sh.reduction);
  }
  return best;
}

// bono global de un tipo de módulo en pie (el mayor, no se suman copias)
function globalBonus(s: SimState, side: Side, key: 'gatherBonus' | 'trainSpeed'): number {
  let b = 0;
  for (const m of modules(s, side)) if (m.built >= 1) b = Math.max(b, MODULES[m.type][key] ?? 0);
  return b;
}

function fire(s: SimState, from: Vec, side: Side, target: Unit | Module, damage: number, weapon: 'laser' | 'plasma' | 'melee') {
  target.hp -= damage * (1 - shieldAt(s, target.side, target.pos, radiusOf(target)));
  if (target.side !== side) s.players[target.side].lastHit = s.tick;
  s.events.push({ kind: 'shot', from: { ...from }, to: { ...target.pos }, side, weapon });
}

function stepUnit(s: SimState, u: Unit) {
  const d = UNITS[u.type];
  u.cooldown = Math.max(0, u.cooldown - DT);
  const o = u.order;

  switch (o.kind) {
    case 'idle': {
      if (d.cls !== 'worker' && !s.players[u.side].holdFire) {
        const t = nearestEnemy(s, u.side, u.pos, d.sight);
        if (t) u.order = { kind: 'attack', target: t.id };
      }
      break;
    }
    case 'move': {
      if (o.aggressive && d.cls !== 'worker') {
        const t = nearestEnemy(s, u.side, u.pos, d.range + 6);
        if (t) {
          if (u.cooldown <= 0) attackStep(s, u, t);
          break;
        }
      }
      // avance real desde el tick anterior (ya con los empujones de la separación aplicados)
      const now = dist(u.pos, o.to);
      const gained = (u.lastDist ?? Infinity) - now;
      u.lastDist = now;
      u.stall = gained < d.speed * DT * 0.25 ? (u.stall ?? 0) + 1 : 0;
      // si el grupo ya ocupa el destino o algo lo bloquea, da la llegada por buena en vez de empujar para siempre
      if (moveTowards(u, o.to, 0.5) || (u.stall > 8 && now < 6 + d.radius * 3) || u.stall > 50) {
        u.order = { kind: 'idle' }; u.stall = 0; u.lastDist = undefined;
      }
      break;
    }
    case 'attack': {
      const t = s.entities.get(o.target);
      if (!t || (t.kind !== 'unit' && t.kind !== 'module') || t.hp <= 0) { u.order = { kind: 'idle' }; break; }
      const reach = d.range + radiusOf(t) + d.radius * 0.5;
      if (dist(u.pos, t.pos) > reach) { moveTowards(u, t.pos, reach - 0.5); break; }
      face(u, t.pos);
      if (u.cooldown <= 0) attackStep(s, u, t);
      break;
    }
    case 'gather': stepGather(s, u, o); break;
    case 'build': {
      const m = s.entities.get(o.target);
      if (!m || m.kind !== 'module' || m.side !== u.side) { u.order = { kind: 'idle' }; break; }
      const md = MODULES[m.type];
      if (!moveTowards(u, m.pos, md.radius + 3)) break;
      face(u, m.pos);
      if (m.built < 1) {
        const inc = DT / md.buildTime;
        m.built = Math.min(1, m.built + inc);
        m.hp = Math.min(m.maxHp, m.hp + m.maxHp * inc * 0.9);
        if (m.built >= 1) {
          s.events.push({ kind: 'built', id: m.id, side: m.side });
          afterBuild(s, u, m);
        }
      } else if (m.hp < m.maxHp) {
        m.hp = Math.min(m.maxHp, m.hp + (m.maxHp / md.buildTime) * DT * 0.5);
      } else {
        u.order = { kind: 'idle' };
      }
      break;
    }
  }
}

function afterBuild(s: SimState, u: Unit, m: Module) {
  // tras ensamblar un ancla, los drones se ponen a minar lo que haya cerca
  if (MODULES[m.type].dropsite) {
    const a = nearestAsteroid(s, null, m.pos, 60);
    if (a) { u.order = { kind: 'gather', target: a.id, phase: 'go' }; u.lastField = { ...a.pos }; return; }
  }
  // si venía de minar, vuelve a su campo en vez de quedarse ocioso
  const back = u.lastField ? nearestAsteroid(s, null, u.lastField, 40) : null;
  if (back) { u.order = { kind: 'gather', target: back.id, phase: 'go' }; return; }
  u.order = { kind: 'idle' };
}

function attackStep(s: SimState, u: Unit, t: Unit | Module) {
  const d = UNITS[u.type];
  const dmg = d.damage * damageMult(d.vsShip, d.vsModule, t);
  fire(s, u.pos, u.side, t, dmg, d.weapon);
  u.cooldown = d.cooldown;
}

function stepGather(s: SimState, u: Unit, o: Extract<Unit['order'], { kind: 'gather' }>) {
  const pl = s.players[u.side];
  if (o.phase === 'return') {
    const drop = nearestDropsite(s, u.side, u.pos);
    if (!drop) { u.order = { kind: 'idle' }; return; }
    if (!moveTowards(u, drop.pos, MODULES[drop.type].radius + 2.5)) return;
    if (u.carry) {
      pl.res[DEPOSITS[u.carry.res].key] += u.carry.amount;
      u.carry = null;
    }
    const a = s.entities.get(o.target);
    if (a && a.kind === 'asteroid' && a.amount > 0) { o.phase = 'go'; return; }
    const next = u.lastField ? nearestAsteroid(s, null, u.lastField, 50) : null;
    if (next) { u.order = { kind: 'gather', target: next.id, phase: 'go' }; return; }
    u.order = { kind: 'idle' };
    return;
  }

  let a = s.entities.get(o.target) as Asteroid | undefined;
  if (!a || a.kind !== 'asteroid' || a.amount <= 0) {
    const res = u.carry ? u.carry.res : null;
    const next = nearestAsteroid(s, res, u.lastField ?? u.pos, 50);
    if (!next) {
      if (u.carry && u.carry.amount > 0) o.phase = 'return'; else u.order = { kind: 'idle' };
      return;
    }
    o.target = next.id;
    a = next;
  }
  if (o.phase === 'go') {
    if (!moveTowards(u, a.pos, a.radius + GATHER.reach * 0.5)) return;
    o.phase = 'mine';
  }
  // minando
  face(u, a.pos);
  if (u.carry && u.carry.res !== a.res) u.carry = null;
  if (!u.carry) u.carry = { res: a.res, amount: 0 };
  const bonus = (hasBuilt(s, u.side, 'lab') ? 1 + GATHER.labBonus : 1) * (1 + globalBonus(s, u.side, 'gatherBonus')) * pl.gatherMult;
  const take = Math.min(a.amount, GATHER.rate * bonus * DT);
  a.amount -= take;
  u.carry.amount += take;
  u.lastField = { ...a.pos };
  if (u.carry.amount >= GATHER.perTrip - 1e-6 || a.amount <= 0) o.phase = 'return';
}

function stepModule(s: SimState, m: Module) {
  if (m.built < 1) return;
  const md = MODULES[m.type];
  const pl = s.players[m.side];
  m.cooldown = Math.max(0, m.cooldown - DT);

  if (md.attack && m.cooldown <= 0 && !pl.holdFire) {
    const t = nearestEnemy(s, m.side, m.pos, md.attack.range + md.radius, true);
    if (t) {
      fire(s, m.pos, m.side, t, md.attack.damage, md.attack.weapon);
      m.cooldown = md.attack.cooldown;
    }
  }

  // replicador: un dron nuevo cada tanto, si hay población y no sobran drones
  if (md.replicate && m.cooldown <= 0) {
    m.cooldown = md.replicate;
    const drones = units(s, m.side).filter(u => u.type === 'drone').length;
    if (drones < s.players[m.side].maxDrones && popUsed(s, m.side) + 1 <= popCap(s, m.side)) {
      const a = (s.tick * 0.7) % (Math.PI * 2);
      const u = addUnit(s, 'drone', m.side, { x: m.pos.x + Math.cos(a) * (md.radius + 4), z: m.pos.z + Math.sin(a) * (md.radius + 4) });
      s.events.push({ kind: 'trained', id: u.id, side: m.side });
      const field = nearestAsteroid(s, null, m.pos, 120);
      if (field) { u.order = { kind: 'gather', target: field.id, phase: 'go' }; u.lastField = { ...field.pos }; }
    }
  }

  const q = m.queue[0];
  if (!q) return;
  const inc = q.item === 'era' ? DT : DT * (1 + globalBonus(s, m.side, 'trainSpeed'));
  if (q.item !== 'era') {
    const ud = UNITS[q.item];
    // espera si no hay población; el progreso se congela al final
    if (q.progress + inc >= q.total && popUsed(s, m.side) + ud.pop > popCap(s, m.side)) return;
  }
  q.progress += inc;
  if (q.progress < q.total) return;
  m.queue.shift();
  if (q.item === 'era') {
    pl.era = Math.min(4, pl.era + 1) as Era;
    s.events.push({ kind: 'era', side: m.side, era: pl.era });
    return;
  }
  const dir = m.rally ? Math.atan2(m.rally.z - m.pos.z, m.rally.x - m.pos.x) : Math.atan2(-m.pos.z, -m.pos.x);
  const r = md.radius + 4;
  const u = addUnit(s, q.item, m.side, { x: m.pos.x + Math.cos(dir) * r, z: m.pos.z + Math.sin(dir) * r });
  s.events.push({ kind: 'trained', id: u.id, side: m.side });
  if (m.rally) {
    const a = q.item === 'drone' ? nearestAsteroid(s, null, m.rally, 10) : null;
    if (a) { u.order = { kind: 'gather', target: a.id, phase: 'go' }; u.lastField = { ...a.pos }; }
    else u.order = { kind: 'move', to: { ...m.rally }, aggressive: true };
  } else if (q.item === 'drone') {
    // sin punto de reunión, el dron nuevo se pone a minar solo el campo más cercano (ayuda a quien empieza)
    const a = nearestAsteroid(s, null, m.pos, 110);
    if (a) { u.order = { kind: 'gather', target: a.id, phase: 'go' }; u.lastField = { ...a.pos }; }
  }
}

// separación blanda: las unidades en marcha se atraviesan entre sí (nadie se traba en un pasillo), y las que
// están quietas (en espera, disparando o minando) se reparten despacio para no quedar apiladas en un punto.
// capas de vuelo: drones, naves y robots solo se apartan de los de su misma capa
function layer(u: Unit): 0 | 1 | 2 {
  const cls = UNITS[u.type].cls;
  return cls === 'worker' ? 0 : cls === 'ship' ? 1 : 2;
}

// fracción de la suma de radios que dos unidades quietas mantienen entre sí
const PERSONAL_SPACE = 0.8;
// cuánto del solape se corrige por tick y tope del empujón, para que el reparto se vea como una deriva suave
const SPREAD_RATE = 0.12;
const SPREAD_MAX = 0.3;

function separate(s: SimState) {
  const us = units(s);
  const still = us.filter(u => !moving.has(u.id));
  for (let i = 0; i < still.length; i++) {
    const a = still[i];
    const la = layer(a);
    const ra = UNITS[a.type].radius;
    for (let j = i + 1; j < still.length; j++) {
      const b = still[j];
      if (layer(b) !== la) continue;
      const rb = UNITS[b.type].radius;
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
      // los drones se arriman más: trabajan codo a codo en el mismo asteroide
      const min = (ra + rb) * (la === 0 ? 0.55 : PERSONAL_SPACE);
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2);
      // dos unidades en el mismo punto exacto: se separan en una dirección fija según sus ids
      const nx = d > 1e-4 ? dx / d : Math.cos(a.id * 2.4 + b.id), nz = d > 1e-4 ? dz / d : Math.sin(a.id * 2.4 + b.id);
      const push = Math.min((min - d) * SPREAD_RATE, SPREAD_MAX) * 0.5;
      a.pos.x -= nx * push; a.pos.z -= nz * push;
      b.pos.x += nx * push; b.pos.z += nz * push;
    }
  }
  // las unidades vuelan por encima de la estación y de los asteroides: solo los planetas estorban
  for (const e of obstacles) {
    const re = radiusOf(e);
    for (const u of us) {
      // un robot cerca de un planeta no se empuja más allá: aterriza en su órbita baja
      const min = re + UNITS[u.type].radius * 0.6;
      const dx = u.pos.x - e.pos.x, dz = u.pos.z - e.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2) || 0.01;
      // además de sacarla, la desliza por el borde para que no quede trabada de frente
      const slide = u.id % 2 === 0 ? 0.25 : -0.25;
      const nx = dx / d, nz = dz / d;
      u.pos.x = e.pos.x + nx * min - nz * slide;
      u.pos.z = e.pos.z + nz * min + nx * slide;
    }
  }
}

function stepPlanets(s: SimState) {
  const robots = units(s).filter(u => UNITS[u.type].cls === 'robot');
  for (const p of planets(s)) {
    const reach = p.radius + PLANET.captureRadius;
    let n0 = 0, n1 = 0;
    for (const r of robots) if (dist(r.pos, p.pos) <= reach) { if (r.side === 0) n0++; else n1++; }
    const rate = DT / PLANET.captureSeconds;
    let dir = 0;
    if (n0 > 0 && n1 === 0) dir = Math.min(3, n0);
    else if (n1 > 0 && n0 === 0) dir = -Math.min(3, n1);
    else if (n0 === 0 && n1 === 0 && p.owner !== -1) dir = p.owner === 0 ? 0.3 : -0.3;
    if (dir === 0) continue;
    p.capture = Math.max(-1, Math.min(1, p.capture + dir * rate));
    const prev: Owner = p.owner;
    if (p.capture >= 1) p.owner = 0;
    else if (p.capture <= -1) p.owner = 1;
    else if ((p.owner === 0 && p.capture <= 0) || (p.owner === 1 && p.capture >= 0)) p.owner = -1;
    if (p.owner !== prev && p.owner !== -1) s.events.push({ kind: 'captured', planet: p.id, side: p.owner });
  }
}
