import { describe, expect, it } from 'vitest';
import { galaxyForProject, layoutAtlas, starSize, usd, type RavenProject } from '../src/world/atlas';
import raven from '../src/world/data/raven.json';
import { GALAXIES, CURATED_INNER, CURATED_SLUGS, NODES, nodeWorldPos } from '../src/world/ecosystem';

const P = (t: string[], c = 'User-Facing App', extra: Partial<RavenProject> = {}): RavenProject =>
  ({ s: t.join('-') || 'x', n: 'X', c, t, d: '', st: 'L', scf: null, tvl: null, au: null, r: 0, ...extra });

describe('atlas', () => {
  it('asigna cada proyecto a la galaxia de su tipo principal', () => {
    expect(galaxyForProject(P(['Wallet']))).toBe('wallets');
    expect(galaxyForProject(P(['Lending', 'Payments']))).toBe('defi');
    expect(galaxyForProject(P(['RWA']))).toBe('rwa');
    expect(galaxyForProject(P([], 'Tooling'))).toBe('soroban');
    expect(galaxyForProject(P([]))).toBe('comunidad');
  });

  it('el tamaño crece con la financiación y tiene tope', () => {
    expect(starSize(P([]))).toBeCloseTo(1.4);
    expect(starSize(P([], 'x', { scf: 150_000 }))).toBeGreaterThan(starSize(P([], 'x', { scf: 10_000 })));
    expect(starSize(P([], 'x', { tvl: 1e12 }))).toBeLessThanOrEqual(6.6);
  });

  it('la instantánea incluida tiene datos y todas las galaxias existen', () => {
    const snap = raven as unknown as { projects: RavenProject[]; partners: { n: string }[] };
    expect(snap.projects.length).toBeGreaterThan(500);
    const ids = new Set(GALAXIES.map(g => g.id));
    for (const p of snap.projects) expect(ids.has(galaxyForProject(p))).toBe(true);
  });

  it('la disposición es determinista y no pisa los nodos curados', () => {
    const snap = raven as unknown as { projects: RavenProject[]; partners: never[] };
    const centers = Object.fromEntries(GALAXIES.map(g => [g.id, g.center])) as Record<string, [number, number]>;
    const a = layoutAtlas(snap, centers, CURATED_INNER, CURATED_SLUGS), b = layoutAtlas(snap, centers, CURATED_INNER, CURATED_SLUGS);
    expect(a).toEqual(b);
    // los proyectos que ya son nodos curados no se duplican como estrella
    const curated = snap.projects.filter(p => CURATED_SLUGS.has(p.s)).length;
    expect(curated).toBe(CURATED_SLUGS.size);
    expect(a.stars).toHaveLength(snap.projects.length - curated + snap.partners.length);
    for (const n of NODES.filter(n => n.galaxy !== 'frontera')) {
      const [x, z] = nodeWorldPos(n);
      const closest = Math.min(...a.stars.map(s => Math.hypot(s.x - x, s.z - z)));
      expect(closest, n.id).toBeGreaterThan(14);
    }
  });

  it('formatea dólares en compacto', () => {
    expect(usd(62_464_583)).toBe('$62.5M');
    expect(usd(1_500_000_000)).toBe('$1.5B');
    expect(usd(25_000)).toBe('$25K');
    expect(usd(null)).toBe('—');
  });
});
