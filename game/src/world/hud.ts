// Interfaz del Universo Stellar: wallet, panel del nodo cercano (descubrimiento, DEX, mercado, puerto
// comercial y Frontera), inventario con la carga de partida y registro de operaciones.
import {
  ASSETS, ASSET_INFO, ITEMS, MAX_LOADOUT, ROYALTY, addToLoadout, bestRoute, buyFromShop, buyListing, cancelListing,
  discover, equipSkin, fmt, fulfillOrder, itemDef, listItem, quoteReceive, removeFromLoadout, spotPrice, swap,
  visitProject, VISIT_XLM, type Asset, type Result, type Sector, type WorldState,
} from './economy';
import { DISCOVERABLE, galaxyOf, nodeSlug, type Galaxy, type WorldNode } from './ecosystem';
import { STATUS_INFO, galaxyForProject, galaxyStats, projectUrl, usd, type RavenSnapshot, type Star } from './atlas';
import { observatoryHtml, wireObservatory } from './observatory';

const TYPE_ES: Record<string, string> = {
  Wallet: 'Wallet', DEX: 'DEX', Lending: 'Préstamos', Bridge: 'Puente', Infrastructure: 'Infraestructura', Payments: 'Pagos',
  Anchor: 'Ancla', SDK: 'SDK', Indexer: 'Indexador', Explorer: 'Explorador', Analytics: 'Analítica', AI: 'IA', Gaming: 'Juegos',
  Education: 'Educación', Security: 'Seguridad', NFT: 'NFT', RWA: 'Activos reales', Stablecoin: 'Stablecoin',
  'Social Impact': 'Impacto social', RPC: 'RPC', Faucet: 'Faucet', 'Card Issuing': 'Tarjetas', Exchange: 'Exchange',
  Oracle: 'Oráculo', Yield: 'Rendimiento', Derivatives: 'Derivados',
};
const PARTNER_ES: Record<string, string> = {
  anchor: 'Ancla', 'on-off-ramp': 'Rampa de entrada y salida', infrastructure: 'Infraestructura', tooling: 'Herramientas',
  protocol: 'Protocolo', wallet: 'Wallet', 'audit-firm': 'Firma de auditoría', legal: 'Legal', agency: 'Agencia',
  'asset-issuer': 'Emisor de activos', other: 'Otros',
};

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const DIFF_LABEL = { facil: 'Fácil', normal: 'Normal', dificil: 'Difícil' } as const;
const DIFF_MULT = { facil: 1, normal: 2, dificil: 3 } as const;

export interface WorldHudEvents {
  onChange(): void;
  onLaunch(sector: Sector): void;
  onQuickMatch(): void;
  setFrozen(f: boolean): void;
  onFlyToStar(kind: Star['kind'], index: number): void;
}

export class WorldHud {
  private root = document.createElement('div');
  private panel: HTMLDivElement;
  private toasts: HTMLDivElement;
  private node: WorldNode | null = null;
  private star: Star | null = null;
  private tab = '';
  private lastTop = '';
  private lastLog = '';

  constructor(host: HTMLElement, private w: WorldState, private ev: WorldHudEvents, private atlas: RavenSnapshot | null = null) {
    this.root.className = 'u-hud';
    this.root.innerHTML = `
      <div class="topbar u-top">
        <div class="brand"><span class="logo"></span>STELLAR<b>UNIVERSO</b></div>
        <div class="u-wallet" id="u-wallet"></div>
        <div class="u-progress" id="u-progress"></div>
        <div class="u-mode" title="La economía corre en tu navegador con las mismas reglas que los contratos. El siguiente paso es firmar con Freighter en testnet.">Simulación local · testnet en camino</div>
        <button class="u-btn" id="u-obs">Observatorio <kbd>O</kbd></button>
        <button class="u-btn" id="u-inv">Inventario <kbd>I</kbd></button>
        <button class="u-btn" id="u-help">Ayuda <kbd>H</kbd></button>
        <button class="u-btn" id="u-quick">Partida rápida</button>
      </div>
      <div class="u-galaxy" id="u-galaxy"></div>
      <div class="u-panel" id="u-panel"></div>
      <div class="u-log" id="u-log"></div>
      <div class="u-legend" id="u-legend"></div>
      <div class="toasts"></div>
      <div class="u-modal" id="u-modal"></div>`;
    host.appendChild(this.root);
    this.panel = this.$('#u-panel') as HTMLDivElement;
    this.toasts = this.$('.toasts') as HTMLDivElement;
    this.$('#u-inv').addEventListener('click', () => this.toggleInventory());
    this.$('#u-obs').addEventListener('click', () => this.toggleObservatory());
    if (atlas) {
      this.$('#u-legend').innerHTML = `<b>Cada estrella es un proyecto</b>${(['L', 'P', 'D'] as const).map(k =>
        `<span><i style="background:${STATUS_INFO[k].color}"></i>${STATUS_INFO[k].label}</span>`).join('')}
        <span><i class="ring"></i>con auditoría</span><span><i class="dia"></i>socio</span><span class="u-legend-size">tamaño = financiación SCF + TVL</span>`;
    } else this.$('#u-obs').style.display = 'none';
    this.$('#u-help').addEventListener('click', () => this.toggleHelp());
    this.$('#u-quick').addEventListener('click', () => this.ev.onQuickMatch());
    this.keyHandler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT') return;
      if (e.key === 'i' || e.key === 'I') this.toggleInventory();
      if (e.key === 'h' || e.key === 'H') this.toggleHelp();
      if (e.key === 'o' || e.key === 'O') this.toggleObservatory();
      if (e.key === 'Escape') this.closeModal();
    };
    window.addEventListener('keydown', this.keyHandler);
    this.panel.addEventListener('pointerdown', e => e.stopPropagation());
    this.update();
    if (!w.discovered.length && !w.log.length) this.toggleHelp();
  }
  private keyHandler: (e: KeyboardEvent) => void;

  private $(sel: string) { return this.root.querySelector(sel)! as HTMLElement; }

  toast(msg: string, kind: 'good' | 'bad' | 'info' = 'info') {
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.textContent = msg;
    this.toasts.appendChild(t);
    setTimeout(() => t.classList.add('out'), 3800);
    setTimeout(() => t.remove(), 4400);
  }

  private act(r: Result) {
    this.toast(r.msg, r.ok ? 'good' : 'bad');
    if (r.ok) this.ev.onChange();
    this.renderPanel();
    this.update();
    return r.ok;
  }

  /** barra superior y registro; barato, se llama cada frame */
  update() {
    const top = ASSETS.map(a => `<span class="u-chip" title="${esc(ASSET_INFO[a].name)}: ${esc(ASSET_INFO[a].note)}"><i style="background:${ASSET_INFO[a].color}"></i>${fmt(this.w.wallet[a])} <b>${a}</b></span>`).join('');
    const projects = this.atlas ? `Proyectos <b>${this.w.visited?.length ?? 0}/${this.atlas.projects.length}</b> · ` : '';
    const progress = `${projects}Nodos <b>${this.w.discovered.length}/${DISCOVERABLE.length}</b> · Sectores <b>${this.w.sectors.filter(s => s.owner === 'player').length}/${this.w.sectors.length}</b>`;
    if (top + progress !== this.lastTop) {
      this.$('#u-wallet').innerHTML = top;
      this.$('#u-progress').innerHTML = progress;
      this.lastTop = top + progress;
    }
    const log = this.w.log.slice(0, 5).map(l => `<div>${esc(l)}</div>`).join('');
    if (log !== this.lastLog) { this.$('#u-log').innerHTML = log; this.lastLog = log; }
  }

  setGalaxy(g: Galaxy | null) {
    const el = this.$('#u-galaxy');
    if (!g) { el.classList.remove('on'); return; }
    let stats = '';
    if (this.atlas && g.id !== 'frontera') {
      const st = galaxyStats(this.atlas, g.id);
      stats = g.id === 'socios'
        ? `<em>${st.partners} socios del ecosistema</em>`
        : `<em>${st.projects} proyectos · ${st.live} en producción · SCF ${usd(st.scf)}${st.tvl ? ` · TVL ${usd(st.tvl)}` : ''} · ${st.audited} auditados</em>`;
    }
    el.innerHTML = `<b style="color:${g.color}">${esc(g.name)}</b><span>${esc(g.blurb)}</span>${stats}`;
    el.classList.add('on');
  }

  setStar(s: Star | null) {
    if (s === this.star) return;
    this.star = s;
    if (s && s.kind === 'project' && this.atlas) {
      const p = this.atlas.projects[s.index];
      if (visitProject(this.w, p.s)) { this.toast(`Visitaste ${p.n}: +${VISIT_XLM} XLM`, 'good'); this.ev.onChange(); }
    }
    if (!this.node) this.renderPanel();
  }

  setNode(n: WorldNode | null) {
    if (n?.id === this.node?.id) return;
    this.node = n;
    const slug = n && nodeSlug(n.id);
    const p = slug && this.atlas?.projects.find(x => x.s === slug);
    if (p && visitProject(this.w, p.s)) { this.toast(`Visitaste ${p.n}: +${VISIT_XLM} XLM`, 'good'); this.ev.onChange(); }
    this.tab = '';
    this.renderPanel();
  }

  /** se llama en cada ledger: refresca listas que cambian solas (mercado, encargos) sin tocar formularios */
  onLedger() {
    if (this.node && (this.node.kind === 'market' && this.tab !== 'vender' || this.node.kind === 'trade')) this.renderPanel();
  }

  private renderPanel() {
    const n = this.node;
    if (!n && this.star && this.atlas) { this.renderStar(this.star); return; }
    if (!n) { this.panel.classList.remove('on'); this.panel.innerHTML = ''; return; }
    const g = galaxyOf(n.galaxy);
    const head = `<div class="u-ph"><small style="color:${g.color}">${esc(g.name)}</small><h2>${esc(n.name)}</h2></div><p class="u-desc">${esc(n.desc)}</p>`;
    const link = n.url ? `<a class="u-link" href="${esc(n.url)}" target="_blank" rel="noopener">Web oficial ↗</a>` : '';
    let body = '';
    if (n.kind === 'info') body = this.projectFacts(n) + this.infoBody(n);
    if (n.kind === 'dex') body = this.infoBody(n) + this.dexBody();
    if (n.kind === 'market') body = this.marketBody();
    if (n.kind === 'trade') body = this.tradeBody();
    if (n.kind === 'frontier') body = this.frontierBody(n);
    if (n.kind === 'atlas') body = this.atlasBody();
    this.panel.innerHTML = head + link + body;
    this.panel.classList.add('on');
    this.wire(n);
  }

  private infoBody(n: WorldNode): string {
    if (!n.quiz) return '';
    if (this.w.discovered.includes(n.id)) return `<div class="u-done">✓ Nodo descubierto</div>`;
    return `<div class="u-quiz"><b>Descúbrelo: ${esc(n.quiz.q)}</b>
      ${n.quiz.options.map((o, i) => `<button class="u-opt" data-quiz="${i}">${esc(o)}</button>`).join('')}
      <small>Recompensa: ${n.reward!.amount} ${n.reward!.asset}</small></div>`;
  }

  private dexBody(): string {
    const tabs = this.tabs(['swap', 'pools'], ['Cambiar', 'Pools']);
    if (this.tab === 'pools') {
      return tabs + `<table class="u-table"><tr><th>Pool</th><th>Reservas</th><th>Precio</th></tr>${this.w.pools.map(p =>
        `<tr><td>${p.a}/${p.b}</td><td>${fmt(p.ra)} / ${fmt(p.rb)}</td><td>1 ${p.a} = ${fmt(p.rb / p.ra)} ${p.b}</td></tr>`).join('')}</table>
        <p class="u-note">Pools de producto constante (x·y=k) con la comisión de 0,30 % de los pools nativos de Stellar.</p>`;
    }
    const opt = (sel: Asset) => ASSETS.map(a => `<option ${a === sel ? 'selected' : ''}>${a}</option>`).join('');
    return tabs + `<div class="u-form">
      <label>Das <select id="dx-from">${opt('XLM')}</select><input id="dx-amt" type="number" min="0" step="any" value="10"></label>
      <label>Recibes <select id="dx-to">${opt('STAR')}</select></label>
      <div class="u-quote" id="dx-quote"></div>
      <button class="u-cta" id="dx-go">Cambiar (tolerancia 1 %)</button></div>`;
  }

  private marketBody(): string {
    const tabs = this.tabs(['tienda', 'mercado', 'vender'], ['Tienda', 'Mercado', 'Vender']);
    if (this.tab === 'mercado') {
      const ls = this.w.listings;
      return tabs + (ls.length ? ls.map(l => {
        const d = itemDef(l.item);
        return `<div class="u-row"><div><b>${esc(d.name)}</b><small>${esc(l.seller)} · ${d.category}</small></div>
          <span class="u-price">${fmt(l.price)} STAR</span>
          ${l.mine ? `<button data-cancel="${l.id}">Retirar</button>` : `<button data-buyl="${l.id}">Comprar</button>`}</div>`;
      }).join('') : '<p class="u-note">No hay ofertas ahora mismo.</p>') +
        `<p class="u-note">Cada venta paga un ${ROYALTY * 100} % de regalía al tesoro. Los ítems a la venta quedan en custodia del contrato.</p>`;
    }
    if (this.tab === 'vender') {
      const owned = Object.entries(this.w.inventory).filter(([, n]) => n > 0);
      return tabs + (owned.length ? owned.map(([id, n]) => `<div class="u-row"><div><b>${esc(itemDef(id).name)}</b><small>tienes ${n} · tienda ${itemDef(id).price} STAR</small></div>
        <input type="number" min="0.1" step="0.1" value="${itemDef(id).price}" data-price="${id}"><button data-list="${id}">Publicar</button></div>`).join('')
        : '<p class="u-note">No tienes ítems. Cómpralos en la tienda o en el mercado.</p>');
    }
    return tabs + ITEMS.map(d => `<div class="u-row"><div><b>${d.color ? `<i class="u-sw" style="background:${d.color}"></i>` : ''}${esc(d.name)}</b><small>${esc(d.desc)}</small></div>
      <span class="u-price">${d.price} STAR</span><button data-shop="${d.id}">Comprar</button></div>`).join('') +
      `<p class="u-note">La mitad de cada compra en la tienda se quema: el suministro de STAR baja con el uso. Quemados hasta ahora: ${fmt(this.w.stats.burned)} STAR.</p>`;
  }

  private tradeBody(): string {
    if (!this.w.orders.length) return '<p class="u-note">No hay encargos ahora. Vuelve en unos ledgers.</p>';
    return this.w.orders.map(o => {
      const have = this.w.wallet[o.want];
      const left = o.expires - this.w.ledger;
      return `<div class="u-order"><div><b>${esc(o.station)}</b> pide <b>${o.amount} ${o.want}</b><small>paga ${fmt(o.reward)} ${o.pay} · caduca en ${left} ledgers · tienes ${fmt(have)}</small></div>
        <div class="u-btns">${have >= o.amount ? `<button class="u-cta" data-fill="${o.id}">Entregar</button>` : `<button data-source="${o.id}">Conseguir en el DEX</button>`}</div></div>`;
    }).join('') + `<p class="u-note">"Conseguir en el DEX" hace un path payment: paga con el activo que más te sobra y la red busca la ruta.</p>`;
  }

  private frontierBody(n: WorldNode): string {
    const s = this.w.sectors.find(x => x.id === n.sector)!;
    const load = this.w.loadout.length ? this.w.loadout.map(id => esc(itemDef(id).name)).join(', ') : 'nada (cárgala en el inventario)';
    return `<div class="u-kv"><span>Rival</span><b>${DIFF_LABEL[s.difficulty]}</b><span>Control</span><b class="${s.owner === 'player' ? 'ok' : 'bad'}">${s.owner === 'player' ? 'Tuyo' : 'Rival'}</b>
      <span>Recompensa</span><b>${10 * DIFF_MULT[s.difficulty]} STAR + sobrante en LMN/MTL/NRG</b><span>Carga</span><b>${load}</b></div>
      <button class="u-cta big" id="u-launch">${s.owner === 'player' ? 'Defender de nuevo' : 'Lanzar ataque'}</button>
      <p class="u-note">La partida es la simulación determinista del juego: seed + comandos. Al terminar se liquida como en el contrato Vault (sobrante con tope de 500 por recurso).</p>`;
  }

  /** datos de Raven para un nodo curado que es un proyecto del directorio */
  private projectFacts(n: WorldNode): string {
    const slug = nodeSlug(n.id);
    const p = slug && this.atlas?.projects.find(x => x.s === slug);
    if (!p) return '';
    const st = STATUS_INFO[p.st];
    return `<div class="u-chips"><span class="u-status"><i style="background:${st.color}"></i>${st.label}</span>${p.t.map(t => `<span>${esc(TYPE_ES[t] ?? t)}</span>`).join('')}</div>
      <div class="u-kv"><span>Financiación SCF</span><b>${p.scf ? usd(p.scf) : 'sin registro'}</b><span>TVL</span><b>${p.tvl ? usd(p.tvl) : '—'}</b>
      <span>Auditorías</span><b>${p.au ? `${p.au.n} · ${esc(p.au.by.join(', '))}` : 'sin registro'}</b></div>
      <a class="u-link" href="${projectUrl(p.s)}" target="_blank" rel="noopener">Ficha en Stellar Light ↗</a> `;
  }

  private atlasBody(): string {
    if (!this.atlas) return '<p class="u-note">No hay instantánea de datos. Genera una con <code>pnpm snapshot</code>.</p>';
    const t = this.atlas.totals;
    return `<div class="u-kv"><span>Proyectos</span><b>${t.projects.toLocaleString('es')}</b><span>SCF</span><b>${usd(t.scfUSD)}</b>
      <span>TVL</span><b>${usd(t.tvlUSD)}</b><span>Stablecoins</span><b>${t.stablecoins}</b></div>
      <button class="u-cta big" id="u-open-obs">Abrir el Observatorio</button>
      <p class="u-note">Atajo: tecla O desde cualquier punto del universo.</p>`;
  }

  /** ficha de un astro del atlas: proyecto (datos de Raven) o socio */
  private renderStar(s: Star) {
    const a = this.atlas!;
    const g = galaxyOf(s.galaxy);
    let html: string;
    if (s.kind === 'partner') {
      const p = a.partners[s.index];
      html = `<div class="u-ph"><small style="color:${g.color}">${esc(g.name)}</small><h2>${esc(p.n)}</h2></div>
        <div class="u-chips"><span>${esc(PARTNER_ES[p.type] ?? p.type)}</span>${p.ramps.map(r => `<span>${esc(r)}</span>`).join('')}</div>
        <p class="u-desc">${esc(p.tag)}</p>
        ${p.regions.length ? `<div class="u-kv"><span>Regiones</span><b>${esc(p.regions.join(', '))}</b></div>` : ''}
        ${p.url ? `<a class="u-link" href="${esc(p.url)}" target="_blank" rel="noopener">Web oficial ↗</a>` : ''}`;
    } else {
      const p = a.projects[s.index];
      const st = STATUS_INFO[p.st];
      const similar = a.projects
        .map((q, i) => ({ q, i }))
        .filter(({ q }) => q.s !== p.s && galaxyForProject(q) === s.galaxy && q.t.some(t => p.t.includes(t)))
        .sort((x, y) => ((y.q.scf ?? 0) + (y.q.tvl ?? 0)) - ((x.q.scf ?? 0) + (x.q.tvl ?? 0)))
        .slice(0, 4);
      html = `<div class="u-ph"><small style="color:${g.color}">${esc(g.name)}</small><h2>${esc(p.n)}</h2></div>
        <div class="u-chips"><span class="u-status"><i style="background:${st.color}"></i>${st.label}</span>${p.t.map(t => `<span>${esc(TYPE_ES[t] ?? t)}</span>`).join('')}</div>
        <p class="u-desc">${esc(p.d || 'Sin descripción en el directorio.')}</p>
        <div class="u-kv">
          <span>Financiación SCF</span><b>${p.scf ? usd(p.scf) : 'sin registro'}</b>
          <span>TVL</span><b>${p.tvl ? usd(p.tvl) : '—'}</b>
          <span>Auditorías</span><b>${p.au ? `${p.au.n} · ${esc(p.au.by.join(', '))}${p.au.at ? ` · última ${esc(p.au.at)}` : ''}` : 'sin registro'}</b>
          <span>Repositorios</span><b>${p.r || '—'}</b>
        </div>
        <a class="u-link" href="${projectUrl(p.s)}" target="_blank" rel="noopener">Ficha completa en Stellar Light ↗</a>
        ${similar.length ? `<h4 class="u-h4">Parecidos en esta galaxia</h4>${similar.map(({ q, i }) => `<button class="u-opt" data-star="${i}">${esc(q.n)}<small> · ${q.scf ? 'SCF ' + usd(q.scf) : STATUS_INFO[q.st].label}</small></button>`).join('')}` : ''}
        <p class="u-note">"Sin registro" significa que la fuente no tiene el dato, no que no exista. Datos del ${new Date(a.generatedAt).toLocaleDateString('es')}.</p>`;
    }
    this.panel.innerHTML = html;
    this.panel.classList.add('on');
    this.panel.querySelectorAll<HTMLButtonElement>('[data-star]').forEach(b => b.addEventListener('click', () => this.ev.onFlyToStar('project', Number(b.dataset.star))));
  }

  private toggleObservatory() {
    if (!this.atlas) return;
    const m = this.$('#u-modal');
    if (m.classList.contains('on')) { this.closeModal(); return; }
    const root = this.openModal(observatoryHtml(this.atlas, this.w.visited?.length ?? 0));
    const card = root.querySelector<HTMLElement>('.u-card')!;
    card.classList.add('wide');
    wireObservatory(card, (kind, index) => { this.closeModal(); this.ev.onFlyToStar(kind, index); });
  }

  private tabs(ids: string[], labels: string[]): string {
    if (!ids.includes(this.tab)) this.tab = ids[0];
    return `<div class="u-tabs">${ids.map((id, i) => `<button data-tab="${id}" class="${id === this.tab ? 'on' : ''}">${labels[i]}</button>`).join('')}</div>`;
  }

  private wire(n: WorldNode) {
    const p = this.panel;
    p.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b => b.addEventListener('click', () => { this.tab = b.dataset.tab!; this.renderPanel(); }));
    p.querySelectorAll<HTMLButtonElement>('[data-quiz]').forEach(b => b.addEventListener('click', () => {
      if (Number(b.dataset.quiz) === n.quiz!.answer) this.act(discover(this.w, n.id, n.reward!));
      else { b.classList.add('wrong'); this.toast('No es esa. Vuelve a leer la descripción.', 'bad'); }
    }));
    const from = p.querySelector<HTMLSelectElement>('#dx-from');
    if (from) {
      const to = p.querySelector<HTMLSelectElement>('#dx-to')!, amt = p.querySelector<HTMLInputElement>('#dx-amt')!;
      const quote = p.querySelector<HTMLDivElement>('#dx-quote')!;
      const refresh = () => {
        const a = from.value as Asset, b = to.value as Asset, x = Number(amt.value);
        const r = bestRoute(this.w, a, b, x);
        if (!r) { quote.innerHTML = a === b ? 'Elige dos activos distintos.' : 'Sin ruta.'; return; }
        const spot = spotPrice(this.w, a, b) * x;
        const impact = spot > 0 ? (1 - r.out / spot) * 100 : 0;
        quote.innerHTML = `Recibes ≈ <b>${fmt(r.out)} ${b}</b><br><small>Ruta: ${r.path.join(' › ')} · impacto ${impact.toFixed(2)} % · tienes ${fmt(this.w.wallet[a])} ${a}</small>`;
      };
      [from, to, amt].forEach(e => e.addEventListener('input', refresh));
      refresh();
      p.querySelector('#dx-go')!.addEventListener('click', () => {
        const a = from.value as Asset, b = to.value as Asset, x = Number(amt.value);
        const r = bestRoute(this.w, a, b, x);
        const keep = { from: a, to: b, amt: amt.value };
        this.act(swap(this.w, a, b, x, r ? r.out * 0.99 : 0));
        // conserva el formulario tras redibujar
        const f2 = p.querySelector<HTMLSelectElement>('#dx-from');
        if (f2) {
          f2.value = keep.from; p.querySelector<HTMLSelectElement>('#dx-to')!.value = keep.to;
          const a2 = p.querySelector<HTMLInputElement>('#dx-amt')!; a2.value = keep.amt; a2.dispatchEvent(new Event('input'));
        }
      });
    }
    p.querySelectorAll<HTMLButtonElement>('[data-shop]').forEach(b => b.addEventListener('click', () => this.act(buyFromShop(this.w, b.dataset.shop!))));
    p.querySelectorAll<HTMLButtonElement>('[data-buyl]').forEach(b => b.addEventListener('click', () => this.act(buyListing(this.w, Number(b.dataset.buyl)))));
    p.querySelectorAll<HTMLButtonElement>('[data-cancel]').forEach(b => b.addEventListener('click', () => this.act(cancelListing(this.w, Number(b.dataset.cancel)))));
    p.querySelectorAll<HTMLButtonElement>('[data-list]').forEach(b => b.addEventListener('click', () => {
      const price = Number(p.querySelector<HTMLInputElement>(`[data-price="${b.dataset.list}"]`)!.value);
      this.act(listItem(this.w, b.dataset.list!, price));
    }));
    p.querySelectorAll<HTMLButtonElement>('[data-fill]').forEach(b => b.addEventListener('click', () => this.act(fulfillOrder(this.w, Number(b.dataset.fill)))));
    p.querySelectorAll<HTMLButtonElement>('[data-source]').forEach(b => b.addEventListener('click', () => this.sourceOrder(Number(b.dataset.source))));
    p.querySelector('#u-launch')?.addEventListener('click', () => this.ev.onLaunch(this.w.sectors.find(x => x.id === n.sector)!));
    p.querySelector('#u-open-obs')?.addEventListener('click', () => this.toggleObservatory());
  }

  /** compra lo que falta para un encargo con un path payment desde el activo con el que salga más barato */
  private sourceOrder(id: number) {
    const o = this.w.orders.find(x => x.id === id);
    if (!o) return;
    const need = o.amount - this.w.wallet[o.want];
    let best: { from: Asset; in: number } | null = null;
    for (const a of ['XLM', 'USDC', 'STAR', 'LMN', 'MTL', 'NRG'] as Asset[]) {
      if (a === o.want) continue;
      const q = quoteReceive(this.w, a, o.want, need * 1.002);
      if (!q || q.in > this.w.wallet[a]) continue;
      const cost = q.in * spotPrice(this.w, a, 'USDC');
      if (!best || cost < best.in * spotPrice(this.w, best.from, 'USDC')) best = { from: a, in: q.in };
    }
    if (!best) { this.toast(`No te alcanza para comprar ${fmt(need)} ${o.want}. Gana recursos en la Frontera.`, 'bad'); return; }
    this.act(swap(this.w, best.from, o.want, best.in));
  }

  // ---------- modales ----------

  private closeModal() {
    const m = this.$('#u-modal');
    m.classList.remove('on');
    m.innerHTML = '';
    this.ev.setFrozen(false);
  }

  private openModal(html: string) {
    const m = this.$('#u-modal');
    m.innerHTML = `<div class="u-card"><button class="u-x" aria-label="Cerrar">×</button>${html}</div>`;
    m.classList.add('on');
    m.querySelector('.u-x')!.addEventListener('click', () => this.closeModal());
    m.addEventListener('pointerdown', e => { if (e.target === m) this.closeModal(); }, { once: true });
    this.ev.setFrozen(true);
    return m;
  }

  private toggleInventory() {
    if (this.$('#u-modal').classList.contains('on')) { this.closeModal(); return; }
    this.renderInventory();
  }

  private renderInventory() {
    const owned = Object.entries(this.w.inventory).filter(([, n]) => n > 0);
    const slots = Array.from({ length: MAX_LOADOUT }, (_, i) => {
      const id = this.w.loadout[i];
      return `<div class="u-slot ${id ? 'full' : ''}">${id ? `${esc(itemDef(id).name)}<button data-unload="${i}">×</button>` : 'vacío'}</div>`;
    }).join('');
    const m = this.openModal(`<h2>Inventario</h2>
      <h4>Carga de la próxima partida <small>(se quema al despegar, como Vault.open)</small></h4><div class="u-slots">${slots}</div>
      <h4>Tus ítems</h4>${owned.length ? owned.map(([id, n]) => {
        const d = itemDef(id);
        const action = d.category === 'skin'
          ? `<button data-equip="${id}">${this.w.skin === id ? 'Quitar' : 'Equipar'}</button>`
          : `<button data-load="${id}">Cargar</button>`;
        return `<div class="u-row"><div><b>${d.color ? `<i class="u-sw" style="background:${d.color}"></i>` : ''}${esc(d.name)} ×${n}</b><small>${esc(d.desc)}</small></div>${action}</div>`;
      }).join('') : '<p class="u-note">Aún no tienes ítems. Vuela a la Forja Soroban y visita el Mercado de la Armería.</p>'}
      <h4>Economía</h4><p class="u-note">Swaps: ${this.w.stats.swaps} · Encargos: ${this.w.stats.orders} · Victorias: ${this.w.stats.wins} · Derrotas: ${this.w.stats.losses} · STAR quemados: ${fmt(this.w.stats.burned)}</p>`);
    const rerender = (r: Result) => { this.toast(r.msg, r.ok ? 'good' : 'bad'); if (r.ok) this.ev.onChange(); this.update(); this.renderInventory(); };
    m.querySelectorAll<HTMLButtonElement>('[data-equip]').forEach(b => b.addEventListener('click', () => rerender(equipSkin(this.w, this.w.skin === b.dataset.equip ? null : b.dataset.equip!))));
    m.querySelectorAll<HTMLButtonElement>('[data-load]').forEach(b => b.addEventListener('click', () => rerender(addToLoadout(this.w, b.dataset.load!))));
    m.querySelectorAll<HTMLButtonElement>('[data-unload]').forEach(b => b.addEventListener('click', () => rerender(removeFromLoadout(this.w, Number(b.dataset.unload)))));
  }

  private toggleHelp() {
    if (this.$('#u-modal').classList.contains('on')) { this.closeModal(); return; }
    this.openModal(`<h2>Bienvenido al Universo Stellar</h2>
      <div class="u-help">
        <div><i>✦</i><b>Vuela</b><p>WASD o flechas para pilotar. Clic en un nodo o en el espacio para ir en piloto automático. Arrastra para girar la cámara y usa la rueda para acercarte.</p></div>
        <div><i>?</i><b>Descubre</b><p>Cada galaxia es un área del ecosistema Stellar. Acércate a un nodo, lee qué es y responde su pregunta para descubrirlo y cobrar la recompensa.</p></div>
        <div><i>⇄</i><b>Comercia</b><p>En la Galaxia DeFi está el DEX; en el Cúmulo de Pagos, el Puerto Comercial con encargos; en la Forja Soroban, el mercado de ítems.</p></div>
        <div><i>⚔</i><b>Conquista</b><p>La Frontera tiene sectores en disputa. Cada ataque es una partida de estrategia; gánala para quedarte el sector y cobrar STAR.</p></div>
      </div>
      <p class="u-note">Todo corre en tu navegador con las mismas reglas que los contratos del juego. Pronto podrás firmar con Freighter en testnet.</p>
      <button class="u-cta big" id="u-go">A volar</button>`).querySelector('#u-go')!.addEventListener('click', () => this.closeModal());
  }

  destroy() {
    window.removeEventListener('keydown', this.keyHandler);
    this.root.remove();
  }
}
