import { describe, expect, it } from 'vitest';
import { TICK_HZ } from '../src/sim/defs';
import { coreOf, createSim, step, units } from '../src/sim/sim';
import type { SimState, Unit, UnitType } from '../src/sim/types';

// mide el "temblor": ticks en que una unidad retrocede respecto a su paso anterior
function jitter(s: SimState, ids: number[], seconds: number) {
  const prev = new Map<number, { x: number; z: number; dx: number; dz: number }>();
  let reversals = 0, still = 0, samples = 0;
  for (let t = 0; t < seconds * TICK_HZ; t++) {
    step(s);
    for (const id of ids) {
      const u = s.entities.get(id) as Unit | undefined;
      if (!u) continue;
      const p = prev.get(id);
      if (p) {
        const dx = u.pos.x - p.x, dz = u.pos.z - p.z;
        const mag = Math.hypot(dx, dz);
        if (mag > 0.02 && Math.hypot(p.dx, p.dz) > 0.02 && dx * p.dx + dz * p.dz < 0) reversals++;
        if (mag > 0.005 && u.order.kind === 'idle') still++;
        samples++;
        prev.set(id, { x: u.pos.x, z: u.pos.z, dx, dz });
      } else prev.set(id, { x: u.pos.x, z: u.pos.z, dx: 0, dz: 0 });
    }
  }
  return { reversals, idleDrift: still, samples };
}

function spawnGroup(s: SimState, type: UnitType, n: number): number[] {
  const core = coreOf(s, 0)!;
  const proto = units(s, 0)[0];
  const ids: number[] = [];
  for (let i = 0; i < n; i++) {
    const id = s.nextId++;
    const u: Unit = { ...structuredClone(proto), id, type, pos: { x: core.pos.x + 20 + (i % 5) * 4, z: core.pos.z - 20 - Math.floor(i / 5) * 4 } };
    s.entities.set(id, u);
    ids.push(id);
  }
  return ids;
}

describe('movimiento de grupo', () => {
  it('un grupo mixto llega sin temblar ni quedarse trabado', () => {
    const s = createSim(4);
    const ids = [...spawnGroup(s, 'interceptor', 12), ...spawnGroup(s, 'mecha', 8), ...spawnGroup(s, 'frigate', 4)];
    step(s, [{ side: 0, cmd: { kind: 'move', units: ids, to: { x: 20, z: 60 } } }]);
    const r = jitter(s, ids, 40);
    const arrived = ids.filter(id => (s.entities.get(id) as Unit).order.kind === 'idle').length;
    console.log('temblor', r, 'llegaron', arrived, '/', ids.length);
    expect(arrived).toBe(ids.length);
    expect(r.reversals / r.samples).toBeLessThan(0.01);
    expect(r.idleDrift / r.samples).toBeLessThan(0.02);
  });

  it('una columna atraviesa un grupo quieto sin frenarse', () => {
    const s = createSim(7);
    const wall = spawnGroup(s, 'mecha', 15);
    const runners = spawnGroup(s, 'mecha', 3).map((id, i) => {
      const u = s.entities.get(id) as Unit;
      u.pos = { x: (s.entities.get(wall[7]) as Unit).pos.x - 30, z: (s.entities.get(wall[7]) as Unit).pos.z + i * 3 };
      return id;
    });
    const goal = { x: (s.entities.get(wall[7]) as Unit).pos.x + 30, z: (s.entities.get(wall[7]) as Unit).pos.z };
    step(s, [{ side: 0, cmd: { kind: 'move', units: runners, to: goal } }]);
    // 60 de distancia a 11 u/s: con el paso libre llega en ~6 s
    for (let t = 0; t < 7.5 * TICK_HZ; t++) step(s);
    for (const id of runners) expect((s.entities.get(id) as Unit).order.kind).toBe('idle');
  });

  it('unidades apiladas en un punto se reparten solas', () => {
    const s = createSim(8);
    const ids = spawnGroup(s, 'interceptor', 10);
    for (const id of ids) (s.entities.get(id) as Unit).pos = { x: 0, z: 60 };
    for (let t = 0; t < 6 * TICK_HZ; t++) step(s);
    const us = ids.map(id => s.entities.get(id) as Unit);
    let minD = Infinity;
    for (let i = 0; i < us.length; i++) for (let j = i + 1; j < us.length; j++) {
      minD = Math.min(minD, Math.hypot(us[i].pos.x - us[j].pos.x, us[i].pos.z - us[j].pos.z));
    }
    expect(minD).toBeGreaterThan(2);
  });
});

describe('vuelo sobre asteroides', () => {
  it('un grupo cruza un campo de asteroides denso sin atascarse', () => {
    const s = createSim(11);
    const ids = [...spawnGroup(s, 'interceptor', 8), ...spawnGroup(s, 'frigate', 4), ...spawnGroup(s, 'mecha', 6)];
    // planta un campo denso justo en medio del camino
    const a = ids.map(id => s.entities.get(id) as Unit)[0];
    const to = { x: a.pos.x + 120, z: a.pos.z + 40 };
    const proto = [...s.entities.values()].find(e => e.kind === 'asteroid')!;
    for (let i = 0; i < 40; i++) {
      const id = s.nextId++;
      s.entities.set(id, { ...structuredClone(proto), id, pos: { x: a.pos.x + 40 + (i % 8) * 7, z: a.pos.z + 5 + Math.floor(i / 8) * 7 } });
    }
    step(s, [{ side: 0, cmd: { kind: 'move', units: ids, to } }]);
    for (let t = 0; t < 30 * TICK_HZ; t++) step(s);
    const near = ids.filter(id => {
      const u = s.entities.get(id) as Unit;
      return u.order.kind === 'idle' && Math.hypot(u.pos.x - to.x, u.pos.z - to.z) < 40;
    }).length;
    expect(near).toBe(ids.length);
  });
});
