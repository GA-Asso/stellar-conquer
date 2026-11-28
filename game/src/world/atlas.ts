// Atlas del ecosistema: la instantánea de Raven (scripts/raven-snapshot.mjs) convertida en estrellas del
// Universo. Cada proyecto activo es un astro en la galaxia de su tipo principal; el tamaño codifica la
// financiación del SCF y el TVL, el color su estado y un anillo, que tiene auditoría registrada.
// Lógica pura: sin Three.js ni DOM, para poder probarla.

export interface RavenProject {
  s: string; n: string; c: string; t: string[]; d: string;
  st: 'L' | 'P' | 'D'; scf: number | null; tvl: number | null;
  au: { n: number; by: string[]; at: string | null } | null; r: number;
  /** web oficial, GitHub, X y página del SCF (si la fuente los tiene) */
  web?: string | null; gh?: string | null; x?: string | null; scfUrl?: string | null;
  /** quién lo construye y fecha de la última actividad registrada */
  by?: string | null; act?: string | null;
  /** 1 si la web oficial no respondía cuando se generó la instantánea */
  down?: 1;
}
export interface RavenPartner { n: string; type: string; tag: string; url: string | null; regions: string[]; ramps: string[] }
export interface RavenSnapshot {
  generatedAt: string;
  source: { name: string; url: string; license: string };
  sitesCheckedAt?: string; sitesDown?: number;
  totals: {
    projects: number; scfProjects: number; scfUSD: number; scfMeanUSD: number; tvlUSD: number; tvlProvider: string; tvlAsOf: string;
    hackathons: number; hackathonPrizeUSD: number; hackers: number; audits: number; stablecoins: number; rwaAssets: number; rwaIssuers: number; partners: number;
  };
  developers: { asOf: string; source: string; monthlyActive: number; exclusive: number; peak: number; yoyPct: number | null; commits28d: number; fullTime: number };
  categories: { c: string; n: number; scfN: number; scf: number }[];
  tvlTop: { s: string; n: string; tvl: number }[];
  stablecoins: { t: string; n: string; by: string; peg: string; kind: string; cap: number | null; holders: number | null }[];
  rwa: { n: string; sym: string; by: string; cls: string; usd: number }[];
  auditsByFirm: { firm: string; n: number }[];
  activity: { s: string; n: string; commits: number | null }[];
  hackathons: { n: string; start: string; end: string; prize: number | null; hackers: number | null; by: string | null; url: string | null }[];
  partners: RavenPartner[];
  projects: RavenProject[];
}

/**
 * galaxias que añade el atlas a las del mapa curado (centros en el plano). Cada una tiene un tono propio,
 * separado del resto en la rueda de color, para que dos constelaciones vecinas no se confundan.
 */
export const ATLAS_GALAXIES = [
  { id: 'rwa', name: 'Bóveda de Activos', color: '#ff5d5d', center: [0, -880] as [number, number],
    blurb: 'Activos del mundo real tokenizados y stablecoins: bonos, fondos y dólares digitales en Stellar.' },
  { id: 'ia', name: 'Nebulosa IA', color: '#e05cff', center: [-1150, -880] as [number, number],
    blurb: 'Agentes, pagos entre máquinas y herramientas de IA construidas sobre Stellar.' },
  { id: 'juegos', name: 'Arcade Estelar', color: '#b8f04a', center: [1150, -880] as [number, number],
    blurb: 'Juegos, coleccionables y herramientas para crear juegos sobre Stellar.' },
  { id: 'comunidad', name: 'Cúmulo Comunidad', color: '#e8eef8', center: [-1250, 80] as [number, number],
    blurb: 'Educación, impacto social y comunidades que acercan Stellar a más gente.' },
  { id: 'socios', name: 'Puerto de Socios', color: '#5b8cff', center: [1250, 80] as [number, number],
    blurb: 'Proveedores que un equipo contrata o integra: anclas, rampas, infraestructura, auditores y más.' },
];

const TYPE_GALAXY: Record<string, string> = {
  Wallet: 'wallets',
  DEX: 'defi', Lending: 'defi', Exchange: 'defi', Yield: 'defi', Derivatives: 'defi', Bridge: 'defi', Oracle: 'defi',
  Payments: 'pagos', Anchor: 'pagos', 'Card Issuing': 'pagos',
  RWA: 'rwa', Stablecoin: 'rwa',
  Infrastructure: 'nucleo', RPC: 'nucleo', Indexer: 'nucleo', Explorer: 'nucleo', Analytics: 'nucleo', Faucet: 'nucleo',
  SDK: 'soroban', Security: 'soroban',
  AI: 'ia',
  Gaming: 'juegos', NFT: 'juegos',
  Education: 'comunidad', 'Social Impact': 'comunidad',
};

export function galaxyForProject(p: Pick<RavenProject, 't' | 'c'>): string {
  for (const t of p.t) if (TYPE_GALAXY[t]) return TYPE_GALAXY[t];
  if (p.c === 'Tooling') return 'soroban';
  if (p.c === 'Infrastructure') return 'nucleo';
  if (p.c === 'Anchor') return 'pagos';
  if (p.c === 'Asset') return 'rwa';
  if (p.c === 'Protocol/Contract') return 'defi';
  return 'comunidad';
}

/** estados: paleta categórica validada (3 tonos pasan todas las parejas en modo oscuro) */
export const STATUS_INFO = {
  L: { label: 'En producción', color: '#338ced' },
  P: { label: 'Prelanzamiento', color: '#e76624' },
  D: { label: 'En desarrollo', color: '#00a888' },
} as const;

/** radio del astro: crece con el logaritmo de la financiación del SCF y del TVL */
export function starSize(p: Pick<RavenProject, 'scf' | 'tvl'>): number {
  const weight = (p.scf ?? 0) / 25_000 + (p.tvl ?? 0) / 1_000_000;
  return 1.4 + Math.min(5.2, Math.log10(1 + weight) * 2.4);
}

export interface Star { kind: 'project' | 'partner'; index: number; galaxy: string; x: number; z: number; size: number }
export interface AtlasLayout { stars: Star[]; radius: Record<string, number> }

/**
 * Coloca cada astro en un brazo espiral de su galaxia, de dentro afuera por relevancia (financiación +
 * TVL), dejando libre el centro donde están los nodos curados. Determinista para que el mapa no cambie
 * entre visitas.
 */
export function layoutAtlas(
  snap: Pick<RavenSnapshot, 'projects' | 'partners'>,
  centers: Record<string, [number, number]>,
  inner: Record<string, number>,
  /** slugs que ya son nodos curados del mapa: no se duplican como estrella */
  exclude: Set<string> = new Set(),
): AtlasLayout {
  const groups: Record<string, { kind: Star['kind']; index: number; size: number; weight: number }[]> = {};
  snap.projects.forEach((p, index) => {
    if (exclude.has(p.s)) return;
    const g = galaxyForProject(p);
    (groups[g] ??= []).push({ kind: 'project', index, size: starSize(p), weight: (p.scf ?? 0) + (p.tvl ?? 0) / 10 + (p.au ? 50_000 : 0) });
  });
  snap.partners.forEach((_, index) => (groups.socios ??= []).push({ kind: 'partner', index, size: 2.6, weight: 0 }));

  const stars: Star[] = [];
  const radius: Record<string, number> = {};
  const SPACING = 330; // área por astro (u²)
  for (const [g, list] of Object.entries(groups)) {
    const c = centers[g];
    if (!c) continue;
    list.sort((a, b) => b.weight - a.weight || a.index - b.index);
    const r0 = (inner[g] ?? 16) + 24;
    // radio mínimo para que una galaxia pequeña no quede apiñada en el centro
    const R = Math.max(r0 + 110, Math.sqrt(r0 * r0 + (list.length * SPACING) / Math.PI));
    radius[g] = R + 26;
    const arms = list.length > 60 ? 3 : 2;
    list.forEach((item, i) => {
      // reparto uniforme en área entre r0 y R, girando a lo largo del brazo
      const f = (i + 0.5) / list.length;
      const r = Math.sqrt(r0 * r0 + f * (R * R - r0 * r0));
      const arm = i % arms;
      const twist = ((r - r0) / Math.max(1, R - r0)) * Math.PI * 1.35;
      const jitter = (hash(g, item.index) - 0.5) * 0.55;
      const a = (arm / arms) * Math.PI * 2 + twist + jitter;
      stars.push({ kind: item.kind, index: item.index, galaxy: g, x: c[0] + Math.cos(a) * r, z: c[1] + Math.sin(a) * r, size: item.size });
    });
  }
  return { stars, radius };
}

/**
 * Líneas de constelación: árbol de expansión mínima (Prim) entre los astros de una galaxia, sin aristas más
 * largas que `maxLen`. Une cada astro con sus vecinos más cercanos sin cruzar a otra galaxia y sin formar una
 * maraña. Devuelve pares de índices sobre `pts`.
 */
export function constellationEdges(pts: { x: number; z: number }[], maxLen = 90): [number, number][] {
  const n = pts.length;
  if (n < 2) return [];
  const inTree = new Uint8Array(n), best = new Float64Array(n).fill(Infinity), from = new Int32Array(n).fill(-1);
  const edges: [number, number][] = [];
  best[0] = 0;
  for (let k = 0; k < n; k++) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!inTree[i] && (u < 0 || best[i] < best[u])) u = i;
    inTree[u] = 1;
    if (from[u] >= 0 && best[u] <= maxLen) edges.push([from[u], u]);
    for (let v = 0; v < n; v++) {
      if (inTree[v]) continue;
      const d = Math.hypot(pts[u].x - pts[v].x, pts[u].z - pts[v].z);
      if (d < best[v]) { best[v] = d; from[v] = u; }
    }
  }
  return edges;
}

function hash(g: string, i: number): number {
  let h = 2166136261 ^ i;
  for (let k = 0; k < g.length; k++) h = Math.imul(h ^ g.charCodeAt(k), 16777619);
  return ((h >>> 0) % 10_000) / 10_000;
}

export function usd(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2).replace(/\.?0+$/, '')}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}

export const projectUrl = (slug: string) => `https://stellarlight.xyz/project/${encodeURIComponent(slug)}`;

/** resumen por galaxia para el cartel al entrar */
export function galaxyStats(snap: RavenSnapshot, g: string) {
  const ps = snap.projects.filter(p => galaxyForProject(p) === g);
  return {
    projects: ps.length,
    live: ps.filter(p => p.st === 'L').length,
    scf: ps.reduce((s, p) => s + (p.scf ?? 0), 0),
    tvl: ps.reduce((s, p) => s + (p.tvl ?? 0), 0),
    audited: ps.filter(p => p.au).length,
    partners: g === 'socios' ? snap.partners.length : 0,
  };
}
