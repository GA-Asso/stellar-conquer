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
});
