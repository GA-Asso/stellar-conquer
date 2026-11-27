// Entrada: selección, órdenes con clic derecho, modo de construcción y controles de cámara 3D.
import * as THREE from 'three';
import { MODULES, UNITS } from '../sim/defs';
import { worldToHex } from '../sim/hex';
import { canPlace, coreOf, dist, freePorts, radiusOf } from '../sim/sim';
import type { Command, Entity, Hex, ModuleType, Side, SimState, Unit, Vec } from '../sim/types';
import type { GameView } from '../render/view';
import type { SpaceScene } from '../render/scene';

export interface UiState {
  selected: Set<number>;
  buildMode: ModuleType | null;
  hoverHex: Hex | null;
  groups: Map<number, number[]>;
  dragRect: { x0: number; y0: number; x1: number; y1: number } | null;
  // marcador de la última orden (posición y edad)
  ping: { pos: Vec; age: number; kind: 'move' | 'attack' } | null;
}

export class Input {
  ui: UiState = { selected: new Set(), buildMode: null, hoverHex: null, groups: new Map(), dragRect: null, ping: null };
  private mouse = { x: -1, y: -1, inside: false, moved: false };
  private keys = new Set<string>();
  private down: { x: number; y: number; button: number; alt: boolean } | null = null;
  private lastClick = { t: 0, id: -1 };
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private idleCycle = 0;

  constructor(
    private space: SpaceScene,
    private view: GameView,
    private getSim: () => SimState,
    private side: Side,
    private send: (cmd: Command) => void,
    private onHotkey: (key: string) => boolean,
  ) {
    const el = space.renderer.domElement;
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('pointerdown', e => this.onDown(e));
    window.addEventListener('pointermove', e => this.onMove(e));
    window.addEventListener('pointerup', e => this.onUp(e));
    el.addEventListener('pointerenter', () => { this.mouse.inside = true; });
    el.addEventListener('pointerleave', () => { this.mouse.inside = false; });
    el.addEventListener('wheel', e => this.onWheel(e), { passive: false });
    window.addEventListener('keydown', e => this.onKey(e, true));
    window.addEventListener('keyup', e => this.onKey(e, false));
    window.addEventListener('blur', () => this.keys.clear());
  }

  // ---------- geometría de pantalla ----------

  private ground(x: number, y: number): Vec | null {
    const r = this.space.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.space.camera);
    const hit = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(this.plane, hit)) return null;
    return { x: hit.x, z: hit.z };
  }

  toScreen(p: THREE.Vector3): { x: number; y: number; visible: boolean; scale: number } {
    const cam = this.space.camera;
    const r = this.space.renderer.domElement.getBoundingClientRect();
    const v = p.clone().project(cam);
    const depth = cam.position.distanceTo(p);
    const scale = r.height / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * depth);
    return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height, visible: v.z < 1 && v.z > -1, scale };
  }

  pick(x: number, y: number): Entity | null {
    const s = this.getSim();
    let best: Entity | null = null, bd = Infinity;
    for (const e of s.entities.values()) {
      const sp = this.toScreen(this.view.worldPoint(e));
      if (!sp.visible) continue;
      const rad = Math.max(10, radiusOf(e) * sp.scale * 1.1);
      const d = Math.hypot(sp.x - x, sp.y - y);
      // las unidades ganan frente a módulos y planetas grandes
      const bias = e.kind === 'unit' ? 0 : e.kind === 'module' ? 6 : 12;
      if (d <= rad && d + bias < bd) { bd = d + bias; best = e; }
    }
    return best;
  }

  // ---------- ratón ----------

  private onDown(e: PointerEvent) {
    this.mouse.x = e.clientX; this.mouse.y = e.clientY;
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      e.preventDefault();
      this.down = { x: e.clientX, y: e.clientY, button: 1, alt: true };
      return;
    }
    if (e.button === 2) {
      if (this.ui.buildMode) { this.ui.buildMode = null; return; }
      this.command(e.clientX, e.clientY, e.ctrlKey || e.metaKey);
      return;
    }
    if (e.button === 0) {
      if (this.ui.buildMode) { this.placeModule(e.shiftKey); return; }
      this.down = { x: e.clientX, y: e.clientY, button: 0, alt: false };
    }
  }

  private onMove(e: PointerEvent) {
    const dx = e.clientX - this.mouse.x, dy = e.clientY - this.mouse.y;
    this.mouse.x = e.clientX; this.mouse.y = e.clientY;
    this.mouse.moved = true;
    this.mouse.inside = e.target === this.space.renderer.domElement;
    if (this.down?.button === 1) {
      this.space.rig.rotate(-dx * 0.006, dy * 0.004);
      return;
    }
    if (this.down?.button === 0) {
      const moved = Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y);
      if (moved > 6) this.ui.dragRect = { x0: this.down.x, y0: this.down.y, x1: e.clientX, y1: e.clientY };
    }
  }

  private onUp(e: PointerEvent) {
    const d = this.down;
    this.down = null;
    if (!d || d.button !== 0 || e.button !== 0) return;
    if (this.ui.dragRect) {
      this.boxSelect(this.ui.dragRect, e.shiftKey);
      this.ui.dragRect = null;
      return;
    }
    this.clickSelect(e.clientX, e.clientY, e.shiftKey);
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    if (e.shiftKey) { this.space.rig.rotate(e.deltaY * 0.004, 0); return; }
    // pellizco del trackpad (ctrlKey) o rueda: zoom; desplazamiento horizontal del trackpad: giro
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && !e.ctrlKey) { this.space.rig.rotate(e.deltaX * 0.004, 0); return; }
    const k = e.ctrlKey ? 0.01 : 0.002;
    this.space.rig.zoom(Math.exp(e.deltaY * k));
  }

  // ---------- selección ----------

  private clickSelect(x: number, y: number, add: boolean) {
    const e = this.pick(x, y);
    const sel = this.ui.selected;
    if (!e) { if (!add) sel.clear(); return; }
    const now = performance.now();
    if (now - this.lastClick.t < 320 && this.lastClick.id === e.id && e.kind === 'unit' && e.side === this.side) {
      this.selectSameTypeOnScreen(e);
      return;
    }
    this.lastClick = { t: now, id: e.id };
    if (add && e.kind === 'unit' && e.side === this.side) {
      if (sel.has(e.id)) sel.delete(e.id); else sel.add(e.id);
      return;
    }
    sel.clear();
    sel.add(e.id);
  }

  private selectSameTypeOnScreen(u: Unit) {
    const s = this.getSim();
    const r = this.space.renderer.domElement.getBoundingClientRect();
    this.ui.selected.clear();
    for (const e of s.entities.values()) {
      if (e.kind !== 'unit' || e.side !== this.side || e.type !== u.type) continue;
      const sp = this.toScreen(this.view.worldPoint(e));
      if (sp.visible && sp.x >= r.left && sp.x <= r.right && sp.y >= r.top && sp.y <= r.bottom) this.ui.selected.add(e.id);
    }
  }

  private boxSelect(rect: NonNullable<UiState['dragRect']>, add: boolean) {
    const s = this.getSim();
    const x0 = Math.min(rect.x0, rect.x1), x1 = Math.max(rect.x0, rect.x1);
    const y0 = Math.min(rect.y0, rect.y1), y1 = Math.max(rect.y0, rect.y1);
    const hits: number[] = [];
    for (const e of s.entities.values()) {
      if (e.kind !== 'unit' || e.side !== this.side) continue;
      const sp = this.toScreen(this.view.worldPoint(e));
      if (sp.visible && sp.x >= x0 && sp.x <= x1 && sp.y >= y0 && sp.y <= y1) hits.push(e.id);
    }
    if (!add) this.ui.selected.clear();
    // si el recuadro incluye tropas, se dejan fuera los drones (como en los RTS clásicos)
    const army = hits.filter(id => (s.entities.get(id) as Unit).type !== 'drone');
    for (const id of army.length ? army : hits) this.ui.selected.add(id);
  }

  selectedUnits(): Unit[] {
    const s = this.getSim();
    const out: Unit[] = [];
    for (const id of this.ui.selected) {
      const e = s.entities.get(id);
      if (e && e.kind === 'unit' && e.side === this.side) out.push(e);
    }
    return out;
  }

  prune() {
    const s = this.getSim();
    for (const id of [...this.ui.selected]) if (!s.entities.has(id)) this.ui.selected.delete(id);
  }

  // ---------- órdenes ----------

  private command(x: number, y: number, attackMove: boolean) {
    const s = this.getSim();
    const target = this.pick(x, y);
    const us = this.selectedUnits();
    if (us.length === 0) {
      // un módulo propio seleccionado: clic derecho fija el punto de reunión
      const [id] = [...this.ui.selected];
      const m = id !== undefined ? s.entities.get(id) : undefined;
      const g = this.ground(x, y);
      if (m && m.kind === 'module' && m.side === this.side && g) {
        this.send({ kind: 'rally', module: m.id, to: target?.kind === 'asteroid' ? target.pos : g });
        this.ui.ping = { pos: g, age: 0, kind: 'move' };
      }
      return;
    }
    const ids = us.map(u => u.id);
    if (target && (target.kind === 'unit' || target.kind === 'module') && target.side !== this.side) {
      this.send({ kind: 'attack', units: ids, target: target.id });
      this.ui.ping = { pos: target.pos, age: 0, kind: 'attack' };
      return;
    }
    if (target?.kind === 'asteroid') {
      this.send({ kind: 'gather', units: ids, target: target.id });
      this.ui.ping = { pos: target.pos, age: 0, kind: 'move' };
      return;
    }
    if (target?.kind === 'module' && target.side === this.side && (target.built < 1 || target.hp < target.maxHp)
      && us.some(u => u.type === 'drone')) {
      this.send({ kind: 'repair', units: ids, target: target.id });
      this.ui.ping = { pos: target.pos, age: 0, kind: 'move' };
      return;
    }
    const g = target?.kind === 'planet' ? { x: target.pos.x, z: target.pos.z + target.radius + 3 } : this.ground(x, y);
    if (!g) return;
    this.send({ kind: 'move', units: ids, to: g, aggressive: attackMove });
    this.ui.ping = { pos: g, age: 0, kind: attackMove ? 'attack' : 'move' };
  }

  startBuild(type: ModuleType) {
    this.ui.buildMode = type;
  }

  private placeModule(keep: boolean) {
    const s = this.getSim();
    const type = this.ui.buildMode;
    const hex = this.ui.hoverHex;
    if (!type || !hex || !canPlace(s, this.side, type, hex).ok) return;
    let drones = this.selectedUnits().filter(u => u.type === 'drone');
    if (drones.length === 0) {
      // sin drones seleccionados: se usan los dos más cercanos que no estén ensamblando
      const p = { x: 0, z: 0, ...this.ground(this.mouse.x, this.mouse.y) };
      drones = [...s.entities.values()]
        .filter((e): e is Unit => e.kind === 'unit' && e.side === this.side && e.type === 'drone' && e.order.kind !== 'build')
        .sort((a, b) => dist(a.pos, p) - dist(b.pos, p))
        .slice(0, 2);
    }
    if (!drones.length) return;
    this.send({ kind: 'build', units: drones.map(d => d.id), module: type, hex });
    if (!keep) this.ui.buildMode = null;
  }

  // ---------- teclado ----------

  private onKey(e: KeyboardEvent, down: boolean) {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (!down) { this.keys.delete(k); return; }
    this.keys.add(k);
    if (k === 'Escape') { this.ui.buildMode = null; this.ui.selected.clear(); return; }
    // con Shift el teclado entrega símbolos (! " #…): se usa el código físico de la tecla
    const digit = /^Digit[0-9]$/.test(e.code) ? Number(e.code.slice(5)) : /^[0-9]$/.test(k) ? Number(k) : -1;
    if (digit >= 0) {
      const n = digit;
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); this.ui.groups.set(n, [...this.ui.selected]); return; }
      if (e.shiftKey) {
        // Shift + número: suma la selección al grupo
        e.preventDefault();
        this.ui.groups.set(n, [...new Set([...(this.ui.groups.get(n) ?? []), ...this.ui.selected])]);
        return;
      }
      const g = this.ui.groups.get(n);
      if (g) {
        this.ui.selected = new Set(g.filter(id => this.getSim().entities.has(id)));
        // doble toque: centra la cámara en el grupo
        const now = performance.now();
        if (this.lastGroup.n === n && now - this.lastGroup.t < 350) this.centerOnSelection();
        this.lastGroup = { n, t: now };
      }
      return;
    }
    if (k === ',') { this.selectArmy(); return; }
    if (k === ' ' || k === 'Home') {
      e.preventDefault();
      const core = coreOf(this.getSim(), this.side);
      if (core) this.space.rig.lookAt(core.pos.x, core.pos.z);
      return;
    }
    if (k === '.') { this.selectIdleDrone(); return; }
    // un toque de Z/X/C/V da un paso de giro; mantenerla gira de forma continua en update()
    const tap: Record<string, [number, number]> = { z: [-0.12, 0], x: [0.12, 0], c: [0, 0.08], v: [0, -0.08] };
    if (tap[k] && !e.repeat) { this.space.rig.rotate(tap[k][0], tap[k][1]); return; }
    if (k.length === 1 && this.onHotkey(k.toUpperCase())) e.preventDefault();
  }

  private lastGroup = { n: -1, t: 0 };

  private centerOnSelection() {
    const us = this.selectedUnits();
    if (!us.length) return;
    const x = us.reduce((a, u) => a + u.pos.x, 0) / us.length, z = us.reduce((a, u) => a + u.pos.z, 0) / us.length;
    this.space.rig.lookAt(x, z);
  }

  // todo el ejército del mapa (sin drones); un segundo toque centra la cámara
  private selectArmy() {
    const s = this.getSim();
    const army = [...s.entities.values()].filter((e): e is Unit => e.kind === 'unit' && e.side === this.side && e.type !== 'drone');
    if (!army.length) return;
    const same = army.length === this.ui.selected.size && army.every(u => this.ui.selected.has(u.id));
    this.ui.selected = new Set(army.map(u => u.id));
    if (same) this.centerOnSelection();
  }

  private selectIdleDrone() {
    const s = this.getSim();
    const idle = [...s.entities.values()].filter((e): e is Unit =>
      e.kind === 'unit' && e.side === this.side && e.type === 'drone' && e.order.kind === 'idle');
    if (!idle.length) return;
    const u = idle[this.idleCycle++ % idle.length];
    this.ui.selected = new Set([u.id]);
    this.space.rig.lookAt(u.pos.x, u.pos.z);
  }

  // ---------- por cuadro ----------

  update(dt: number) {
    const rig = this.space.rig;
    const sp = 260 * dt;
    if (this.keys.has('ArrowLeft')) rig.pan(-sp, 0);
    if (this.keys.has('ArrowRight')) rig.pan(sp, 0);
    if (this.keys.has('ArrowUp')) rig.pan(0, sp);
    if (this.keys.has('ArrowDown')) rig.pan(0, -sp);
    if (this.keys.has('z')) rig.rotate(-1.6 * dt, 0);
    if (this.keys.has('x')) rig.rotate(1.6 * dt, 0);
    if (this.keys.has('c')) rig.rotate(0, 1.2 * dt);
    if (this.keys.has('v')) rig.rotate(0, -1.2 * dt);
    // desplazamiento por los bordes de la pantalla
    if (this.mouse.inside && this.mouse.moved && !this.down && document.hasFocus()) {
      const m = 6, w = window.innerWidth, h = window.innerHeight;
      if (this.mouse.x <= m) rig.pan(-sp, 0);
      if (this.mouse.x >= w - m) rig.pan(sp, 0);
      if (this.mouse.y <= m) rig.pan(0, sp);
      if (this.mouse.y >= h - m) rig.pan(0, -sp);
    }
    if (this.ui.ping) { this.ui.ping.age += dt; if (this.ui.ping.age > 0.8) this.ui.ping = null; }

    // fantasma de construcción bajo el cursor
    const s = this.getSim();
    if (this.ui.buildMode) {
      const g = this.ground(this.mouse.x, this.mouse.y);
      this.ui.hoverHex = g ? worldToHex(g) : null;
      const ok = !!this.ui.hoverHex && canPlace(s, this.side, this.ui.buildMode, this.ui.hoverHex).ok;
      const ports = MODULES[this.ui.buildMode].freePlacement ? [] : freePorts(s, this.side, this.ui.buildMode);
      this.view.setGhost(this.ui.buildMode, this.ui.hoverHex, ok, ports);
    } else {
      this.ui.hoverHex = null;
      this.view.setGhost(null, null, false, []);
    }
  }

  placeReason(): string {
    const t = this.ui.buildMode, h = this.ui.hoverHex;
    if (!t || !h) return '';
    const r = canPlace(this.getSim(), this.side, t, h);
    return r.ok ? '' : r.reason;
  }

  get mousePos() { return { x: this.mouse.x, y: this.mouse.y }; }
  isDrone(id: number) { const e = this.getSim().entities.get(id); return !!e && e.kind === 'unit' && UNITS[e.type].cls === 'worker'; }
}
