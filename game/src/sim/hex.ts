// Grilla hexagonal (axial, puntas arriba) donde se acoplan los módulos de la estación.
import type { Hex, Vec } from './types';

export const HEX_SIZE = 10;
const SQRT3 = Math.sqrt(3);

export const HEX_DIRS: Hex[] = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];

export function hexToWorld(h: Hex): Vec {
  return { x: HEX_SIZE * (SQRT3 * h.q + (SQRT3 / 2) * h.r), z: HEX_SIZE * 1.5 * h.r };
}

export function worldToHex(p: Vec): Hex {
  const q = ((SQRT3 / 3) * p.x - (1 / 3) * p.z) / HEX_SIZE;
  const r = ((2 / 3) * p.z) / HEX_SIZE;
  return hexRound(q, r);
}

function hexRound(q: number, r: number): Hex {
  const s = -q - r;
  let rq = Math.round(q), rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq + 0, r: rr + 0 };
}

export const hexKey = (h: Hex) => `${h.q},${h.r}`;
export const hexNeighbors = (h: Hex): Hex[] => HEX_DIRS.map(d => ({ q: h.q + d.q, r: h.r + d.r }));
export function hexDist(a: Hex, b: Hex): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}
