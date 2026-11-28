// HUD: recursos, ledger, panel de selección, botonera de órdenes, minimapa y avisos.
import { Vector3 } from 'three';
import { DEPOSITS, ERA_UP, ERAS, LEDGER_TICKS, MAP_HALF, MARKET, MODULES, QUEUE_MAX, TICK_HZ, UNITS } from '../sim/defs';
import { canAfford, cometHead, coreOf, hasBuilt, hiddenFrom, marketAccess, marketQuote, popCap, popUsed } from '../sim/sim';
import type { Command, Entity, Module, ModuleType, Res, ResKey, Side, SimState, Unit, UnitType } from '../sim/types';
import type { GameView } from '../render/view';
import type { SpaceScene } from '../render/scene';
import type { Input } from './input';
import { MODULE_GLYPH, MODULE_ROLE, ROLE_INFO, UNIT_GLYPH } from '../render/icons';
import { WORMHOLE_COLORS } from '../render/wormhole';
import { moduleThumb } from '../render/thumbs';
import { Tutorial } from './tutorial';

// explicación larga de cada botón: para qué sirve y cuándo conviene
const MODULE_HELP: Record<ModuleType, string> = {
  core: '',
  habitat: 'Aumenta tu población máxima en 8. Constrúyelo cuando el contador de población (arriba) esté cerca del límite.',
  solar: 'Produce energía sin parar. La energía se gasta en Fragatas, Titanes, Acorazados, torretas y eras avanzadas.',
  anchor: 'Puesto avanzado: se puede colocar LEJOS de tu estación, junto a un campo de asteroides. Los drones descargan ahí y viajan menos. Se le pueden acoplar módulos.',
  hangar: 'Fabrica naves: Interceptores (rápidos), Fragatas (era Consenso, artillería) y el Acorazado (era Galáctica).',
  factory: 'Fabrica robots de abordaje: Mechas y Titanes. Son los únicos que conquistan planetas y hacen doble daño a módulos.',
  lab: 'Laboratorio de Eras: necesario para avanzar de era desde el Núcleo. Además, tus drones minan un 20 % más rápido.',
  turret: 'Defensa automática que dispara a las unidades enemigas cercanas. Ponla en el lado que mira al rival.',
  beacon: 'La maravilla. Si resiste 30 ledgers (~2,5 min) ganas la partida. El rival intentará destruirlo.',
  seti: 'Inspirada en la búsqueda de señales extraterrestres: cada ledger capta una señal que suma 10 Lumens y 6 de energía. Barata y útil desde el principio.',
  replicator: 'Una sonda de Von Neumann: máquina que se fabrica a sí misma. Cada 30 s sale un dron gratis que se pone a minar (si tienes población libre).',
  shield: 'Proyecta una cúpula de fuerza: todo lo tuyo en un radio de 42 recibe 35 % menos daño. Ponlo en el centro de la estación.',
  dyson: 'Enjambre de colectores alrededor de una estrella artificial, la megaestructura más famosa de las tecnofirmas. Genera +3 de energía por segundo.',
  matrioshka: 'Capas de computadoras que rodean un sol y aprovechan su calor. +30 % de minería y todas tus fábricas producen 30 % más rápido.',
};
const UNIT_HELP: Record<UnitType, string> = {
  drone: 'Trabajador: mina asteroides (clic derecho sobre uno) y ensambla o repara módulos. No combate bien.',
  interceptor: 'Caza barato y veloz. Bueno para cazar drones y robots, débil contra estaciones.',
  mecha: 'Robot de abordaje: hace doble daño a módulos. Llévalo a la órbita de un planeta para conquistarlo.',
  frigate: 'Artillería de plasma de largo alcance. Destroza otras naves.',
  titan: 'Robot pesado que demuele estaciones y conquista planetas rápido.',
  dreadnought: 'Nave insignia, enorme y muy resistente. Ideal para el asalto final.',
};

interface Button { key: string; label: string; sub: string; cost?: Res; enabled: boolean; why?: string; run: () => void; glyph?: string; tint?: string; help?: string; module?: ModuleType }

/** nombre de la función a partir de su color, para el título del ícono del botón */
const ROLE_LABEL: Record<string, string> = Object.fromEntries(Object.values(ROLE_INFO).map(r => [r.color, r.label]));

const fmt = (n: number) => Math.floor(n).toLocaleString('es');
const costText = (c: Res) => [
  c.lumens ? `<span class="c-l">${c.lumens}</span>` : '',
  c.metal ? `<span class="c-m">${c.metal}</span>` : '',
  c.energy ? `<span class="c-e">${c.energy}</span>` : '',
].join(' ');

const BUILD_ORDER: ModuleType[] = ['habitat', 'solar', 'anchor', 'hangar', 'factory', 'lab', 'seti', 'turret', 'replicator', 'shield', 'dyson', 'matrioshka', 'beacon'];

export class Hud {
  private root: HTMLDivElement;
  private overlay: HTMLCanvasElement;
  private octx: CanvasRenderingContext2D;
  private mini: HTMLCanvasElement;
  private mctx: CanvasRenderingContext2D;
  private el: Record<string, HTMLElement> = {};
  private buttons: Button[] = [];
  private buttonsKey = '';
  private toasts: HTMLDivElement;
  private lastAlert = 0;
  private tutorial: Tutorial;
  private tip: HTMLDivElement;
  private hoverLabel: HTMLDivElement;
  private highlight: string | undefined;

  constructor(
    host: HTMLElement,
    private space: SpaceScene,
    private view: GameView,
    private input: Input,
    private side: Side,
    private send: (c: Command) => void,
  ) {
    this.overlay = document.createElement('canvas');
    this.overlay.className = 'overlay';
    host.appendChild(this.overlay);
    this.octx = this.overlay.getContext('2d')!;

    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="topbar">
        <div class="brand"><span class="logo"></span>STELLAR<b>CONQUER</b></div>
        <div class="res" data-tip="Lumens (XLM): se minan en asteroides con cristales dorados"><i class="ico l"></i><span id="r-l"></span></div>
        <div class="res" data-tip="Metal: se mina en asteroides cobrizos"><i class="ico m"></i><span id="r-m"></span></div>
        <div class="res" data-tip="Energía: la generan los paneles solares y se mina en cristales violetas"><i class="ico e"></i><span id="r-e"></span></div>
        <div class="res" data-tip="Población"><i class="ico p"></i><span id="r-p"></span></div>
        <div class="era" id="era"></div>
        <div class="stance" id="stance"></div>
        <div class="ledger"><span class="dot" id="ledger-dot"></span>Ledger <b id="ledger"></b><i id="ledger-bar"></i></div>
        <div class="clock" id="clock"></div>
      </div>
      <div class="bottom">
        <div class="dock minimap"><header>Mapa<span id="mini-coords"></span></header><canvas width="400" height="400" title="Clic: mover la cámara · clic derecho: enviar la selección"></canvas></div>
        <div class="dock selection"><header id="sel-head">Selección</header><div class="sel-body" id="sel"></div></div>
        <div class="dock orders"><header>Órdenes<span>atajo de teclado en la esquina</span></header><div class="commands" id="cmds"></div></div>
      </div>
      <details class="help"><summary>Controles</summary>
        <dl>
          <dt>Clic izquierdo</dt><dd>Seleccionar (arrastra para un recuadro, doble clic: todos los del mismo tipo)</dd>
          <dt>Clic derecho</dt><dd>Orden: mover, minar un asteroide, atacar al enemigo, reparar un módulo</dd>
          <dt>Ctrl + clic derecho</dt><dd>Avanzar atacando lo que haya en el camino</dd>
          <dt>Rueda / pellizco</dt><dd>Acercar y alejar</dd>
          <dt>Clic central o Alt + arrastrar</dt><dd>Girar e inclinar la galaxia en 3D (también Z / X / C / V)</dd>
          <dt>Flechas o bordes</dt><dd>Desplazar la cámara · clic en el minimapa para saltar</dd>
          <dt>Espacio</dt><dd>Volver al Núcleo · <b>.</b> busca un dron ocioso · <b>,</b> todo el ejército</dd>
          <dt>Ctrl + 1…9</dt><dd>Guardar grupo · Shift + número lo amplía · 1…9 lo recupera (dos veces: centra la cámara)</dd>
          <dt>P · + / −</dt><dd>Pausa · velocidad del juego (×0,5 a ×2)</dd>
          <dt>El mapa</dt><dd><b>Agujero negro</b>: frena a quien lo cruza · <b>Agujero de gusano</b>: manda tropas a una boca y salen por la del mismo color · <b>Nebulosa</b>: dentro no te ven desde lejos · <b>Cometa</b>: aparta tus tropas de la franja; deja cristales · <b>Planeta</b>: conquístalo o bombardéalo para romperlo</dd>
        </dl>
      </details>
      <div class="market-panel" id="market"></div>
      <div class="tip" id="tip"></div>
      <div class="hover-label" id="hover"></div>
      <div class="toasts"></div>
      <div class="placing" id="placing"></div>
    `;
    host.appendChild(this.root);
    for (const id of ['r-l', 'r-m', 'r-e', 'r-p', 'era', 'ledger', 'ledger-dot', 'ledger-bar', 'stance', 'clock', 'sel', 'cmds', 'placing']) {
      this.el[id] = this.root.querySelector('#' + id)!;
    }
    this.toasts = this.root.querySelector('.toasts')!;
    this.tip = this.root.querySelector('#tip')!;
    this.hoverLabel = this.root.querySelector('#hover')!;
    this.tutorial = new Tutorial(this.root);
    this.el.cmds.addEventListener('mouseover', e => {
      const b = (e.target as HTMLElement).closest('button');
      const btn = b ? this.buttons[Number(b.dataset.i)] : null;
      if (!b || !btn) { this.tip.classList.remove('show'); return; }
      // edificio: vista previa del modelo, su función y sus beneficios antes de construirlo
      const m = btn.module;
      const role = m ? ROLE_INFO[MODULE_ROLE[m]] : null;
      const preview = m && role ? `<div class="tip-preview" style="--role:${role.color}">
          <img src="${moduleThumb(m, this.side)}" alt="${btn.label}"><span class="tip-role">${role.label}</span></div>
          <div class="tip-benefits">${MODULES[m].benefits.map(b => `<span>${b}</span>`).join('')}</div>` : '';
      this.tip.innerHTML = `${preview}<h4>${btn.glyph ? `<i${role ? ` style="color:${role.color}"` : ''}>${btn.glyph}</i>` : ''}${btn.label} <kbd>${btn.key === 'Backspace' ? '⌫' : btn.key}</kbd></h4>
        ${btn.help ? `<p>${btn.help}</p>` : ''}<div class="tip-cost">${btn.sub}</div>${btn.why ? `<em>${btn.why}</em>` : ''}`;
      const r = b.getBoundingClientRect();
      this.tip.style.left = `${Math.min(window.innerWidth - 310, r.left)}px`;
      this.tip.style.bottom = `${window.innerHeight - r.top + 8}px`;
      this.tip.classList.add('show');
    });
    this.el.cmds.addEventListener('mouseleave', () => this.tip.classList.remove('show'));
    this.mini = this.root.querySelector('.minimap canvas')!;
    this.mctx = this.mini.getContext('2d')!;
    this.mini.addEventListener('pointerdown', e => this.onMinimap(e));
    this.mini.addEventListener('pointermove', e => { if (e.buttons & 1) this.onMinimap(e); });
    this.mini.addEventListener('contextmenu', e => e.preventDefault());
    this.el.cmds.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      const btn = this.buttons[Number(b.dataset.i)];
      if (btn?.enabled) btn.run();
    });
    const resize = () => {
      this.overlay.width = host.clientWidth * devicePixelRatio;
      this.overlay.height = host.clientHeight * devicePixelRatio;
    };
    resize();
    window.addEventListener('resize', resize);
  }

  hotkey(key: string): boolean {
    const b = this.buttons.find(x => x.key === key);
    if (!b) return false;
    if (b.enabled) b.run();
    return true;
  }

  toast(text: string, kind: 'info' | 'good' | 'bad' = 'info') {
    const d = document.createElement('div');
    d.className = 'toast ' + kind;
    d.textContent = text;
    this.toasts.appendChild(d);
    setTimeout(() => d.classList.add('out'), 3200);
    setTimeout(() => d.remove(), 3800);
  }

  onEvents(s: SimState) {
    for (const ev of s.events) {
      if (ev.kind === 'era') {
        const who = ev.side === this.side ? 'Tu estación' : 'El rival';
        this.toast(`${who} avanza a la Era ${ERAS[ev.era].name}: ${ERAS[ev.era].lema}`, ev.side === this.side ? 'good' : 'bad');
      } else if (ev.kind === 'anomaly') {
        // las anomalías llegan en pareja (campo y espejo): un solo aviso
        if (ev === s.events.find(x => x.kind === 'anomaly')) this.toast(`Anomalía detectada: apareció un campo de ${DEPOSITS[ev.res].short} en zona neutral (mira el minimapa)`, 'good');
      } else if (ev.kind === 'comet') {
        this.toast(ev.phase === 'warn' ? '¡Cometa a la vista! Aparta tus tropas de la franja marcada: daña lo que toca'
          : 'El cometa dejó cristales de energía helada en su estela (mira el minimapa)', ev.phase === 'warn' ? 'bad' : 'good');
      } else if (ev.kind === 'planetDestroyed') {
        const loot = `+${ev.loot.lumens} Lumens, +${ev.loot.metal} metal, +${ev.loot.energy} energía`;
        this.toast(ev.side === this.side ? `¡Rompiste ${ev.name}! Botín: ${loot}. Sus escombros son ricos en recursos`
          : ev.side === -1 ? `${ev.name} se ha roto` : `El rival rompió ${ev.name} y se llevó su botín`, ev.side === this.side ? 'good' : 'bad');
      } else if (ev.kind === 'captured') {
        const p = s.entities.get(ev.planet);
        const name = p && p.kind === 'planet' ? p.name : 'un planeta';
        this.toast(ev.side === this.side ? `Conquistaste ${name}: +Lumens cada ledger` : `El rival conquistó ${name}`, ev.side === this.side ? 'good' : 'bad');
      } else if (ev.kind === 'built' && ev.side === this.side) {
        const m = s.entities.get(ev.id);
        if (m && m.kind === 'module') this.toast(`${MODULES[m.type].name} acoplado`, 'info');
      } else if (ev.kind === 'shot' && ev.side !== this.side) {
        const now = performance.now();
        const target = [...s.entities.values()].find(e => (e.kind === 'module') && e.side === this.side && Math.hypot(e.pos.x - ev.to.x, e.pos.z - ev.to.z) < 1);
        if (target && now - this.lastAlert > 12000) { this.lastAlert = now; this.toast('¡Tu estación está bajo ataque!', 'bad'); }
      }
    }
  }

  // ---------- por cuadro ----------

  update(s: SimState) {
    const pl = s.players[this.side];
    this.updateMarket(s);
    this.el['r-l'].textContent = fmt(pl.res.lumens);
    this.el['r-m'].textContent = fmt(pl.res.metal);
    this.el['r-e'].textContent = fmt(pl.res.energy);
    const used = popUsed(s, this.side), cap = popCap(s, this.side);
    this.el['r-p'].textContent = `${used}/${cap}`;
    this.el['r-p'].parentElement!.classList.toggle('full', used >= cap);
    this.el.era.textContent = `Era ${ERAS[pl.era].name}`;
    // postura del rival: en paz hasta que le disparas
    const war = !s.players[this.side === 0 ? 1 : 0].holdFire;
    if (this.el.stance.dataset.war !== String(war)) {
      if (this.el.stance.dataset.war === 'false' && war) this.toast('Atacaste al rival: ahora responderá con oleadas', 'bad');
      this.el.stance.dataset.war = String(war);
      this.el.stance.className = 'stance' + (war ? ' war' : '');
      this.el.stance.textContent = war ? '⚔ Rival en guerra' : '☮ Rival en paz';
      this.el.stance.title = war ? 'El rival fue atacado y contraataca con oleadas.' : 'El rival no atacará hasta que le dispares. Crece a tu ritmo.';
    }
    this.el.ledger.textContent = '#' + s.ledger.toLocaleString('es');
    const lp = (s.tick % LEDGER_TICKS) / LEDGER_TICKS;
    this.el['ledger-bar'].style.width = `${lp * 100}%`;
    this.el['ledger-dot'].classList.toggle('on', lp < 0.08);
    const secs = Math.floor(s.tick / TICK_HZ);
    this.el.clock.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    this.el.placing.textContent = this.input.ui.buildMode
      ? `${MODULES[this.input.ui.buildMode].name}: ${this.input.placeReason() || 'clic para acoplar'} · Shift: colocar varios · Esc / clic derecho: cancelar`
      : '';
    this.el.placing.classList.toggle('show', !!this.input.ui.buildMode);
    this.highlight = this.tutorial.update(s, this.side, this.input.ui.selected);
    this.updateSelection(s);
    this.updateButtons(s);
    this.updateHover(s);
    this.drawMinimap(s);
    this.drawOverlay(s);
  }

  private selection(s: SimState): Entity[] {
    const out: Entity[] = [];
    for (const id of this.input.ui.selected) { const e = s.entities.get(id); if (e) out.push(e); }
    return out;
  }

  private updateSelection(s: SimState) {
    const sel = this.selection(s);
    let html = '';
    if (sel.length === 0) {
      html = `<div class="empty"><b>Nada seleccionado</b>Arrastra un recuadro sobre tus drones (cian) o haz clic en un módulo de tu estación para ver qué puede hacer.</div>`;
    } else if (sel.length === 1) {
      const e = sel[0];
      if (e.kind === 'unit') {
        const d = UNITS[e.type];
        const task = e.order.kind === 'gather' ? (e.carry ? `Minando ${DEPOSITS[e.carry.res].short} (${Math.floor(e.carry.amount)})` : 'Minando')
          : e.order.kind === 'build' ? 'Ensamblando' : e.order.kind === 'attack' ? 'Atacando' : e.order.kind === 'move' ? 'En ruta' : 'En espera';
        const hint = e.side !== this.side ? 'Unidad enemiga: selecciona tus tropas y haz clic derecho sobre ella para atacarla.'
          : e.type === 'drone' ? 'Clic derecho en un asteroide para minar · elige un módulo a la derecha para construir · clic derecho en un módulo dañado para repararlo.'
          : UNITS[e.type].cls === 'robot' ? 'Clic derecho sobre un planeta para conquistarlo (Ctrl para bombardearlo), o sobre un enemigo para atacarlo.'
          : 'Clic derecho sobre un enemigo o un planeta ajeno para atacarlo · Ctrl+clic derecho para avanzar atacando.';
        html = this.card(d.name, d.desc, e.hp, e.maxHp, e.side, `
          <div class="stats"><span>ATQ<b>${d.damage}</b></span><span>ALC<b>${d.range}</b></span><span>VEL<b>${d.speed}</b></span><span class="task">${task}</span></div>`, hint, UNIT_GLYPH[e.type]);
      } else if (e.kind === 'module') {
        const d = MODULES[e.type];
        let extra = '';
        if (e.built < 1) extra = `<div class="progress"><i style="width:${e.built * 100}%"></i><span>Ensamblaje ${Math.floor(e.built * 100)} %</span></div>`;
        else if (e.queue.length) {
          const q = e.queue[0];
          // cola en casillas: la primera se rellena con el progreso, el resto espera (hasta QUEUE_MAX)
          const slots = e.queue.map((it, i) => {
            const g = it.item === 'era' ? '⬆' : UNIT_GLYPH[it.item];
            const name = it.item === 'era' ? 'Avance de era' : UNITS[it.item].name;
            return `<span class="slot full${i === 0 ? ' now' : ''}" title="${name}">${i === 0 ? `<i style="height:${(it.progress / it.total) * 100}%"></i>` : ''}<b>${g}</b></span>`;
          }).join('');
          const nowName = q.item === 'era' ? 'Avance de era' : UNITS[q.item].name;
          extra = `<div class="q-now"><span>${nowName} · <b>${Math.ceil(q.total - q.progress)} s</b></span><span>${e.queue.length}/${QUEUE_MAX} en cola</span></div><div class="queue">${slots}</div>`;
        }
        if (e.type === 'beacon' && e.built >= 1) extra += `<div class="stats"><span>Quórum: ${s.players[e.side].beaconLedgers}/30 ledgers</span></div>`;
        const hint = e.side !== this.side ? 'Módulo enemigo: los robots le hacen el doble de daño.'
          : e.built < 1 ? 'En ensamblaje: selecciona drones y haz clic derecho aquí para acelerarlo.'
          : MODULES[e.type].trains.length ? 'Pulsa un botón de la derecha para fabricar. Clic derecho en el mapa fija el punto de reunión de lo que salga.'
          : e.type === 'lab' ? 'Ya puedes avanzar de era: selecciona el Núcleo y pulsa «Avanzar».' : MODULE_HELP[e.type];
        extra = `<div class="card-benefits" style="--role:${ROLE_INFO[MODULE_ROLE[e.type]].color}"><b>${ROLE_INFO[MODULE_ROLE[e.type]].label}</b>${d.benefits.map(b => `<span>${b}</span>`).join('')}</div>` + extra;
        html = this.card(d.name, d.desc, e.hp, e.maxHp, e.side, extra, hint, MODULE_GLYPH[e.type], moduleThumb(e.type, e.side));
      } else if (e.kind === 'asteroid') {
        html = this.card(DEPOSITS[e.res].name, `Quedan ${Math.floor(e.amount)} unidades.`, 0, 0, -1, '',
          'Selecciona drones y haz clic derecho sobre él para minarlo.');
      } else {
        const owner = e.owner === -1 ? 'Neutral' : e.owner === this.side ? 'Tuyo' : 'Del rival';
        html = this.card(`Planeta ${e.name}`, `${owner}. Conquístalo con robots en su órbita (paga Lumens cada ledger) o bombardéalo: al romperse da botín y deja escombros ricos.`, e.hp, e.maxHp, e.owner, `
          <div class="progress cap"><i style="width:${Math.abs(e.capture) * 100}%; background:${e.capture >= 0 ? 'var(--ally)' : 'var(--enemy)'}"></i><span>Control ${Math.round(Math.abs(e.capture) * 100)} %</span></div>`);
      }
    } else {
      const counts = new Map<string, number>();
      for (const e of sel) if (e.kind === 'unit') counts.set(UNITS[e.type].name, (counts.get(UNITS[e.type].name) ?? 0) + 1);
      html = `<div class="multi">${[...counts].map(([n, c]) => `<span><b>${c}</b> ${n}</span>`).join('')}</div>
        <div class="hint"><i>i</i>${sel.every(e => e.kind === 'unit' && e.type === 'drone')
          ? 'Clic derecho en un asteroide para minar · elige un módulo a la derecha y colócalo en un hexágono verde para construir.'
          : 'Clic derecho: mover o atacar · Ctrl+clic derecho: avanzar atacando · Ctrl+1…9: guardar este grupo.'}</div>`;
    }
    if (this.el.sel.innerHTML !== html) this.el.sel.innerHTML = html;
    const head = sel.length > 1 ? `Selección<span>${sel.length} unidades</span>` : 'Selección';
    const h = this.root.querySelector<HTMLElement>('#sel-head')!;
    if (h.innerHTML !== head) h.innerHTML = head;
  }

  // ---------- Mercado Central ----------

  private marketKey = '';
  private marketWired = false;
  private hadAccess = false;

  /** panel de comercio: se abre solo cuando tienes flota junto al Mercado Central */
  private updateMarket(s: SimState) {
    const el = this.root.querySelector('#market') as HTMLDivElement;
    if (!this.marketWired) {
      this.marketWired = true;
      el.addEventListener('click', e => {
        const b = (e.target as HTMLElement).closest('button[data-give]') as HTMLButtonElement | null;
        if (b && !b.disabled) this.send({ kind: 'trade', give: b.dataset.give as ResKey, get: b.dataset.get as ResKey });
      });
    }
    const access = marketAccess(s, this.side);
    if (access && !this.hadAccess) this.toast('Llegaste al Mercado Central: cambia recursos en el panel de la derecha', 'good');
    this.hadAccess = access;
    const pl = s.players[this.side];
    const keys: ResKey[] = ['lumens', 'metal', 'energy'];
    const NAME: Record<ResKey, string> = { lumens: 'Lumens', metal: 'metal', energy: 'energía' };
    const CLS: Record<ResKey, string> = { lumens: 'c-l', metal: 'c-m', energy: 'c-e' };
    const pairs = keys.flatMap(g => keys.filter(x => x !== g).map(x => [g, x] as const));
    const quotes = pairs.map(([g, x]) => marketQuote(s, g, x));
    const key = `${access}|${quotes.join(',')}|${keys.map(k => pl.res[k] >= MARKET.lot ? 1 : 0).join('')}`;
    if (key === this.marketKey) return;
    this.marketKey = key;
    el.classList.toggle('open', access);
    if (!access) {
      el.innerHTML = `<b>Mercado Central</b><span>Lleva una nave o un robot al centro del mapa para cambiar recursos</span>`;
      return;
    }
    el.innerHTML = `<header><b>Mercado Central</b><span>lote de ${MARKET.lot} · comisión ${Math.round(MARKET.fee * 100)} %</span></header>
      <div class="mk-grid">${pairs.map(([g, x], i) => `<button data-give="${g}" data-get="${x}" ${pl.res[g] < MARKET.lot ? 'disabled' : ''}
        title="Das ${MARKET.lot} de ${NAME[g]} y recibes ${quotes[i]} de ${NAME[x]}"><span class="${CLS[g]}">${MARKET.lot}</span><i>→</i><span class="${CLS[x]}">${quotes[i]}</span></button>`).join('')}</div>
      <footer>Vender abarata lo que vendes y encarece lo que compras; los precios se recuperan con cada ledger.</footer>`;
  }

  private card(name: string, desc: string, hp: number, max: number, side: number, extra: string, hint = '', glyph = '', img = '') {
    const k = max > 0 ? hp / max : 1;
    const hpBar = max > 0 ? `<div class="hp ${k > 0.6 ? '' : k > 0.3 ? 'mid' : 'low'}"><i style="width:${k * 100}%"></i></div><div class="hp-num"><span>Integridad</span><b>${Math.ceil(hp)} / ${max}</b></div>` : '';
    const tag = side === this.side ? 'Tuyo' : side === -1 ? 'Neutral' : 'Rival';
    return `<div class="card side-${side === this.side ? 0 : side === -1 ? -1 : 1}">
      <div class="card-id">${img ? `<img class="card-img" src="${img}" alt="">` : glyph ? `<i class="card-g">${glyph}</i>` : ''}<div><h3>${name}</h3><p>${desc}</p></div><span class="card-tag">${tag}</span></div>
      ${hpBar}${extra}${hint ? `<div class="hint"><i>i</i>${hint}</div>` : ''}</div>`;
  }

  private updateButtons(s: SimState) {
    const pl = s.players[this.side];
    const sel = this.selection(s);
    const buttons: Button[] = [];
    const units = sel.filter((e): e is Unit => e.kind === 'unit' && e.side === this.side);
    const mod = sel.length === 1 && sel[0].kind === 'module' && sel[0].side === this.side ? sel[0] as Module : null;

    if (units.some(u => u.type === 'drone')) {
      for (const t of BUILD_ORDER) {
        const d = MODULES[t];
        const eraOk = pl.era >= d.era;
        const afford = canAfford(pl.res, d.cost);
        buttons.push({
          key: d.hotkey, label: d.name, sub: costText(d.cost), cost: d.cost, enabled: eraOk && afford, glyph: MODULE_GLYPH[t], tint: ROLE_INFO[MODULE_ROLE[t]].color, help: MODULE_HELP[t], module: t,
          why: !eraOk ? `Era ${ERAS[d.era].name}` : !afford ? 'Faltan recursos' : '',
          run: () => this.input.startBuild(t),
        });
      }
    }
    if (mod && mod.built >= 1) {
      for (const t of MODULES[mod.type].trains) {
        const d = UNITS[t as UnitType];
        const eraOk = pl.era >= d.era;
        const afford = canAfford(pl.res, d.cost);
        buttons.push({
          key: d.hotkey, label: d.name, sub: costText(d.cost), enabled: eraOk && afford && mod.queue.length < QUEUE_MAX,
          glyph: UNIT_GLYPH[t as UnitType], help: UNIT_HELP[t as UnitType],
          why: !eraOk ? `Era ${ERAS[d.era].name}` : mod.queue.length >= QUEUE_MAX ? `Cola llena (${QUEUE_MAX})` : !afford ? 'Faltan recursos' : '',
          run: () => this.send({ kind: 'train', module: mod.id, unit: t }),
        });
      }
      if (mod.type === 'core' && pl.era < 4) {
        const next = (pl.era + 1) as 2 | 3 | 4;
        const up = ERA_UP[next];
        const lab = hasBuilt(s, this.side, 'lab');
        const busy = mod.queue.some(q => q.item === 'era');
        buttons.push({
          key: 'U', label: `Avanzar a ${ERAS[next].name}`, sub: costText(up.cost), glyph: '⬆',
          help: `Investiga la era ${ERAS[next].name} (${up.time} s): «${ERAS[next].lema}». Desbloquea módulos y unidades nuevas.`,
          enabled: lab && !busy && canAfford(pl.res, up.cost),
          why: !lab ? 'Requiere Laboratorio de Eras' : busy ? 'Investigando' : !canAfford(pl.res, up.cost) ? 'Faltan recursos' : '',
          run: () => this.send({ kind: 'era', module: mod.id }),
        });
      }
      if (mod.queue.length) buttons.push({ key: 'Backspace', label: 'Cancelar', sub: 'último en cola', enabled: true, run: () => this.send({ kind: 'cancel', module: mod.id }) });
    }
    if (mod && mod.built < 1) buttons.push({ key: 'Backspace', label: 'Cancelar ensamblaje', sub: 'devuelve 75 %', enabled: true, run: () => this.send({ kind: 'cancel', module: mod.id }) });

    this.buttons = buttons;
    const key = buttons.map(b => `${b.key}${b.label}${b.enabled}${b.why}`).join('|') + (this.highlight ?? '');
    if (key === this.buttonsKey) return;
    this.buttonsKey = key;
    this.el.cmds.innerHTML = buttons.map((b, i) => `
      <button data-i="${i}" class="${b.enabled ? '' : 'off'} ${b.key === this.highlight ? 'hl' : ''}">
        <kbd>${b.key === 'Backspace' ? '⌫' : b.key}</kbd><span class="c-top">${b.glyph ? `<i class="g"${b.tint ? ` style="color:${b.tint}" title="${ROLE_LABEL[b.tint] ?? ''}"` : ''}>${b.glyph}</i>` : ''}<b>${b.label}</b></span><small>${b.sub}</small>${b.why ? `<em>${b.why}</em>` : ''}
      </button>`).join('');
  }

  // etiqueta junto al cursor: qué es lo que hay debajo y qué hacer con ello
  private updateHover(s: SimState) {
    const m = this.input.mousePos;
    // solo cuando el cursor está sobre el espacio 3D, no sobre paneles ni el minimapa
    const overWorld = document.elementFromPoint(m.x, m.y) === this.space.renderer.domElement;
    const e = !overWorld || this.input.ui.buildMode || this.input.ui.dragRect ? null : this.input.pick(m.x, m.y);
    if (!e) { this.hoverLabel.classList.remove('show'); return; }
    const hasDrones = this.input.selectedUnits().some(u => u.type === 'drone');
    const hasArmy = this.input.selectedUnits().some(u => u.type !== 'drone');
    let name = '', act = '', cls = '';
    if (e.kind === 'asteroid') {
      name = DEPOSITS[e.res].name;
      act = hasDrones ? 'Clic derecho: minar' : 'Selecciona drones para minarlo';
      cls = e.res;
    } else if (e.kind === 'planet') {
      name = `Planeta ${e.name}` + (e.owner === this.side ? ' (tuyo)' : e.owner === -1 ? ' (neutral)' : ' (rival)');
      const hasRobots = this.input.selectedUnits().some(u => UNITS[u.type].cls === 'robot');
      const pct = Math.ceil((e.hp / e.maxHp) * 100);
      name += pct < 100 ? ` · ${pct} % de integridad` : '';
      act = e.owner === this.side ? 'Te paga Lumens cada ledger'
        : !hasArmy ? 'Conquístalo con robots o bombardéalo hasta romperlo'
        : hasRobots ? 'Clic derecho: conquistar · Ctrl + clic derecho: bombardear'
        : 'Clic derecho: bombardear (al romperse suelta botín y escombros ricos)';
      cls = e.owner === this.side ? 'ally' : e.owner === -1 ? '' : 'enemy';
    } else if (e.kind === 'unit') {
      name = UNITS[e.type].name;
      cls = e.side === this.side ? 'ally' : 'enemy';
      act = e.side !== this.side && (hasArmy || hasDrones) ? 'Clic derecho: atacar' : '';
    } else {
      name = MODULES[e.type].name + (e.built < 1 ? ` (${Math.floor(e.built * 100)} %)` : '');
      cls = e.side === this.side ? 'ally' : 'enemy';
      act = e.side !== this.side ? (hasArmy || hasDrones ? 'Clic derecho: atacar' : '')
        : hasDrones && (e.built < 1 || e.hp < e.maxHp) ? 'Clic derecho: ensamblar / reparar' : '';
    }
    this.hoverLabel.className = `hover-label show ${cls}`;
    this.hoverLabel.innerHTML = `<b>${name}</b>${act ? `<span>${act}</span>` : ''}`;
    this.hoverLabel.style.left = `${m.x + 16}px`;
    this.hoverLabel.style.top = `${m.y + 14}px`;
  }

  // ---------- minimapa ----------

  private toMini(x: number, z: number) {
    const W = this.mini.width;
    return { x: (x / (MAP_HALF * 2) + 0.5) * W, y: (z / (MAP_HALF * 2) + 0.5) * W };
  }

  private onMinimap(e: PointerEvent) {
    const r = this.mini.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width - 0.5) * MAP_HALF * 2;
    const z = ((e.clientY - r.top) / r.height - 0.5) * MAP_HALF * 2;
    if (e.button === 2) {
      const ids = [...this.input.ui.selected];
      if (ids.length) this.send({ kind: 'move', units: ids, to: { x, z } });
      return;
    }
    this.space.rig.lookAt(x, z);
  }

  private drawMinimap(s: SimState) {
    // el lienzo es de 400 px y se muestra a ~200: todo se dibuja a doble resolución para que sea nítido
    const c = this.mctx, W = this.mini.width, k = W / (MAP_HALF * 2);
    c.fillStyle = '#060811';
    c.fillRect(0, 0, W, W);
    // cuadrícula táctica y anillos de radar desde el centro
    c.strokeStyle = 'rgba(120,140,190,0.09)';
    c.lineWidth = 1;
    c.beginPath();
    for (let i = 1; i < 8; i++) { const v = Math.round((i / 8) * W) + 0.5; c.moveTo(v, 0); c.lineTo(v, W); c.moveTo(0, v); c.lineTo(W, v); }
    c.stroke();
    c.strokeStyle = 'rgba(120,140,190,0.12)';
    for (const r of [0.18, 0.34]) { c.beginPath(); c.arc(W / 2, W / 2, r * W, 0, Math.PI * 2); c.stroke(); }
    // barrido del radar
    const sweep = (performance.now() / 2600) % 1 * Math.PI * 2;
    const grad = c.createConicGradient(sweep, W / 2, W / 2);
    grad.addColorStop(0, 'rgba(46,230,255,0.10)');
    grad.addColorStop(0.08, 'rgba(46,230,255,0)');
    grad.addColorStop(1, 'rgba(46,230,255,0)');
    c.fillStyle = grad;
    c.fillRect(0, 0, W, W);

    // Mercado Central: octógono dorado y su zona de acceso
    {
      const p = this.toMini(MARKET.pos.x, MARKET.pos.z), r = Math.max(6, MARKET.radius * k);
      c.strokeStyle = 'rgba(253,218,36,0.35)'; c.setLineDash([3, 4]);
      c.beginPath(); c.arc(p.x, p.y, MARKET.reach * k, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
      c.beginPath();
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + Math.PI / 8; c.lineTo(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r); }
      c.closePath(); c.fillStyle = 'rgba(253,218,36,0.85)'; c.fill();
      c.fillStyle = '#06070d'; c.font = `700 ${Math.round(r * 1.2)}px system-ui`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('$', p.x, p.y + 1);
    }
    // cometa: su trayectoria (aviso) y la cabeza mientras cruza
    if (s.comet) {
      const a = this.toMini(s.comet.from.x, s.comet.from.z), b = this.toMini(s.comet.to.x, s.comet.to.z);
      c.strokeStyle = 'rgba(170,230,255,0.55)'; c.setLineDash([5, 5]); c.lineWidth = 2;
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); c.setLineDash([]); c.lineWidth = 1;
      const h = cometHead(s.comet, s.tick);
      if (h) { const p = this.toMini(h.x, h.z); c.fillStyle = '#e8fbff'; c.beginPath(); c.arc(p.x, p.y, 5, 0, Math.PI * 2); c.fill(); }
    }
    // nebulosas: nubes azules donde el rival puede esconderse
    for (const n of s.nebulae) {
      const p = this.toMini(n.pos.x, n.pos.z), r = n.radius * k;
      const g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      g.addColorStop(0, 'rgba(70,150,255,0.35)');
      g.addColorStop(1, 'rgba(110,90,255,0.04)');
      c.fillStyle = g;
      c.beginPath(); c.arc(p.x, p.y, r, 0, Math.PI * 2); c.fill();
    }
    // agujeros de gusano: las dos bocas de cada pareja con su color, unidas por una línea punteada
    s.wormholes.forEach((w, i) => {
      const col = WORMHOLE_COLORS[i % WORMHOLE_COLORS.length];
      const a = this.toMini(w.a.x, w.a.z), b = this.toMini(w.b.x, w.b.z);
      c.strokeStyle = col; c.globalAlpha = 0.25; c.setLineDash([3, 6]);
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); c.setLineDash([]); c.globalAlpha = 1;
      for (const p of [a, b]) {
        c.beginPath(); c.arc(p.x, p.y, Math.max(5, w.radius * k), 0, Math.PI * 2);
        c.fillStyle = 'rgba(0,0,0,0.6)'; c.fill(); c.lineWidth = 2.5; c.strokeStyle = col; c.stroke(); c.lineWidth = 1;
      }
    });
    // agujeros negros: zona de frenado en violeta con el centro negro
    for (const h of s.holes) {
      const p = this.toMini(h.pos.x, h.pos.z), r = h.radius * k;
      const g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(0.22, 'rgba(0,0,0,1)');
      g.addColorStop(0.3, 'rgba(255,170,80,0.75)');
      g.addColorStop(0.5, 'rgba(140,90,255,0.3)');
      g.addColorStop(1, 'rgba(140,90,255,0)');
      c.fillStyle = g;
      c.beginPath(); c.arc(p.x, p.y, r, 0, Math.PI * 2); c.fill();
      c.strokeStyle = 'rgba(170,120,255,0.45)'; c.setLineDash([4, 4]);
      c.stroke(); c.setLineDash([]);
    }
    const col = (side: number) => side === this.side ? '#2ee6ff' : side === -1 ? '#9aa3c7' : '#ff3d8b';
    // primero planetas y recursos (fondo), luego módulos y unidades (encima)
    for (const e of s.entities.values()) {
      const p = this.toMini(e.pos.x, e.pos.z);
      if (e.kind === 'asteroid') {
        c.fillStyle = DEPOSITS[e.res].color; c.globalAlpha = 0.55;
        c.beginPath(); c.arc(p.x, p.y, 2.2, 0, Math.PI * 2); c.fill(); c.globalAlpha = 1;
      } else if (e.kind === 'planet') {
        const r = Math.max(6, e.radius * k);
        c.beginPath(); c.arc(p.x, p.y, r, 0, Math.PI * 2);
        c.fillStyle = e.owner === -1 ? 'rgba(90,98,140,0.35)' : e.owner === this.side ? 'rgba(46,230,255,0.22)' : 'rgba(255,61,139,0.22)';
        c.fill();
        c.strokeStyle = e.owner === -1 ? 'rgba(154,163,199,0.6)' : col(e.owner);
        c.lineWidth = 1.5; c.stroke();
        // arco de captura en curso
        if (e.capture && Math.abs(e.capture) < 1) {
          c.beginPath(); c.arc(p.x, p.y, r + 3, -Math.PI / 2, -Math.PI / 2 + Math.abs(e.capture) * Math.PI * 2);
          c.strokeStyle = e.capture >= 0 ? '#2ee6ff' : '#ff3d8b'; c.lineWidth = 2; c.stroke();
        }
      }
    }
    for (const e of s.entities.values()) {
      if (e.kind !== 'module' && e.kind !== 'unit') continue;
      if (hiddenFrom(s, e, this.side)) continue;
      const p = this.toMini(e.pos.x, e.pos.z);
      c.fillStyle = col(e.side);
      if (e.kind === 'module') {
        const r = e.type === 'core' ? 7 : 4.5;
        c.fillRect(p.x - r, p.y - r, r * 2, r * 2);
        c.strokeStyle = 'rgba(5,6,12,0.9)'; c.lineWidth = 1.5; c.strokeRect(p.x - r, p.y - r, r * 2, r * 2);
      } else {
        const r = UNITS[e.type].cls === 'robot' ? 3.2 : e.type === 'drone' ? 2 : 2.6;
        c.beginPath(); c.arc(p.x, p.y, r, 0, Math.PI * 2); c.fill();
        if (this.input.ui.selected.has(e.id)) { c.strokeStyle = '#ffffff'; c.lineWidth = 1.2; c.stroke(); }
      }
    }
    // vista de la cámara: trapecio según el giro
    const rig = this.space.rig;
    const t = this.toMini(rig.target.x, rig.target.z);
    const r = rig.framing * 0.45 * k;
    c.save();
    c.translate(t.x, t.y);
    c.rotate(-rig.yaw);
    c.strokeStyle = 'rgba(253,218,36,0.85)';
    c.fillStyle = 'rgba(253,218,36,0.05)';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(-r * 0.6, -r * 0.5); c.lineTo(r * 0.6, -r * 0.5); c.lineTo(r, r * 0.5); c.lineTo(-r, r * 0.5); c.closePath();
    c.fill(); c.stroke();
    c.restore();
    const coords = `${Math.round(rig.target.x)}, ${Math.round(rig.target.z)}`;
    const ce = this.root.querySelector<HTMLElement>('#mini-coords');
    if (ce && ce.textContent !== coords) ce.textContent = coords;
  }

  // ---------- capa 2D sobre el 3D: barras de vida, recuadro y marcador de orden ----------

  private drawOverlay(s: SimState) {
    const c = this.octx, dpr = devicePixelRatio;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, this.overlay.width, this.overlay.height);
    const sel = this.input.ui.selected;
    for (const e of s.entities.values()) {
      if (e.kind !== 'unit' && e.kind !== 'module') continue;
      if (hiddenFrom(s, e, this.side)) continue;
      const damaged = e.hp < e.maxHp;
      if (!sel.has(e.id) && !damaged && !(e.kind === 'module' && e.built < 1)) continue;
      const wp = this.view.worldPoint(e);
      wp.y += e.kind === 'unit' ? UNITS[e.type].radius + 2 : 16;
      const sp = this.input.toScreen(wp);
      if (!sp.visible) continue;
      const w = Math.max(18, Math.min(60, (e.kind === 'unit' ? UNITS[e.type].radius : MODULES[e.type].radius) * sp.scale * 2));
      const k = Math.max(0, e.hp / e.maxHp);
      c.fillStyle = 'rgba(0,0,0,0.6)';
      c.fillRect(sp.x - w / 2 - 1, sp.y - 1, w + 2, 5);
      c.fillStyle = k > 0.6 ? '#4ade80' : k > 0.3 ? '#fdda24' : '#ff5468';
      c.fillRect(sp.x - w / 2, sp.y, w * k, 3);
    }
    const r = this.input.ui.dragRect;
    if (r) {
      c.strokeStyle = 'rgba(253,218,36,0.9)';
      c.fillStyle = 'rgba(253,218,36,0.08)';
      c.lineWidth = 1;
      c.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
      c.strokeRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    }
    const ping = this.input.ui.ping;
    if (ping) {
      const sp = this.input.toScreen(new Vector3(ping.pos.x, 0.5, ping.pos.z));
      const k = ping.age / 0.8;
      c.strokeStyle = ping.kind === 'attack' ? `rgba(255,84,104,${1 - k})` : `rgba(74,222,128,${1 - k})`;
      c.lineWidth = 2;
      c.beginPath();
      c.ellipse(sp.x, sp.y, 6 + k * 14, (6 + k * 14) * 0.5, 0, 0, Math.PI * 2);
      c.stroke();
    }
  }

  showEnd(s: SimState, onRestart: () => void, opts: { label?: string; extra?: string } = {}) {
    const win = s.winner === this.side;
    const d = document.createElement('div');
    d.className = 'endscreen';
    const core = coreOf(s, this.side);
    d.innerHTML = `<div class="panel ${win ? 'win' : 'lose'}">
      <h1>${win ? 'Victoria' : 'Derrota'}</h1>
      <p>${s.winReason}</p>
      <p class="muted">Ledger #${s.ledger} · ${Math.floor(s.tick / TICK_HZ / 60)} min · Núcleo ${core ? 'en pie' : 'destruido'}</p>
      ${opts.extra ? `<p class="settle">${opts.extra}</p>` : ''}
      <button>${opts.label ?? 'Jugar de nuevo'}</button></div>`;
    d.querySelector('button')!.addEventListener('click', () => { d.remove(); onRestart(); });
    this.root.appendChild(d);
  }

  destroy() { this.root.remove(); this.overlay.remove(); }
}
