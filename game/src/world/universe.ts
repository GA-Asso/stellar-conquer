// Render y control del Universo Stellar: galaxias como nubes de luz (sin campos de estrellas), nodos que
// se descubren al acercarse y la nave del jugador, que vuela con WASD o con clic (piloto automático).
import * as THREE from 'three';
import type { SpaceScene } from '../render/scene';
import { buildUnit } from '../render/models';
import { itemDef, type WorldState } from './economy';
import { GALAXIES, NODES, galaxyOf, nodeWorldPos, type Galaxy, type WorldNode } from './ecosystem';

const SHIP_SPEED = 140;
const ARRIVE = 22;

export interface UniverseEvents {
  onNode(n: WorldNode | null): void;
  onGalaxy(g: Galaxy | null): void;
}

interface NodeView { node: WorldNode; obj: THREE.Group; core: THREE.Mesh; ring: THREE.Mesh; label: HTMLDivElement; pos: THREE.Vector3 }

let glowTex: THREE.Texture | null = null;
function glow(): THREE.Texture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  grd.addColorStop(0.6, 'rgba(255,255,255,0.08)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

function sprite(color: THREE.Color, size: number, opacity: number): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glow(), color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  s.scale.setScalar(size);
  return s;
}

/** galaxia espiral hecha de pocas manchas de luz grandes y suaves: se lee como nebulosa, no como puntos */
function buildGalaxy(g: Galaxy): THREE.Group {
  const group = new THREE.Group();
  group.position.set(g.center[0], -18, g.center[1]);
  const col = new THREE.Color(g.color);
  group.add(sprite(col.clone().multiplyScalar(1.4), g.radius * 0.9, 0.55));
  group.add(sprite(new THREE.Color('#ffffff'), g.radius * 0.28, 0.5));
  for (let arm = 0; arm < 2; arm++) {
    for (let i = 0; i < 12; i++) {
      const t = i / 12;
      const a = arm * Math.PI + t * Math.PI * 1.6;
      const r = g.radius * (0.18 + t * 0.85);
      const s = sprite(col, g.radius * (0.55 - t * 0.3), 0.22 * (1 - t * 0.6));
      s.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      group.add(s);
    }
  }
  // borde del territorio sobre el plano
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(g.radius * 1.12, g.radius * 1.14, 96),
    new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 17;
  group.add(ring);
  return group;
}

function buildNode(n: WorldNode): { obj: THREE.Group; core: THREE.Mesh; ring: THREE.Mesh } {
  const obj = new THREE.Group();
  const col = new THREE.Color(galaxyOf(n.galaxy).color);
  const service = n.kind === 'dex' || n.kind === 'market' || n.kind === 'trade';
  let geo: THREE.BufferGeometry;
  if (n.kind === 'frontier') geo = new THREE.OctahedronGeometry(9);
  else if (service) geo = new THREE.SphereGeometry(9, 24, 16);
  else geo = new THREE.IcosahedronGeometry(5.5, 0);
  const core = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    color: col, emissive: col, emissiveIntensity: 0.6, roughness: 0.4, metalness: 0.3, flatShading: !service,
  }));
  obj.add(core);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(service ? 16 : 10, service ? 1.1 : 0.5, 8, 64),
    new THREE.MeshBasicMaterial({ color: service ? new THREE.Color('#fdda24').multiplyScalar(2) : col, transparent: true, opacity: 0.8 }),
  );
  ring.rotation.x = Math.PI / 2.3;
  obj.add(ring);
  obj.add(sprite(col, service ? 48 : 26, 0.35));
  const [x, z] = nodeWorldPos(n);
  obj.position.set(x, 0, z);
  return { obj, core, ring };
}

export class Universe {
  private root = new THREE.Group();
  private ship: THREE.Group;
  private shipVel = new THREE.Vector3();
  private autopilot: THREE.Vector3 | null = null;
  private nodes: NodeView[] = [];
  private galaxyLabels: { g: Galaxy; el: HTMLDivElement }[] = [];
  private labels: HTMLDivElement;
  private keys = new Set<string>();
  private current: WorldNode | null = null;
  private currentGalaxy: Galaxy | null = null;
  private galaxyGroups: THREE.Group[] = [];
  private t = 0;
  private cleanup: (() => void)[] = [];
  private raycaster = new THREE.Raycaster();
  private prevBound: number;
  frozen = false;

  constructor(private space: SpaceScene, private world: WorldState, host: HTMLElement, private ev: UniverseEvents) {
    space.scene.add(this.root);
    this.prevBound = space.rig.bound;
    space.rig.bound = 1000;
    for (const g of GALAXIES) {
      const grp = buildGalaxy(g);
      this.galaxyGroups.push(grp);
      this.root.add(grp);
    }
    this.labels = document.createElement('div');
    this.labels.className = 'u-labels';
    host.appendChild(this.labels);
    for (const g of GALAXIES) {
      const el = document.createElement('div');
      el.className = 'u-galaxy-label';
      el.style.color = g.color;
      el.textContent = g.name;
      this.labels.appendChild(el);
      this.galaxyLabels.push({ g, el });
    }
    for (const n of NODES) {
      const v = buildNode(n);
      this.root.add(v.obj);
      const label = document.createElement('div');
      label.className = 'u-label k-' + n.kind;
      this.labels.appendChild(label);
      this.nodes.push({ node: n, ...v, label, pos: v.obj.position.clone() });
    }

    const built = buildUnit('interceptor', 0);
    this.ship = built.group;
    this.ship.scale.setScalar(2.4);
    this.ship.position.set(0, 4, 90);
    this.root.add(this.ship);
    this.refresh();

    space.rig.lookAt(0, 90);
    space.rig.zoom(1.2);
    this.bindInput();
  }

  /** actualiza el aspecto de los nodos según lo descubierto, quién controla cada sector y el casco */
  refresh() {
    for (const v of this.nodes) {
      const n = v.node;
      const mat = v.core.material as THREE.MeshStandardMaterial;
      const found = this.world.discovered.includes(n.id);
      let tag = '';
      if (n.kind === 'frontier') {
        const s = this.world.sectors.find(x => x.id === n.sector)!;
        const c = new THREE.Color(s.owner === 'player' ? '#2ee6ff' : '#ff3d8b');
        mat.color.copy(c); mat.emissive.copy(c);
        tag = s.owner === 'player' ? ' · tuyo' : ' · rival';
      } else if (n.quiz) {
        mat.emissiveIntensity = found ? 1.1 : 0.25;
        (v.ring.material as THREE.MeshBasicMaterial).opacity = found ? 0.9 : 0.25;
        tag = found ? ' ✓' : ' ?';
      }
      v.label.textContent = n.name + tag;
      v.label.classList.toggle('found', found);
    }
    const skin = this.world.skin ? itemDef(this.world.skin).color : null;
    this.ship.traverse(o => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (!m || !('emissive' in m)) return;
      if (!o.userData.baseEmissive) o.userData.baseEmissive = m.emissive.clone();
      m.emissive.copy(skin ? new THREE.Color(skin) : o.userData.baseEmissive);
    });
  }

  /** salta directamente a un nodo (pruebas y atajos) */
  warpTo(id: string) {
    const n = NODES.find(x => x.id === id);
    if (!n) return;
    const [x, z] = nodeWorldPos(n);
    this.ship.position.set(x, 4, z + 6);
    this.autopilot = null;
    this.shipVel.set(0, 0, 0);
  }

  flyTo(n: WorldNode) {
    const [x, z] = nodeWorldPos(n);
    this.autopilot = new THREE.Vector3(x, 4, z + ARRIVE * 0.6);
  }

  private bindInput() {
    const el = this.space.renderer.domElement;
    let down: { x: number; y: number; moved: boolean; button: number } | null = null;
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY, moved: false, button: e.button }; };
    const onMove = (e: PointerEvent) => {
      if (!down) return;
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) down.moved = true;
      if (down.moved) {
        this.space.rig.rotate(-dx * 0.005, dy * 0.004);
        down.x = e.clientX; down.y = e.clientY;
      }
    };
    const onUp = (e: PointerEvent) => {
      if (down && !down.moved && down.button === 0 && !this.frozen) this.click(e);
      down = null;
    };
    const onWheel = (e: WheelEvent) => { this.space.rig.zoom(e.deltaY > 0 ? 1.1 : 0.9); e.preventDefault(); };
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT') return;
      const k = e.key.toLowerCase();
      if (e.type === 'keydown') this.keys.add(k); else this.keys.delete(k);
    };
    const onCtx = (e: Event) => e.preventDefault();
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('contextmenu', onCtx);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    this.cleanup.push(() => {
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('contextmenu', onCtx);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    });
  }

  private click(e: PointerEvent) {
    const rect = this.space.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.space.camera);
    const hits = this.raycaster.intersectObjects(this.nodes.map(v => v.core), false);
    if (hits.length) {
      const v = this.nodes.find(x => x.core === hits[0].object)!;
      this.flyTo(v.node);
      return;
    }
    const p = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -4), p)) this.autopilot = p;
  }

  update(dt: number) {
    this.t += dt;
    const rig = this.space.rig;
    // empuje manual relativo a la cámara
    const f = (this.keys.has('w') || this.keys.has('arrowup') ? 1 : 0) - (this.keys.has('s') || this.keys.has('arrowdown') ? 1 : 0);
    const r = (this.keys.has('d') || this.keys.has('arrowright') ? 1 : 0) - (this.keys.has('a') || this.keys.has('arrowleft') ? 1 : 0);
    const want = new THREE.Vector3();
    if (!this.frozen && (f || r)) {
      this.autopilot = null;
      want.set(Math.cos(rig.yaw) * r - Math.sin(rig.yaw) * f, 0, -Math.sin(rig.yaw) * r - Math.cos(rig.yaw) * f).normalize().multiplyScalar(SHIP_SPEED);
    } else if (this.autopilot) {
      const d = this.autopilot.clone().sub(this.ship.position).setY(0);
      const len = d.length();
      if (len < 2) this.autopilot = null;
      else want.copy(d.normalize().multiplyScalar(Math.min(SHIP_SPEED, len * 2.2)));
    }
    this.shipVel.lerp(want, 1 - Math.exp(-dt * 4));
    this.ship.position.addScaledVector(this.shipVel, dt);
    this.ship.position.x = THREE.MathUtils.clamp(this.ship.position.x, -980, 980);
    this.ship.position.z = THREE.MathUtils.clamp(this.ship.position.z, -980, 980);
    this.ship.position.y = 4 + Math.sin(this.t * 1.8) * 0.6;
    if (this.shipVel.lengthSq() > 4) {
      const yaw = Math.atan2(this.shipVel.x, this.shipVel.z);
      this.ship.rotation.y += (Math.atan2(Math.sin(yaw - this.ship.rotation.y), Math.cos(yaw - this.ship.rotation.y))) * Math.min(1, dt * 6);
    }
    rig.lookAt(this.ship.position.x, this.ship.position.z);

    for (const [i, grp] of this.galaxyGroups.entries()) grp.rotation.y = this.t * 0.02 * (i % 2 ? 1 : -1);
    for (const v of this.nodes) {
      v.ring.rotation.z = this.t * 0.4;
      v.core.rotation.y = this.t * 0.6;
    }

    // nodo y galaxia donde está la nave
    let near: NodeView | null = null, best = ARRIVE;
    for (const v of this.nodes) {
      const d = Math.hypot(v.pos.x - this.ship.position.x, v.pos.z - this.ship.position.z);
      if (d < best) { best = d; near = v; }
    }
    const node = near?.node ?? null;
    if (node !== this.current) { this.current = node; this.ev.onNode(node); }
    const gal = GALAXIES.find(g => Math.hypot(g.center[0] - this.ship.position.x, g.center[1] - this.ship.position.z) < g.radius * 1.15) ?? null;
    if (gal !== this.currentGalaxy) { this.currentGalaxy = gal; this.ev.onGalaxy(gal); }

    this.placeLabels();
  }

  private placeLabels() {
    const cam = this.space.camera;
    const w = this.space.renderer.domElement.clientWidth, h = this.space.renderer.domElement.clientHeight;
    const p = new THREE.Vector3();
    const put = (el: HTMLDivElement, pos: THREE.Vector3, yOff: number, maxDist: number) => {
      p.copy(pos);
      p.y += yOff;
      const dist = p.distanceTo(cam.position);
      p.project(cam);
      const visible = p.z < 1 && dist < maxDist && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1;
      el.style.display = visible ? '' : 'none';
      if (visible) el.style.transform = `translate(-50%, -100%) translate(${(p.x * 0.5 + 0.5) * w}px, ${(-p.y * 0.5 + 0.5) * h}px)`;
    };
    for (const v of this.nodes) {
      const service = v.node.kind !== 'info';
      put(v.label, v.pos, service ? 20 : 12, service ? 1400 : 520);
      v.label.classList.toggle('here', v.node === this.current);
    }
    for (const { g, el } of this.galaxyLabels) {
      put(el, new THREE.Vector3(g.center[0], 0, g.center[1] - g.radius * 1.15), 0, 2400);
    }
  }

  dispose() {
    this.cleanup.forEach(f => f());
    this.space.scene.remove(this.root);
    this.root.traverse(o => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach(x => x.dispose()); else mat?.dispose();
    });
    this.labels.remove();
    this.space.rig.bound = this.prevBound;
  }
}
