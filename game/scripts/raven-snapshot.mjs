#!/usr/bin/env node
// Genera la instantánea del ecosistema Stellar que dibuja el Universo (src/world/data/raven.json).
//
// Los datos vienen de la API pública de Stellar Scout (stellarlight.xyz, licencia MIT, sin clave), la
// misma fuente que usa Raven para proyectos, financiación del SCF, TVL, auditorías, stablecoins, RWA,
// hackathons, socios y actividad de desarrolladores. Se guarda una copia fechada para que el juego
// funcione sin red; vuelve a ejecutarlo para refrescarla:
//
//   pnpm snapshot
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://stellarlight.xyz/api';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'world', 'data', 'raven.json');

async function get(path) {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(`${API}/${path}`, { headers: { accept: 'application/json', 'user-agent': 'stellar-conquer-snapshot' } });
      if (!r.ok) throw new Error(`${r.status} ${path}`);
      return await r.json();
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise(res => setTimeout(res, 800 * attempt));
    }
  }
}

const trim = (s, n) => {
  if (!s) return '';
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  return cut.slice(0, cut.lastIndexOf(' ') > n * 0.6 ? cut.lastIndexOf(' ') : n).replace(/[,;:.\s]+$/, '') + '…';
};
const num = v => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);
const STATUS = { Live: 'L', 'Pre-Release': 'P', Development: 'D' };

async function projects() {
  const out = [];
  for (const status of Object.keys(STATUS)) {
    for (let offset = 0; ; offset += 100) {
      const d = await get(`projects/search?status=${encodeURIComponent(status)}&view=compact&limit=100&offset=${offset}`);
      for (const p of d.projects) {
        if (out.some(x => x.s === p.slug)) continue;
        out.push({
          s: p.slug,
          n: p.name,
          c: p.category,
          t: p.types ?? [],
          d: trim(p.shortDescription, 170),
          st: STATUS[p.status] ?? 'D',
          scf: num(p.scfTotalAwardedUSD),
          tvl: num(p.tvlUSD),
          au: p.audits?.count ? { n: p.audits.count, by: p.audits.auditors ?? [], at: p.audits.latestAt ?? null } : null,
          r: p.reposCount ?? 0,
        });
      }
      if (offset + d.projects.length >= d.meta.counts.total || !d.projects.length) break;
    }
  }
  return out;
}

async function main() {
  const [list, eco, stable, rwa, board, audits, hacks, partners] = await Promise.all([
    projects(),
    get('analyze?dimension=all'),
    get('stablecoins?limit=50'),
    get('rwa?limit=100'),
    get('leaderboard?limit=20&range=90d&sort=activity'),
    get('audits?limit=100'),
    get('hackathons?limit=50'),
    get('partners?limit=100'),
  ]);

  const auditsByFirm = {};
  for (const a of audits.audits) auditsByFirm[a.auditor] = (auditsByFirm[a.auditor] ?? 0) + 1;

  const snapshot = {
    generatedAt: new Date().toISOString(),
    source: { name: 'Stellar Scout (stellarlight.xyz) vía Raven', url: 'https://stellarlight.xyz', license: 'MIT' },
    totals: {
      projects: eco.categories.totalProjects,
      scfProjects: eco.funding.scfAwardedProjects,
      scfUSD: num(eco.funding.scfTotalDistributedUSD),
      scfMeanUSD: num(eco.funding.meanAwardUSD),
      tvlUSD: num(eco.tvl.totalTvlUSD),
      tvlProvider: eco.tvl.provider,
      tvlAsOf: eco.tvl.asOf,
      hackathons: eco.hackathons.totalEvents,
      hackathonPrizeUSD: num(eco.hackathons.totalPrizePoolUSD),
      hackers: eco.hackathons.totalRegisteredHackers,
      audits: audits.meta.counts.total,
      stablecoins: stable.meta.counts.tracked,
      rwaAssets: rwa.meta.counts.registry,
      rwaIssuers: rwa.meta.counts.issuers,
      partners: partners.meta.counts.total,
    },
    developers: {
      asOf: eco.developers.asOf,
      source: eco.developers.source,
      monthlyActive: eco.developers.monthlyActiveDevs.total,
      exclusive: eco.developers.monthlyActiveDevs.exclusive,
      peak: eco.developers.monthlyActiveDevs.allTimePeak,
      yoyPct: eco.developers.monthlyActiveDevs.trend?.yoyPct ?? null,
      commits28d: eco.developers.commits28d,
      fullTime: eco.developers.tenure.fullTime,
    },
    categories: eco.categories.distribution.map(c => ({ c: c.category, n: c.projectCount, scfN: c.scfFundedCount, scf: num(c.scfTotalUSD) })),
    tvlTop: eco.tvl.top10.map(t => ({ s: t.slug, n: t.name, tvl: num(t.tvlUSD) })),
    stablecoins: stable.stablecoins.slice(0, 15).map(s => ({
      t: s.ticker, n: s.name, by: s.company, peg: s.peg, kind: s.assetType, cap: num(s.marketCapUSD), holders: num(s.holders),
    })),
    rwa: rwa.assets
      .filter(a => a.state === 'live' && a.rwaxyzValueUsd)
      .sort((a, b) => b.rwaxyzValueUsd - a.rwaxyzValueUsd)
      .slice(0, 12)
      .map(a => ({ n: a.name, sym: a.symbol ?? a.code, by: a.issuerEntity, cls: a.assetClass, usd: num(a.rwaxyzValueUsd) })),
    auditsByFirm: Object.entries(auditsByFirm).sort((a, b) => b[1] - a[1]).map(([firm, n]) => ({ firm, n })),
    activity: board.projects.slice(0, 15).map(p => ({ s: p.slug, n: p.name, commits: p.github?.commits90d ?? null })),
    hackathons: hacks.hackathons.slice(0, 20).map(h => ({
      n: h.name, start: h.startDate, end: h.endDate, prize: num(h.prizePoolUSD), hackers: num(h.hackersCount), by: typeof h.organizer === 'object' ? h.organizer?.name ?? null : h.organizer ?? null, url: h.url ?? h.externalUrl,
    })),
    partners: partners.partners.map(p => ({ n: p.name, type: p.partnerType, tag: trim(p.tagline, 90), url: p.websiteUrl, regions: p.regions ?? [], ramps: p.rampTypes ?? [] })),
    projects: list,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(snapshot));
  console.log(`raven.json: ${list.length} proyectos, ${snapshot.stablecoins.length} stablecoins, ${snapshot.hackathons.length} hackathons → ${OUT}`);
}

main().catch(e => { console.error(e); process.exit(1); });
