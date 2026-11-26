// Observatorio Raven: el panel de datos del ecosistema. Indicadores clave y gráficos de barras de una
// sola serie (dorado Stellar; el texto usa siempre los colores de texto, nunca el de la barra), con
// valor en la punta, tooltip al pasar el ratón y fuente y fecha en cada gráfico. Las barras de
// proyectos llevan a su astro en el universo.
import { ATLAS_GALAXIES, galaxyForProject, usd, type RavenSnapshot } from './atlas';
import { GALAXIES } from './ecosystem';

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
// separador de miles también en números de 4 cifras (en español no se agrupan por defecto)
const int = (n: number | null | undefined) => (n == null ? '—' : new Intl.NumberFormat('es', { useGrouping: 'always' } as unknown as Intl.NumberFormatOptions).format(Math.round(n)));
// una fecha sin hora ("2026-11-02") se lee como día local, no como medianoche UTC
const day = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(iso + 'T12:00:00') : new Date(iso);
  return d.toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
};

const CATEGORY_ES: Record<string, string> = {
  'User-Facing App': 'Apps para usuarios', Infrastructure: 'Infraestructura', Tooling: 'Herramientas',
  'Protocol/Contract': 'Protocolos y contratos', Asset: 'Activos', Anchor: 'Anclas', 'Partner Integration': 'Integraciones',
};

interface Row { label: string; value: number; display: string; tip: string; swatch?: string; fly?: string }

function bars(title: string, sub: string, rows: Row[]): string {
  const max = Math.max(1, ...rows.map(r => r.value));
  return `<section class="o-chart"><h3>${esc(title)}</h3><p class="o-sub">${esc(sub)}</p>
    <div class="o-bars">${rows.map(r => `
      <div class="o-row${r.fly ? ' o-link' : ''}" data-tip="${esc(r.tip)}"${r.fly ? ` data-fly="${esc(r.fly)}"` : ''}>
        <span class="o-label">${r.swatch ? `<i style="background:${r.swatch}"></i>` : ''}${esc(r.label)}</span>
        <span class="o-track"><b style="width:${Math.max(0.6, (r.value / max) * 100).toFixed(2)}%"></b></span>
        <span class="o-val">${esc(r.display)}</span>
      </div>`).join('')}</div></section>`;
}

function tile(label: string, value: string, note: string): string {
  return `<div class="o-tile"><span>${esc(label)}</span><b>${esc(value)}</b><small>${esc(note)}</small></div>`;
}

export function observatoryHtml(a: RavenSnapshot, visited: number): string {
  const t = a.totals, dv = a.developers;
  const bySlug = new Map(a.projects.map((p, i) => [p.s, i]));
  const fly = (slug: string) => (bySlug.has(slug) ? `project:${bySlug.get(slug)}` : undefined);

  const galaxyCounts = GALAXIES.filter(g => g.id !== 'frontera').map(g => {
    const n = g.id === 'socios' ? a.partners.length : a.projects.filter(p => galaxyForProject(p) === g.id).length;
    return { g, n };
  }).sort((x, y) => y.n - x.n);

  const sourceLine = `Fuente: ${a.source.name} · instantánea del ${day(a.generatedAt)}`;
  return `<div class="o-head">
      <div><h2>Observatorio Raven</h2><p class="o-sub">${esc(sourceLine)}. Cada estrella del universo es un proyecto de estos datos; has visitado ${visited} de ${a.projects.length}.</p></div>
    </div>
    <div class="o-tiles">
      ${tile('Proyectos activos', int(t.projects), 'en producción, prelanzamiento o desarrollo')}
      ${tile('Financiación del SCF', usd(t.scfUSD), `${int(t.scfProjects)} proyectos · media ${usd(t.scfMeanUSD)}`)}
      ${tile('TVL en DeFi', usd(t.tvlUSD), `${t.tvlProvider}, ${day(t.tvlAsOf)}`)}
      ${tile('Devs activos al mes', int(dv.monthlyActive), `${dv.yoyPct != null ? (dv.yoyPct > 0 ? '+' : '') + dv.yoyPct.toFixed(0) + ' % en un año' : ''} · ${dv.source}`)}
      ${tile('Hackathons', int(t.hackathons), `${usd(t.hackathonPrizeUSD)} en premios · ${int(t.hackers)} inscritos`)}
      ${tile('Auditorías', int(t.audits), 'informes registrados de contratos')}
      ${tile('Stablecoins', int(t.stablecoins), 'monedas estables seguidas en la red')}
      ${tile('Activos reales (RWA)', int(t.rwaAssets), `${int(t.rwaIssuers)} emisores verificados`)}
    </div>
    <div class="o-grid">
      ${bars('Proyectos por galaxia del universo', 'Cada proyecto va a la galaxia de su tipo principal.', galaxyCounts.map(({ g, n }) => ({
        label: g.name, value: n, display: int(n), swatch: g.color, tip: `${g.name}: ${int(n)} ${g.id === 'socios' ? 'socios' : 'proyectos'}`,
      })))}
      ${bars('Financiación del SCF por categoría', 'USD entregados por el Stellar Community Fund.', [...a.categories].sort((x, y) => y.scf - x.scf).filter(c => c.scf > 0).map(c => ({
        label: CATEGORY_ES[c.c] ?? c.c, value: c.scf, display: usd(c.scf), tip: `${CATEGORY_ES[c.c] ?? c.c}: ${usd(c.scf)} a ${int(c.scfN)} de ${int(c.n)} proyectos`,
      })))}
      ${bars('Proyectos con más TVL', `Valor bloqueado según ${t.tvlProvider}, ${day(t.tvlAsOf)}. Clic para volar al proyecto.`, a.tvlTop.map(p => ({
        label: p.n, value: p.tvl, display: usd(p.tvl), tip: `${p.n}: ${usd(p.tvl)} de TVL`, fly: fly(p.s),
      })))}
      ${bars('Stablecoins por capitalización', 'Capitalización en USD de las stablecoins seguidas en Stellar.', a.stablecoins.filter(s => s.cap).slice(0, 10).map(s => ({
        label: `${s.t} · ${s.by}`, value: s.cap!, display: usd(s.cap), tip: `${s.n} (${s.by}), ${s.kind}: ${usd(s.cap)}${s.holders ? ` · ${int(s.holders)} titulares` : ''}`,
      })))}
      ${bars('Activos reales tokenizados', 'Valor de los activos RWA más grandes emitidos en Stellar.', a.rwa.slice(0, 10).map(r => ({
        label: `${r.sym ?? ''} · ${r.by}`, value: r.usd, display: usd(r.usd), tip: `${r.n} (${r.cls}): ${usd(r.usd)}`,
      })))}
      ${bars('Actividad de desarrollo', 'Commits en los últimos 90 días en los repos de cada proyecto. Clic para volar.', a.activity.filter(p => p.commits).slice(0, 10).map(p => ({
        label: p.n, value: p.commits!, display: int(p.commits), tip: `${p.n}: ${int(p.commits)} commits en 90 días`, fly: fly(p.s),
      })))}
      ${bars('Auditorías por firma', 'Informes de auditoría de contratos Stellar registrados.', a.auditsByFirm.slice(0, 10).map(f => ({
        label: f.firm, value: f.n, display: int(f.n), tip: `${f.firm}: ${int(f.n)} informes`,
      })))}
      <section class="o-chart"><h3>Hackathons recientes</h3><p class="o-sub">${int(t.hackathons)} eventos registrados; estos son los últimos.</p>
        <table class="o-table"><tr><th>Evento</th><th>Fechas</th><th>Premios</th></tr>
        ${a.hackathons.slice(0, 8).map(h => `<tr><td>${h.url ? `<a href="${esc(h.url)}" target="_blank" rel="noopener">${esc(h.n)}</a>` : esc(h.n)}${h.by ? `<small>${esc(h.by)}</small>` : ''}</td><td>${day(h.start)}</td><td>${usd(h.prize)}</td></tr>`).join('')}
        </table></section>
    </div>
    <p class="o-foot">Los datos se regeneran con <code>pnpm snapshot</code> desde la API pública de Stellar Scout (licencia ${esc(a.source.license)}), la misma fuente que consulta Raven. Las galaxias nuevas de esta versión: ${ATLAS_GALAXIES.map(g => esc(g.name)).join(', ')}.</p>
    <div class="o-tip" id="o-tip"></div>`;
}

/** tooltips y clics de las barras */
export function wireObservatory(root: HTMLElement, onFly: (kind: 'project', index: number) => void) {
  const tip = root.querySelector<HTMLDivElement>('#o-tip')!;
  root.querySelectorAll<HTMLElement>('[data-tip]').forEach(el => {
    el.addEventListener('pointerenter', () => { tip.textContent = el.dataset.tip!; tip.style.display = 'block'; });
    el.addEventListener('pointermove', e => {
      const r = root.getBoundingClientRect();
      tip.style.transform = `translate(${e.clientX - r.left + 14}px, ${e.clientY - r.top + root.scrollTop + 12}px)`;
    });
    el.addEventListener('pointerleave', () => { tip.style.display = 'none'; });
    const f = el.dataset.fly;
    if (f) el.addEventListener('click', () => onFly('project', Number(f.split(':')[1])));
  });
}
