// HUD: recursos, ledger, panel de selección, botonera de órdenes, minimapa y avisos.
import { Vector3 } from 'three';
import { ERA_UP, ERAS, LEDGER_TICKS, MAP_HALF, MODULES, TICK_HZ, UNITS } from '../sim/defs';
import { canAfford, coreOf, hasBuilt, popCap, popUsed } from '../sim/sim';
import type { Command, Entity, Module, ModuleType, Res, Side, SimState, Unit, UnitType } from '../sim/types';
import type { GameView } from '../render/view';
import type { SpaceScene } from '../render/scene';
import type { Input } from './input';
import { MODULE_GLYPH, UNIT_GLYPH } from '../render/icons';
import { Tutorial } from './tutorial';

// explicación larga de cada botón: para qué sirve y cuándo conviene
const MODULE_HELP: Record<ModuleType, string> = {
  core: '',
  habitat: 'Aumenta tu población máxima en 8. Constrúyelo cuando el contador de población (arriba) esté cerca del límite.',
  solar: 'Produce energía sin parar. La energía se gasta en Fragatas, Titanes, Acorazados, torretas y eras avanzadas.',
  anchor: 'Puesto avanzado: se puede colocar LEJOS de tu estación, junto a un campo de asteroides. Los drones descargan ahí y viajan menos. Se le pueden acoplar módulos.',
  hangar: 'Fabrica naves: Interceptores (rápidos), Fragatas (era Consenso, artillería) y el Acorazado (era Galáctica).',
  factory: 'Fabrica robots de abordaje: Mechas y Titanes. Son los únicos que conquistan planetas y hacen doble daño a módulos.',
  lab: 'Laboratorio Soroban: necesario para avanzar de era desde el Núcleo. Además, tus drones minan un 20 % más rápido.',
  turret: 'Defensa automática que dispara a las unidades enemigas cercanas. Ponla en el lado que mira al rival.',
  beacon: 'La maravilla. Si resiste 30 ledgers (~2,5 min) ganas la partida. El rival intentará destruirlo.',
};
const UNIT_HELP: Record<UnitType, string> = {
  drone: 'Trabajador: mina asteroides (clic derecho sobre uno) y ensambla o repara módulos. No combate bien.',
  interceptor: 'Caza barato y veloz. Bueno para cazar drones y robots, débil contra estaciones.',
  mecha: 'Robot de abordaje: hace doble daño a módulos. Llévalo a la órbita de un planeta para conquistarlo.',
  frigate: 'Artillería de plasma de largo alcance. Destroza otras naves.',
  titan: 'Robot pesado que demuele estaciones y conquista planetas rápido.',
  dreadnought: 'Nave insignia, enorme y muy resistente. Ideal para el asalto final.',
};

interface Button { key: string; label: string; sub: string; cost?: Res; enabled: boolean; why?: string; run: () => void; glyph?: string; help?: string }

const fmt = (n: number) => Math.floor(n).toLocaleString('es');
const costText = (c: Res) => [
  c.lumens ? `<span class="c-l">${c.lumens}</span>` : '',
  c.metal ? `<span class="c-m">${c.metal}</span>` : '',
  c.energy ? `<span class="c-e">${c.energy}</span>` : '',
].join(' ');

const BUILD_ORDER: ModuleType[] = ['habitat', 'solar', 'anchor', 'hangar', 'factory', 'lab', 'turret', 'beacon'];

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
        <div class="res" data-tip="Energía: la generan los paneles solares"><i class="ico e"></i><span id="r-e"></span></div>
        <div class="res" data-tip="Población"><i class="ico p"></i><span id="r-p"></span></div>
        <div class="era" id="era"></div>
        <div class="ledger"><span class="dot" id="ledger-dot"></span>Ledger <b id="ledger"></b><i id="ledger-bar"></i></div>
        <div class="clock" id="clock"></div>
      </div>
      <div class="bottom">
        <div class="minimap"><canvas width="220" height="220"></canvas></div>
        <div class="selection" id="sel"></div>
        <div class="commands" id="cmds"></div>
      </div>
      <details class="help"><summary>Controles</summary>
        <dl>
          <dt>Clic izquierdo</dt><dd>Seleccionar (arrastra para un recuadro, doble clic: todos los del mismo tipo)</dd>
          <dt>Clic derecho</dt><dd>Orden: mover, minar un asteroide, atacar al enemigo, reparar un módulo</dd>
          <dt>Ctrl + clic derecho</dt><dd>Avanzar atacando lo que haya en el camino</dd>
          <dt>Rueda / pellizco</dt><dd>Acercar y alejar</dd>
          <dt>Clic central o Alt + arrastrar</dt><dd>Girar e inclinar la galaxia en 3D (también Z / X / C / V)</dd>
          <dt>Flechas o bordes</dt><dd>Desplazar la cámara · clic en el minimapa para saltar</dd>
          <dt>Espacio</dt><dd>Volver al Núcleo · <b>.</b> busca un dron ocioso</dd>
          <dt>Ctrl + 1…9</dt><dd>Guardar grupo · 1…9 para recuperarlo</dd>
          <dt>P</dt><dd>Pausa</dd>
        </dl>
      </details>
      <div class="tip" id="tip"></div>
      <div class="hover-label" id="hover"></div>
      <div class="toasts"></div>
      <div class="placing" id="placing"></div>
    `;
    host.appendChild(this.root);
    for (const id of ['r-l', 'r-m', 'r-e', 'r-p', 'era', 'ledger', 'ledger-dot', 'ledger-bar', 'clock', 'sel', 'cmds', 'placing']) {
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
      this.tip.innerHTML = `<h4>${btn.glyph ? `<i>${btn.glyph}</i>` : ''}${btn.label} <kbd>${btn.key === 'Backspace' ? '⌫' : btn.key}</kbd></h4>
        ${btn.help ? `<p>${btn.help}</p>` : ''}<div class="tip-cost">${btn.sub}</div>${btn.why ? `<em>${btn.why}</em>` : ''}`;
      const r = b.getBoundingClientRect();
      this.tip.style.left = `${Math.min(window.innerWidth - 300, r.left)}px`;
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
    this.el['r-l'].textContent = fmt(pl.res.lumens);
    this.el['r-m'].textContent = fmt(pl.res.metal);
    this.el['r-e'].textContent = fmt(pl.res.energy);
    const used = popUsed(s, this.side), cap = popCap(s, this.side);
    this.el['r-p'].textContent = `${used}/${cap}`;
    this.el['r-p'].parentElement!.classList.toggle('full', used >= cap);
    this.el.era.textContent = `Era ${ERAS[pl.era].name}`;
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
      html = `<div class="empty"><b>Nada seleccionado.</b><br>Arrastra un recuadro sobre tus drones (cian) o haz clic en un módulo de tu estación para ver qué puede hacer.</div>`;
    } else if (sel.length === 1) {
      const e = sel[0];
      if (e.kind === 'unit') {
        const d = UNITS[e.type];
        const task = e.order.kind === 'gather' ? (e.carry ? `Minando ${e.carry.res === 'lumen' ? 'Lumens' : 'metal'} (${Math.floor(e.carry.amount)})` : 'Minando')
          : e.order.kind === 'build' ? 'Ensamblando' : e.order.kind === 'attack' ? 'Atacando' : e.order.kind === 'move' ? 'En ruta' : 'En espera';
        const hint = e.side !== this.side ? 'Unidad enemiga: selecciona tus tropas y haz clic derecho sobre ella para atacarla.'
          : e.type === 'drone' ? 'Clic derecho en un asteroide para minar · elige un módulo a la derecha para construir · clic derecho en un módulo dañado para repararlo.'
          : UNITS[e.type].cls === 'robot' ? 'Clic derecho sobre un planeta para conquistarlo, o sobre un enemigo para atacarlo.'
          : 'Clic derecho sobre un enemigo para atacar · Ctrl+clic derecho para avanzar atacando.';
        html = this.card(d.name, d.desc, e.hp, e.maxHp, e.side, `
          <div class="stats"><span>Ataque ${d.damage}</span><span>Alcance ${d.range}</span><span>Velocidad ${d.speed}</span><span>${task}</span></div>`, hint);
      } else if (e.kind === 'module') {
        const d = MODULES[e.type];
        let extra = '';
        if (e.built < 1) extra = `<div class="progress"><i style="width:${e.built * 100}%"></i><span>Ensamblaje ${Math.floor(e.built * 100)} %</span></div>`;
        else if (e.queue.length) {
          const q = e.queue[0];
          extra = `<div class="queue">${e.queue.map((q, i) => `<span class="${i === 0 ? 'now' : ''}">${q.item === 'era' ? 'Era' : UNITS[q.item].name}</span>`).join('')}</div>
          <div class="progress"><i style="width:${(q.progress / q.total) * 100}%"></i><span>${Math.ceil(q.total - q.progress)} s</span></div>`;
        }
        if (e.type === 'beacon' && e.built >= 1) extra += `<div class="stats"><span>Quórum: ${s.players[e.side].beaconLedgers}/30 ledgers</span></div>`;
        const hint = e.side !== this.side ? 'Módulo enemigo: los robots le hacen el doble de daño.'
          : e.built < 1 ? 'En ensamblaje: selecciona drones y haz clic derecho aquí para acelerarlo.'
          : MODULES[e.type].trains.length ? 'Pulsa un botón de la derecha para fabricar. Clic derecho en el mapa fija el punto de reunión de lo que salga.'
          : e.type === 'lab' ? 'Ya puedes avanzar de era: selecciona el Núcleo y pulsa «Avanzar».' : MODULE_HELP[e.type];
        html = this.card(d.name, d.desc, e.hp, e.maxHp, e.side, extra, hint);
      } else if (e.kind === 'asteroid') {
        html = this.card(e.res === 'lumen' ? 'Asteroide de Lumen' : 'Asteroide metálico', `Quedan ${Math.floor(e.amount)} unidades.`, 0, 0, -1, '',
          'Selecciona drones y haz clic derecho sobre él para minarlo.');
      } else {
        const owner = e.owner === -1 ? 'Neutral' : e.owner === this.side ? 'Tuyo' : 'Del rival';
        html = this.card(`Planeta ${e.name}`, `${owner}. Lleva robots (Mecha o Titán) a su órbita para conquistarlo: paga Lumens cada ledger.`, 0, 0, e.owner, `
          <div class="progress cap"><i style="width:${Math.abs(e.capture) * 100}%; background:${e.capture >= 0 ? 'var(--ally)' : 'var(--enemy)'}"></i><span>Control ${Math.round(Math.abs(e.capture) * 100)} %</span></div>`);
      }
    } else {
      const counts = new Map<string, number>();
      for (const e of sel) if (e.kind === 'unit') counts.set(UNITS[e.type].name, (counts.get(UNITS[e.type].name) ?? 0) + 1);
      html = `<div class="multi">${[...counts].map(([n, c]) => `<span><b>${c}</b> ${n}</span>`).join('')}</div>
        <div class="hint">${sel.every(e => e.kind === 'unit' && e.type === 'drone')
          ? 'Clic derecho en un asteroide para minar · elige un módulo a la derecha y colócalo en un hexágono verde para construir.'
          : 'Clic derecho: mover o atacar · Ctrl+clic derecho: avanzar atacando · Ctrl+1…9: guardar este grupo.'}</div>`;
    }
    if (this.el.sel.innerHTML !== html) this.el.sel.innerHTML = html;
  }

  private card(name: string, desc: string, hp: number, max: number, side: number, extra: string, hint = '') {
    const hpBar = max > 0 ? `<div class="hp"><i style="width:${(hp / max) * 100}%"></i><span>${Math.ceil(hp)} / ${max}</span></div>` : '';
    return `<div class="card side-${side}"><h3>${name}</h3><p>${desc}</p>${hpBar}${extra}${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
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
          key: d.hotkey, label: d.name, sub: costText(d.cost), cost: d.cost, enabled: eraOk && afford, glyph: MODULE_GLYPH[t], help: MODULE_HELP[t],
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
          key: d.hotkey, label: d.name, sub: costText(d.cost), enabled: eraOk && afford && mod.queue.length < 6,
          glyph: UNIT_GLYPH[t as UnitType], help: UNIT_HELP[t as UnitType],
          why: !eraOk ? `Era ${ERAS[d.era].name}` : !afford ? 'Faltan recursos' : '',
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
          why: !lab ? 'Requiere Laboratorio Soroban' : busy ? 'Investigando' : !canAfford(pl.res, up.cost) ? 'Faltan recursos' : '',
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
        <kbd>${b.key === 'Backspace' ? '⌫' : b.key}</kbd>${b.glyph ? `<i class="g">${b.glyph}</i>` : ''}<b>${b.label}</b><small>${b.sub}</small>${b.why ? `<em>${b.why}</em>` : ''}
      </button>`).join('');
  }

  // etiqueta junto al cursor: qué es lo que hay debajo y qué hacer con ello
  private updateHover(s: SimState) {
    const m = this.input.mousePos;
    const e = this.input.ui.buildMode || this.input.ui.dragRect ? null : this.input.pick(m.x, m.y);
    if (!e) { this.hoverLabel.classList.remove('show'); return; }
    const hasDrones = this.input.selectedUnits().some(u => u.type === 'drone');
    const hasArmy = this.input.selectedUnits().some(u => u.type !== 'drone');
    let name = '', act = '', cls = '';
    if (e.kind === 'asteroid') {
      name = e.res === 'lumen' ? 'Asteroide de Lumen' : 'Asteroide metálico';
      act = hasDrones ? 'Clic derecho: minar' : 'Selecciona drones para minarlo';
      cls = e.res === 'lumen' ? 'lumen' : 'metal';
    } else if (e.kind === 'planet') {
      name = `Planeta ${e.name}` + (e.owner === this.side ? ' (tuyo)' : e.owner === -1 ? ' (neutral)' : ' (rival)');
      act = 'Conquístalo con robots en su órbita';
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
    const c = this.mctx, W = this.mini.width;
    c.fillStyle = '#05060d';
    c.fillRect(0, 0, W, W);
    const col = (side: number) => side === 0 ? '#2ee6ff' : side === 1 ? '#ff3d8b' : '#9aa3c7';
    for (const e of s.entities.values()) {
      const p = this.toMini(e.pos.x, e.pos.z);
      if (e.kind === 'asteroid') { c.fillStyle = e.res === 'lumen' ? '#c9a91c' : '#8a5a3a'; c.fillRect(p.x - 1, p.y - 1, 2, 2); }
      else if (e.kind === 'planet') {
        c.beginPath(); c.arc(p.x, p.y, e.radius * W / (MAP_HALF * 2), 0, Math.PI * 2);
        c.fillStyle = e.owner === -1 ? '#3a3f5c' : col(e.owner); c.globalAlpha = 0.6; c.fill(); c.globalAlpha = 1;
      } else if (e.kind === 'module') { c.fillStyle = col(e.side); c.fillRect(p.x - 2.5, p.y - 2.5, 5, 5); }
      else { c.fillStyle = col(e.side); c.fillRect(p.x - 1.2, p.y - 1.2, 2.4, 2.4); }
    }
    // vista de la cámara: un rombo según el giro
    const rig = this.space.rig;
    const t = this.toMini(rig.target.x, rig.target.z);
    const r = rig.distance * 0.45 * W / (MAP_HALF * 2);
    c.save();
    c.translate(t.x, t.y);
    c.rotate(-rig.yaw);
    c.strokeStyle = 'rgba(255,255,255,0.7)';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(-r * 0.6, -r * 0.5); c.lineTo(r * 0.6, -r * 0.5); c.lineTo(r, r * 0.5); c.lineTo(-r, r * 0.5); c.closePath();
    c.stroke();
    c.restore();
  }

  // ---------- capa 2D sobre el 3D: barras de vida, recuadro y marcador de orden ----------

  private drawOverlay(s: SimState) {
    const c = this.octx, dpr = devicePixelRatio;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, this.overlay.width, this.overlay.height);
    const sel = this.input.ui.selected;
    for (const e of s.entities.values()) {
      if (e.kind !== 'unit' && e.kind !== 'module') continue;
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

  showEnd(s: SimState, onRestart: () => void) {
    const win = s.winner === this.side;
    const d = document.createElement('div');
    d.className = 'endscreen';
    const core = coreOf(s, this.side);
    d.innerHTML = `<div class="panel ${win ? 'win' : 'lose'}">
      <h1>${win ? 'Victoria' : 'Derrota'}</h1>
      <p>${s.winReason}</p>
      <p class="muted">Ledger #${s.ledger} · ${Math.floor(s.tick / TICK_HZ / 60)} min · Núcleo ${core ? 'en pie' : 'destruido'}</p>
      <button>Jugar de nuevo</button></div>`;
    d.querySelector('button')!.addEventListener('click', () => { d.remove(); onRestart(); });
    this.root.appendChild(d);
  }

  destroy() { this.root.remove(); this.overlay.remove(); }
}
