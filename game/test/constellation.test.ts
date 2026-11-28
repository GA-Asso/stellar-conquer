import { describe, expect, it } from 'vitest';
import { constellationEdges } from '../src/world/atlas';

describe('líneas de constelación', () => {
  it('une todos los astros cercanos con n-1 aristas y sin ciclos', () => {
    const pts = Array.from({ length: 30 }, (_, i) => ({ x: (i % 6) * 20, z: Math.floor(i / 6) * 20 }));
    const e = constellationEdges(pts, 90);
    expect(e).toHaveLength(29);
    const parent = pts.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (const [a, b] of e) {
      expect(find(a)).not.toBe(find(b));
      parent[find(a)] = find(b);
    }
  });

  it('no tiende puentes más largos que el máximo', () => {
    const pts = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 500, z: 0 }, { x: 510, z: 0 }];
    const e = constellationEdges(pts, 90);
    expect(e).toHaveLength(2);
    for (const [a, b] of e) expect(Math.abs(pts[a].x - pts[b].x)).toBeLessThan(90);
  });
});
