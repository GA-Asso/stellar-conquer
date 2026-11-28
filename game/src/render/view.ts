// Vista del juego: mantiene un objeto 3D por entidad de la simulación y lo interpola entre ticks.
import * as THREE from 'three';
import { MODULES, PLANET, UNITS } from '../sim/defs';
import { hexToWorld } from '../sim/hex';
import { coreOf, dist } from '../sim/sim';
import type { Asteroid, AsteroidKind, Entity, Hex, ModuleType, Side, SimState, Unit, Vec } from '../sim/types';
import { Fx } from './fx';
import { iconSprite, MODULE_GLYPH, MODULE_ROLE, ROLE_INFO } from './icons';
import { buildAsteroid, buildConnector, buildModule, buildPlanet, buildUnit, mats, SIDE_COLORS, unitShadow, type Spin } from './models';
import type { SpaceScene } from './scene';
import { Scenery } from './scenery';
import { BlackHoles } from './blackhole';

const CARGO_COLORS: Record<AsteroidKind, THREE.Color> = {
  lumen: new THREE.Color(2.2, 1.8, 0.3),
  metal: new THREE.Color(1.1, 0.6, 0.35),
  energy: new THREE.Color(1.4, 1.1, 3),
};

interface View {
  root: THREE.Group;
  model: THREE.Group;
  spins: Spin[];
  tick?: (t: number) => void;
  engines?: THREE.Object3D[];
  cage?: THREE.Mesh;
  planet?: { material: THREE.ShaderMaterial; ring: THREE.Mesh };
  startAmount?: number;
  phase: number;
  smooth?: { x: number; z: number };
  /** altura extra para pasar por encima de un asteroide (solo visual) */
  lift?: number;
}

export function altitude(e: Entity, t = 0, phase = 0): number {
  if (e.kind === 'unit') {
    const cls = UNITS[e.type].cls;
    const bob = Math.sin(t * 1.6 + phase) * (cls === 'robot' ? 0.15 : 0.6);
    if (cls === 'worker') return 5 + bob;
    if (cls === 'robot') return 1.5 + bob;
    return (e.type === 'dreadnought' ? 13 : e.type === 'frigate' ? 10 : 8) + bob;
  }
  if (e.kind === 'asteroid') return 2;
  if (e.kind === 'planet') return 0;
  return 0;
}

export class GameView {
  readonly fx: Fx;
  private scenery: Scenery;
  private holes: BlackHoles | null = null;
  private views = new Map<number, View>();
  private connectors = new Map<number, THREE.Group>();
  private prev = new Map<number, Vec>();
  private rings = new Map<number, THREE.Mesh>();
  private ringGeo = new THREE.RingGeometry(1, 1.18, 40);
  private ghost: { type: ModuleType; obj: THREE.Group } | null = null;
  private ghostOk = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 2, 0.8), transparent: true, opacity: 0.35, depthWrite: false });
  private ghostBad = new THREE.MeshBasicMaterial({ color: new THREE.Color(2, 0.3, 0.4), transparent: true, opacity: 0.35, depthWrite: false });
  private ports: THREE.InstancedMesh;
  private time = 0;

  constructor(private space: SpaceScene, private local: Side) {
    this.fx = new Fx(space.scene);
    this.scenery = new Scenery(space.scene);
    const hexRing = new THREE.RingGeometry(10.2, 11.6, 6).rotateX(-Math.PI / 2).rotateY(Math.PI / 6);
    this.ports = new THREE.InstancedMesh(hexRing, new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.5, 2.2, 1.2), transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide,
    }), 128);
    this.ports.count = 0;
    space.scene.add(this.ports);
  }

  // guarda las posiciones antes de avanzar la simulación, para interpolar
  snapshot(s: SimState) {
    this.prev.clear();
    for (const e of s.entities.values()) if (e.kind === 'unit') this.prev.set(e.id, { ...e.pos });
  }

  renderPos(e: Entity, alpha: number): Vec {
    const p = this.prev.get(e.id);
    if (!p || e.kind !== 'unit') return e.pos;
    return { x: p.x + (e.pos.x - p.x) * alpha, z: p.z + (e.pos.z - p.z) * alpha };
  }

  worldPoint(e: Entity, alpha = 1): THREE.Vector3 {
    const p = this.renderPos(e, alpha);
    const v = this.views.get(e.id);
    return new THREE.Vector3(p.x, altitude(e, this.time, v?.phase ?? 0), p.z);
  }

  handleEvents(s: SimState) {
    for (const ev of s.events) {
      switch (ev.kind) {
        case 'shot':
          if (ev.weapon === 'plasma') this.fx.plasma(ev.from, ev.to, ev.side, 9, 4);
          else if (ev.weapon === 'laser') this.fx.laser(ev.from, ev.to, ev.side, 7, 4);
          else this.fx.laser(ev.from, ev.to, ev.side, 3, 3);
          break;
        case 'death': this.fx.explosion(ev.pos, ev.size, ev.side, ev.size > 5 ? 5 : 6); break;
        case 'built': {
          const m = s.entities.get(ev.id);
          if (m) this.fx.pulse(m.pos, ev.side, 22);
          break;
        }
        case 'ledger': {
          this.scenery.onLedger();
          for (const side of [0, 1] as Side[]) {
            const core = coreOf(s, side);
            if (!core) continue;
            this.fx.pulse(core.pos, side, 70);
            for (const e of s.entities.values()) {
              if (e.kind === 'planet' && e.owner === side) this.fx.payment(e.pos, core.pos, side);
            }
          }
          break;
        }
        case 'anomaly': this.fx.pulse(ev.pos, -1, 60); this.fx.pulse(ev.pos, -1, 30); break;
        case 'planetDestroyed': {
          this.fx.planetBurst(ev.pos, ev.radius, PLANET.blast.reach + ev.radius);
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            this.fx.explosion({ x: ev.pos.x + Math.cos(a) * ev.radius * 0.6, z: ev.pos.z + Math.sin(a) * ev.radius * 0.6 }, 9, -1, 6);
          }
          // tiembla más cuanto más cerca está la cámara
          const d = Math.hypot(this.space.rig.target.x - ev.pos.x, this.space.rig.target.z - ev.pos.z);
          this.space.rig.shake(Math.max(0.35, 1.1 - d / 400));
          break;
        }
        case 'captured': {
          const p = s.entities.get(ev.planet);
          if (p) this.fx.pulse(p.pos, ev.side, 50);
          break;
        }
        case 'era': {
          const core = coreOf(s, ev.side);
          if (core) { this.fx.pulse(core.pos, ev.side, 160); this.fx.pulse(core.pos, ev.side, 110); }
          break;
        }
        default: break;
      }
    }
  }

  private create(e: Entity): View {
    let v: View;
    if (e.kind === 'unit') {
      const b = buildUnit(e.type, e.side);
      const root = new THREE.Group();
      root.add(b.group);
      // las naves y drones vuelan: su sombra de color queda en el plano; los robots ya llevan su disco
      if (UNITS[e.type].cls !== 'robot') root.add(unitShadow(e.side, UNITS[e.type].radius));
      v = { root, model: b.group, spins: b.spins, engines: b.engines, phase: (e.id * 1.7) % 6.28 };
    } else if (e.kind === 'module') {
      const b = buildModule(e.type, e.side);
      const root = new THREE.Group();
      root.add(b.group);
      const r = MODULES[e.type].radius;
      const cage = new THREE.Mesh(
        new THREE.CylinderGeometry(r, r, 14, e.type === 'core' ? 24 : 6, 4, true).rotateY(Math.PI / 6).translate(0, 7, 0),
        new THREE.MeshBasicMaterial({ color: SIDE_COLORS[e.side].clone().multiplyScalar(1.8), wireframe: true, transparent: true, opacity: 0.6 }),
      );
      root.add(cage);
      // ícono flotante para reconocer cada módulo de un vistazo
      const roleColor = ROLE_INFO[MODULE_ROLE[e.type]].color;
      if (e.type !== 'core') root.add(rolePad(r, roleColor));
      const icon = iconSprite(MODULE_GLYPH[e.type], '#' + SIDE_COLORS[e.side].getHexString(), roleColor);
      icon.position.y = e.type === 'beacon' ? 40 : e.type === 'core' ? 50 : 20;
      icon.scale.setScalar(e.type === 'core' ? 0.06 : 0.034);
      root.add(icon);
      v = { root, model: b.group, spins: b.spins, tick: b.tick, cage, phase: 0 };
    } else if (e.kind === 'asteroid') {
      const g = buildAsteroid(e.res, e.radius, e.id);
      const root = new THREE.Group();
      root.add(g);
      v = { root, model: g, spins: [], startAmount: e.amount, phase: (e.id * 0.37) % 6.28 };
    } else {
      const idx = [...'QHLSA'].indexOf(e.name[0]);
      const b = buildPlanet(idx < 0 ? e.id : idx, e.radius);
      const root = new THREE.Group();
      root.add(b.group);
      v = { root, model: b.group, spins: [], planet: { material: b.material, ring: b.ring }, phase: 0 };
    }
    v.root.userData.entityId = e.id;
    this.space.scene.add(v.root);
    this.views.set(e.id, v);
    return v;
  }

  sync(s: SimState, alpha: number, dt: number, selected: Set<number>) {
    this.time += dt;
    const t = this.time;
    this.scenery.update(t, dt);
    this.holes ??= new BlackHoles(this.space.scene, s.holes);
    this.holes.update(t, this.space.camera);
    const rocks: Asteroid[] = [];
    for (const e of s.entities.values()) if (e.kind === 'asteroid') rocks.push(e);
    const alive = new Set<number>();
    for (const e of s.entities.values()) {
      alive.add(e.id);
      const v = this.views.get(e.id) ?? this.create(e);
      let p = this.renderPos(e, alpha);
      if (e.kind === 'unit') {
        // filtro suave: oculta los empujones de un tick entre unidades apretadas
        if (!v.smooth || Math.hypot(v.smooth.x - p.x, v.smooth.z - p.z) > 12) v.smooth = { ...p };
        const k = Math.min(1, dt * 14);
        v.smooth.x += (p.x - v.smooth.x) * k;
        v.smooth.z += (p.z - v.smooth.z) * k;
        p = v.smooth;
      }
      let y = altitude(e, t, v.phase);
      if (e.kind === 'unit') {
        // las naves sobrevuelan las rocas: suben suave al pasar encima y vuelven a bajar
        let want = 0;
        const ur = UNITS[e.type].radius;
        for (const a of rocks) {
          const d = Math.hypot(a.pos.x - p.x, a.pos.z - p.z), reach = a.radius + ur;
          if (d < reach) want = Math.max(want, (a.radius * 2.2 + 2 - (y - 2)) * Math.min(1, (reach - d) / (ur + 1)));
        }
        v.lift = (v.lift ?? 0) + (Math.max(0, want) - (v.lift ?? 0)) * Math.min(1, dt * 5);
        y += v.lift;
      }
      v.root.position.set(p.x, y, p.z);
      for (const sp of v.spins) sp.obj.rotation[sp.axis] += sp.speed * dt;
      if (v.tick && (e.kind !== 'module' || e.built >= 1)) v.tick(t);

      if (e.kind === 'unit') this.syncUnit(e, v, dt, t);
      else if (e.kind === 'module') {
        const k = e.built;
        v.model.scale.set(1, 0.15 + 0.85 * k, 1);
        v.model.visible = k > 0.02;
        if (v.cage) {
          v.cage.visible = k < 1;
          (v.cage.material as THREE.MeshBasicMaterial).opacity = 0.3 + 0.3 * Math.sin(t * 6);
        }
        if (k >= 1 && e.parent !== null && !this.connectors.has(e.id)) this.addConnector(s, e.id, e.parent);
      } else if (e.kind === 'asteroid') {
        v.model.rotation.y += dt * 0.08;
        // el cristal de energía flota y gira por su cuenta
        const gem = e.res === 'energy' ? v.model.getObjectByName('gem') : undefined;
        if (gem) { gem.rotation.y += dt * 0.9; gem.position.y = e.radius * 1.25 + Math.sin(t * 1.8 + v.phase) * 0.5; }
        const k = Math.max(0.35, Math.sqrt(e.amount / (v.startAmount ?? e.amount)));
        v.model.scale.setScalar(k);
      } else if (e.kind === 'planet' && v.planet) {
        v.model.children[0].rotation.y += dt * 0.05;
        v.planet.material.uniforms.uTime.value = t;
        const dmg = 1 - e.hp / e.maxHp;
        v.planet.material.uniforms.uDamage.value = dmg;
        // al borde de romperse, el planeta tiembla
        const quake = dmg > 0.7 ? (dmg - 0.7) * 1.6 : 0;
        v.model.position.set(Math.sin(t * 37) * quake, Math.sin(t * 23) * quake * 0.6, Math.cos(t * 31) * quake);
        const ownerCol = e.owner === -1 ? new THREE.Color(0x222233) : SIDE_COLORS[e.owner];
        (v.planet.material.uniforms.uOwner.value as THREE.Color).copy(ownerCol);
        const capSide = e.capture > 0 ? 0 : 1;
        const ringMat = v.planet.ring.material as THREE.MeshBasicMaterial;
        ringMat.color.copy(Math.abs(e.capture) < 0.01 ? SIDE_COLORS[-1] : SIDE_COLORS[capSide]).multiplyScalar(1.6);
        ringMat.opacity = 0.25 + Math.abs(e.capture) * 0.6;
        v.planet.ring.rotation.z += dt * 0.2;
      }

      // anillo de selección
      const ring = this.rings.get(e.id);
      if (selected.has(e.id)) {
        const r = e.kind === 'unit' ? UNITS[e.type].radius * 1.6 : e.kind === 'module' ? MODULES[e.type].radius * 1.15 : e.radius * 1.2;
        const mesh = ring ?? this.addRing(e.id, e.kind === 'unit' || e.kind === 'module' ? e.side : -1);
        mesh.position.set(p.x, e.kind === 'unit' ? Math.max(0.6, altitude(e, t, v.phase) - 2.5) : 0.4, p.z);
        mesh.scale.setScalar(r);
      } else if (ring) {
        this.space.scene.remove(ring);
        this.rings.delete(e.id);
      }
    }
    for (const [id, v] of this.views) {
      if (alive.has(id)) continue;
      this.space.scene.remove(v.root);
      this.views.delete(id);
      const c = this.connectors.get(id);
      if (c) { this.space.scene.remove(c); this.connectors.delete(id); }
    }
    // pasillos cuyo módulo padre cayó
    for (const [id, c] of this.connectors) {
      const m = s.entities.get(id);
      if (!m || m.kind !== 'module' || m.parent === null || !s.entities.has(m.parent)) {
        this.space.scene.remove(c);
        this.connectors.delete(id);
      }
    }
    for (const [id, r] of this.rings) if (!alive.has(id)) { this.space.scene.remove(r); this.rings.delete(id); }
    this.fx.update(dt);
  }

  private syncUnit(u: Unit, v: View, dt: number, t: number) {
    // giro suave hacia la dirección de vuelo
    let d = u.facing - v.model.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    v.model.rotation.y += d * Math.min(1, dt * 8);
    const cls = UNITS[u.type].cls;
    if (cls === 'ship') v.model.rotation.z = -d * 0.6;
    const shadow = v.root.getObjectByName('shadow');
    if (shadow) shadow.position.y = 0.3 - v.root.position.y;
    if (v.engines) for (const e of v.engines) e.scale.setScalar(0.8 + Math.sin(t * 30 + v.phase) * 0.25);
    // los drones cargados llevan un cristal brillante
    if (u.type === 'drone') {
      let cargo = v.model.getObjectByName('cargo') as THREE.Mesh | undefined;
      if (u.carry && u.carry.amount > 1) {
        if (!cargo) {
          cargo = new THREE.Mesh(new THREE.OctahedronGeometry(0.7, 0), new THREE.MeshBasicMaterial());
          cargo.name = 'cargo';
          cargo.position.set(0, -1.2, 0);
          v.model.add(cargo);
        }
        (cargo.material as THREE.MeshBasicMaterial).color.copy(CARGO_COLORS[u.carry.res]);
        cargo.visible = true;
        cargo.rotation.y += dt * 4;
      } else if (cargo) cargo.visible = false;
      // haz de minería
      const mining = u.order.kind === 'gather' && u.order.phase === 'mine';
      let beam = v.model.getObjectByName('beam') as THREE.Mesh | undefined;
      if (mining && !beam) {
        beam = new THREE.Mesh(new THREE.ConeGeometry(1.4, 4, 10, 1, true).rotateX(-Math.PI / 2).translate(0, -1.5, 3),
          new THREE.MeshBasicMaterial({ color: SIDE_COLORS[u.side].clone().multiplyScalar(1.4), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
        beam.name = 'beam';
        v.model.add(beam);
      }
      if (beam) {
        beam.visible = mining || u.order.kind === 'build';
        (beam.material as THREE.MeshBasicMaterial).opacity = 0.2 + 0.2 * Math.sin(t * 12 + v.phase);
      }
    }
  }

  private addConnector(s: SimState, id: number, parentId: number) {
    const a = s.entities.get(id), b = s.entities.get(parentId);
    if (!a || !b || a.kind !== 'module' || b.kind !== 'module') return;
    // hacia la ciudadela el pasillo termina en su muralla, no en el centro de la torre
    const full = dist(a.pos, b.pos);
    const cut = b.type === 'core' ? Math.min(full - 4, MODULES.core.radius - 1) : 0;
    const k = cut / Math.max(1e-6, full);
    const end = { x: b.pos.x + (a.pos.x - b.pos.x) * k, z: b.pos.z + (a.pos.z - b.pos.z) * k };
    const len = full - cut;
    const c = buildConnector(a.side, len);
    c.position.set((a.pos.x + end.x) / 2, 0, (a.pos.z + end.z) / 2);
    c.rotation.y = -Math.atan2(b.pos.z - a.pos.z, b.pos.x - a.pos.x);
    this.space.scene.add(c);
    this.connectors.set(id, c);
  }

  private addRing(id: number, side: Side | -1): THREE.Mesh {
    const mesh = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({
      color: SIDE_COLORS[side].clone().multiplyScalar(0.9), transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false,
    }));
    mesh.rotation.x = -Math.PI / 2;
    this.space.scene.add(mesh);
    this.rings.set(id, mesh);
    return mesh;
  }

  // fantasma del módulo a colocar y puertos libres resaltados
  setGhost(type: ModuleType | null, hex: Hex | null, ok: boolean, ports: Hex[]) {
    if (!type || !hex) {
      if (this.ghost) { this.space.scene.remove(this.ghost.obj); this.ghost = null; }
      this.ports.count = 0;
      return;
    }
    if (!this.ghost || this.ghost.type !== type) {
      if (this.ghost) this.space.scene.remove(this.ghost.obj);
      const obj = buildModule(type, this.local).group;
      this.ghost = { type, obj };
      this.space.scene.add(obj);
    }
    const mat = ok ? this.ghostOk : this.ghostBad;
    this.ghost.obj.traverse(o => { if (o instanceof THREE.Mesh) o.material = mat; });
    const w = hexToWorld(hex);
    this.ghost.obj.position.set(w.x, 0.2, w.z);
    const m = new THREE.Matrix4();
    this.ports.count = Math.min(128, ports.length);
    for (let i = 0; i < this.ports.count; i++) {
      const p = hexToWorld(ports[i]);
      m.makeTranslation(p.x, 0.3, p.z);
      this.ports.setMatrixAt(i, m);
    }
    this.ports.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    for (const v of this.views.values()) this.space.scene.remove(v.root);
    for (const c of this.connectors.values()) this.space.scene.remove(c);
    for (const r of this.rings.values()) this.space.scene.remove(r);
    this.views.clear(); this.connectors.clear(); this.rings.clear();
    this.setGhost(null, null, false, []);
    this.space.scene.remove(this.ports);
    this.scenery.dispose();
    this.holes?.dispose();
  }

  // materiales compartidos: se exponen para que el HUD pinte iconos con el color del lado
  sideColor(side: Side): string { return '#' + mats(side).trim.color.getHexString(); }
}

const padCache = new Map<string, { edge: THREE.MeshBasicMaterial; fill: THREE.MeshBasicMaterial; post: THREE.MeshBasicMaterial }>();
/**
 * Plataforma con el color de la función del módulo: contorno hexagonal luminoso, suelo tenue y balizas en
 * las esquinas. El bando lo sigue diciendo el casco; la plataforma dice para qué sirve.
 */
function rolePad(r: number, color: string): THREE.Group {
  let m = padCache.get(color);
  if (!m) {
    const c = new THREE.Color(color);
    m = {
      edge: new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(1.6), transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
      fill: new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
      post: new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(2) }),
    };
    padCache.set(color, m);
  }
  const g = new THREE.Group();
  const R = r + 2.2;
  const edge = new THREE.Mesh(new THREE.RingGeometry(R - 0.7, R, 6).rotateX(-Math.PI / 2).rotateY(Math.PI / 6), m.edge);
  edge.position.y = 0.15;
  const fill = new THREE.Mesh(new THREE.CircleGeometry(R - 0.7, 6).rotateX(-Math.PI / 2).rotateY(Math.PI / 6), m.fill);
  fill.position.y = 0.1;
  g.add(edge, fill);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.4, 0.5), m.post);
    post.position.set(Math.sin(a) * R, 1.2, Math.cos(a) * R);
    g.add(post);
  }
  return g;
}

