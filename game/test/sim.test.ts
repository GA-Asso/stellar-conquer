import { describe, expect, it } from 'vitest';
import { LEDGER_TICKS, MODULES, PLANET, TICK_HZ } from '../src/sim/defs';
import { hexNeighbors, hexToWorld, worldToHex } from '../src/sim/hex';
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
    expect(hexNeighbors(core.hex).some(n => n.q === ports[0].q && n.r === ports[0].r)).toBe(true);
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
