import { describe, expect, it } from 'vitest';
import { LEDGER_TICKS, MODULES, PLANET, TICK_HZ } from '../src/sim/defs';
import { hexDist, hexNeighbors, hexToWorld, worldToHex } from '../src/sim/hex';
import { asteroids, canPlace, coreOf, createSim, dist, freePorts, planets, popCap, step, units } from '../src/sim/sim';
import type { SimState } from '../src/sim/types';

const run = (s: SimState, seconds: number) => { for (let i = 0; i < seconds * TICK_HZ; i++) step(s); };

describe('grilla hexagonal', () => {
  it('ida y vuelta mundo ↔ hex', () => {
    for (const h of [{ q: 0, r: 0 }, { q: 3, r: -2 }, { q: -7, r: 5 }]) expect(worldToHex(hexToWorld(h))).toEqual(h);
  });
});

describe('partida inicial', () => {
  it('es simétrica y reproducible', () => {
    const a = createSim(42), b = createSim(42);
    expect([...a.entities.values()].map(e => e.kind)).toEqual([...b.entities.values()].map(e => e.kind));
    const c0 = coreOf(a, 0)!, c1 = coreOf(a, 1)!;
    expect(c0.pos.x).toBeCloseTo(-c1.pos.x);
    expect(units(a, 0)).toHaveLength(4);
    expect(planets(a)).toHaveLength(5);
    expect(asteroids(a).length).toBeGreaterThan(40);
  });

  it('los drones recolectan Lumens y los descargan en el núcleo', () => {
    const s = createSim(7);
    const core = coreOf(s, 0)!;
    const ast = asteroids(s).filter(a => a.res === 'lumen').sort((a, b) => dist(a.pos, core.pos) - dist(b.pos, core.pos))[0];
    const before = s.players[0].res.lumens;
    step(s, [{ side: 0, cmd: { kind: 'gather', units: units(s, 0).map(u => u.id), target: ast.id } }]);
    run(s, 60);
    expect(s.players[0].res.lumens).toBeGreaterThan(before + 40);
  });
});

describe('estación modular', () => {
  it('solo acepta módulos acoplados a un puerto libre', () => {
    const s = createSim(3);
    const core = coreOf(s, 0)!;
    const far = { q: core.hex.q + 4, r: core.hex.r };
    expect(canPlace(s, 0, 'habitat', far).ok).toBe(false);
    const ports = freePorts(s, 0, 'habitat');
    expect(ports.length).toBeGreaterThan(0);
    // el Núcleo ocupa su celda y las 6 vecinas: los módulos se acoplan al anillo siguiente
    expect(ports.every(p => hexDist(core.hex, p) === 2)).toBe(true);
    expect(canPlace(s, 0, 'habitat', hexNeighbors(core.hex)[0]).ok).toBe(false);
  });

  it('los drones ensamblan un hábitat y sube la población', () => {
    const s = createSim(3);
    const cap = popCap(s, 0);
    const port = freePorts(s, 0, 'habitat')[0];
    step(s, [{ side: 0, cmd: { kind: 'build', units: units(s, 0).map(u => u.id), module: 'habitat', hex: port } }]);
    run(s, MODULES.habitat.buildTime / 4 + 6);
    expect(popCap(s, 0)).toBe(cap + MODULES.habitat.pop);
  });

  it('el ancla se puede colocar lejos de la estación', () => {
    const s = createSim(3);
    const core = coreOf(s, 0)!;
    const hex = worldToHex({ x: core.pos.x + 40, z: core.pos.z - 30 });
    const chk = canPlace(s, 0, 'anchor', hex);
    expect(chk.ok).toBe(true);
  });
});

describe('producción y combate', () => {
  it('el núcleo entrena un dron', () => {
    const s = createSim(5);
    const core = coreOf(s, 0)!;
    step(s, [{ side: 0, cmd: { kind: 'train', module: core.id, unit: 'drone' } }]);
    run(s, 11);
    expect(units(s, 0)).toHaveLength(5);
  });

  it('destruir el núcleo da la victoria', () => {
    const s = createSim(5);
    coreOf(s, 1)!.hp = 1;
    const ids = units(s, 0).map(u => u.id);
    step(s, [{ side: 0, cmd: { kind: 'attack', units: ids, target: coreOf(s, 1)!.id } }]);
    run(s, 60);
    expect(s.winner).toBe(0);
  });
});

describe('planetas y ledgers', () => {
  it('un mecha conquista un planeta y cobra cada ledger', () => {
    const s = createSim(9);
    const p = planets(s)[0];
    // aparece un mecha junto al planeta
    const d = units(s, 0)[0];
    d.type = 'mecha';
    d.pos = { x: p.pos.x + p.radius + 2, z: p.pos.z };
    run(s, PLANET.captureSeconds + 1);
    expect(p.owner).toBe(0);
    const lumens = s.players[0].res.lumens;
    run(s, LEDGER_TICKS / TICK_HZ);
    expect(s.players[0].res.lumens).toBeGreaterThanOrEqual(lumens + PLANET.incomePerLedger);
    expect(s.ledger).toBeGreaterThan(0);
  });
});

describe('tecnología avanzada', () => {
  it('la antena SETI paga cada ledger, el escudo reduce daño y el replicador fabrica drones', async () => {
    const { MODULES } = await import('../src/sim/defs');
    const { applyCommand, coreOf: core, freePorts, modules: mods, step: st, units: us, createSim: mk } = await import('../src/sim/sim');
    const s = mk(21);
    const pl = s.players[0];
    pl.era = 4;
    pl.res = { lumens: 1e5, metal: 1e5, energy: 1e5 };
    const drone = us(s, 0)[0].id;
    for (const t of ['habitat', 'seti', 'shield', 'replicator'] as const) {
      applyCommand(s, 0, { kind: 'build', units: [drone], module: t, hex: freePorts(s, 0, t)[0] });
    }
    for (const m of mods(s, 0)) { m.built = 1; m.hp = m.maxHp; }
    const before = { ...pl.res };
    const drones0 = us(s, 0).filter(u => u.type === 'drone').length;
    for (let t = 0; t < 100; t++) st(s);
    expect(pl.res.lumens).toBeGreaterThanOrEqual(before.lumens + MODULES.seti.perLedger!.lumens);
    expect(us(s, 0).filter(u => u.type === 'drone').length).toBeGreaterThan(drones0);
    // un disparo al núcleo, cubierto por el escudo, hace 35 % menos daño
    const c = core(s, 0)!;
    const enemy = us(s, 1)[0];
    enemy.type = 'interceptor';
    enemy.pos = { x: c.pos.x + 20, z: c.pos.z };
    enemy.order = { kind: 'attack', target: c.id };
    enemy.cooldown = 0;
    const hp = c.hp;
    st(s);
    expect(hp - c.hp).toBeCloseTo(7 * 0.5 * 0.65, 3);
  });
});

describe('anomalías', () => {
  it('cada 36 ledgers aparece un campo nuevo y su espejo', () => {
    const s = createSim(31);
    const n0 = asteroids(s).length;
    let events = 0;
    for (let t = 0; t < 36 * LEDGER_TICKS; t++) { step(s); events += s.events.filter(e => e.kind === 'anomaly').length; }
    expect(events).toBe(2);
    expect(asteroids(s).length).toBe(n0 + 10);
  });
});
