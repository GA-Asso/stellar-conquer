// Render y control del Universo Stellar: galaxias como nubes de luz (sin campos de estrellas), nodos que
// se descubren al acercarse y la nave del jugador, que vuela con WASD o con clic (piloto automático).
import * as THREE from 'three';
import type { SpaceScene } from '../render/scene';
import { buildUnit } from '../render/models';
import { itemDef, type WorldState } from './economy';
import { CURATED_INNER, CURATED_SLUGS, GALAXIES, NODES, galaxyOf, nodeSlug, nodeWorldPos, type Galaxy, type WorldNode } from './ecosystem';
import { STATUS_INFO, layoutAtlas, type RavenSnapshot, type Star } from './atlas';

/** color de los astros cuya web oficial no responde */
const LOST = '#5d6275';
import { Scenery, Trail, buildStructure, starGlow } from './spacecraft';

const SHIP_SPEED = 170;
const ARRIVE = 22;
const WORLD_HALF = 1500;
const NEAR_LABELS = 10;

export interface UniverseEvents {
  onNode(n: WorldNode | null): void;
  onGalaxy(g: Galaxy | null): void;
  /** la nave llegó a un astro del atlas (o se alejó: null) */
  onStar(s: Star | null): void;
}

interface NodeView { node: WorldNode; obj: THREE.Group; core: THREE.Mesh; ring: THREE.Mesh; tick(t: number): void; label: HTMLDivElement; pos: THREE.Vector3 }

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
  // halos tenues: dan el color de la galaxia sin deslavar las estaciones que hay dentro
  group.add(sprite(col.clone().multiplyScalar(1.2), g.radius * 0.9, 0.3));
  group.add(sprite(new THREE.Color('#ffffff'), g.radius * 0.22, 0.1));
  for (let arm = 0; arm < 2; arm++) {
    for (let i = 0; i < 12; i++) {
      const t = i / 12;
      const a = arm * Math.PI + t * Math.PI * 1.6;
      const r = g.radius * (0.18 + t * 0.85);
      const s = sprite(col, g.radius * (0.55 - t * 0.3), 0.15 * (1 - t * 0.6));
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
  private stars: Star[] = [];
  private starMeshes: { mesh: THREE.InstancedMesh; kind: Star['kind']; ids: number[] }[] = [];
  private nearLabels: HTMLDivElement[] = [];
  private hoverLabel: HTMLDivElement;
  private currentStar: Star | null = null;
  private scenery: Scenery;
  private trail = new Trail();
  private glowTick: ((t: number) => void) | null = null;
  private warp = 0;
  frozen = false;

  constructor(private space: SpaceScene, private world: WorldState, host: HTMLElement, private ev: UniverseEvents, private atlas: RavenSnapshot | null = null) {
    space.scene.add(this.root);
    this.prevBound = space.rig.bound;
    space.rig.bound = WORLD_HALF + 50;
    if (atlas) {
      const centers = Object.fromEntries(GALAXIES.map(g => [g.id, g.center])) as Record<string, [number, number]>;
      const layout = layoutAtlas(atlas, centers, CURATED_INNER, CURATED_SLUGS);
      this.stars = layout.stars;
      for (const g of GALAXIES) if (layout.radius[g.id]) g.radius = Math.max(g.radius, layout.radius[g.id]);
    }
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
      const v = buildStructure(n, galaxyOf(n.galaxy).color);
      this.root.add(v.obj);
      const label = document.createElement('div');
      label.className = 'u-label k-' + n.kind;
      this.labels.appendChild(label);
      this.nodes.push({ node: n, ...v, label, pos: v.obj.position.clone() });
    }

    this.scenery = new Scenery(GALAXIES, NODES);
    this.root.add(this.scenery.group);
    this.buildStars();
    this.hoverLabel = document.createElement('div');
    this.hoverLabel.className = 'u-hover';
    this.labels.appendChild(this.hoverLabel);
    for (let i = 0; i < NEAR_LABELS; i++) {
      const el = document.createElement('div');
      el.className = 'u-label k-star';
      this.labels.appendChild(el);
      this.nearLabels.push(el);
    }

    const built = buildUnit('interceptor', 0);
    this.ship = built.group;
    this.ship.scale.setScalar(2.4);
    this.ship.position.set(0, 4, 90);
    this.root.add(this.ship);
    // luz del motor: ilumina las estaciones y los astros al pasar cerca
    const engine = new THREE.PointLight(0x7fe6ff, 900, 80, 2);
    engine.position.set(0, 1.5, -2);
    this.ship.add(engine);
    this.trail.reset(this.ship.position);
    this.root.add(this.trail.points);
    this.refresh();

    space.rig.lookAt(0, 90);
    space.rig.zoom(1.2);
    this.bindInput();
  }

  /** astros del atlas: una malla instanciada por forma (proyectos esferas, socios diamantes) y anillos de auditoría */
  private buildStars() {
    if (!this.atlas || !this.stars.length) return;
    const atlas = this.atlas;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
    const make = (kind: Star['kind'], geo: THREE.BufferGeometry) => {
      const list = this.stars.filter(s => s.kind === kind);
      if (!list.length) return;
      // esferas con luz y un brillo propio suave: se leen como astros con volumen, no como discos planos
      const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.15, emissive: 0x1c2233 }), list.length);
      const col = new THREE.Color();
      list.forEach((st, i) => {
        pos.set(st.x, 0, st.z);
        sc.setScalar(st.size);
        m.compose(pos, q, sc);
        mesh.setMatrixAt(i, m);
        // los proyectos con la web caída se ven apagados: "señal perdida"
        if (kind === 'project') col.set(atlas.projects[st.index].down ? LOST : STATUS_INFO[atlas.projects[st.index].st].color).multiplyScalar(atlas.projects[st.index].down ? 0.8 : 1.35);
        else col.set('#c9cbd6');
        mesh.setColorAt(i, col);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.root.add(mesh);
      this.starMeshes.push({ mesh, kind, ids: list.map(s => this.stars.indexOf(s)) });
    };
    make('project', new THREE.IcosahedronGeometry(1, 3));
    make('partner', new THREE.OctahedronGeometry(1.2));

    // halo titilante de cada astro, del color de su estado
    const colors = this.stars.map(st => st.kind === 'project'
      ? new THREE.Color(atlas.projects[st.index].down ? LOST : STATUS_INFO[atlas.projects[st.index].st].color).multiplyScalar(atlas.projects[st.index].down ? 0.35 : 1)
      : new THREE.Color('#c9cbd6').multiplyScalar(0.7));
    const glow = starGlow(this.stars, colors);
    this.root.add(glow.points);
    this.glowTick = glow.tick;

    // anillo para los proyectos con auditoría registrada
    const audited = this.stars.filter(s => s.kind === 'project' && atlas.projects[s.index].au);
    if (audited.length) {
      const rings = new THREE.InstancedMesh(
        new THREE.TorusGeometry(1, 0.07, 6, 40),
        new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffffff').multiplyScalar(1.2), transparent: true, opacity: 0.85 }),
        audited.length,
      );
      const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2.4, 0, 0));
      audited.forEach((st, i) => {
        pos.set(st.x, 0, st.z);
        sc.setScalar(st.size * 1.8);
        m.compose(pos, tilt, sc);
        rings.setMatrixAt(i, m);
      });
      rings.instanceMatrix.needsUpdate = true;
      this.root.add(rings);
    }
  }

  starName(s: Star): string {
    return s.kind === 'project' ? this.atlas!.projects[s.index].n : this.atlas!.partners[s.index].n;
  }

  /** vuela hacia un astro del atlas (desde el Observatorio o desde una ficha) */
  flyToStar(kind: Star['kind'], index: number) {
    const s = this.stars.find(x => x.kind === kind && x.index === index);
    if (s) { this.autopilot = new THREE.Vector3(s.x, 4, s.z + s.size + 4); return; }
    // el proyecto es un nodo curado del mapa
    const slug = kind === 'project' ? this.atlas?.projects[index]?.s : undefined;
    const n = slug ? NODES.find(x => nodeSlug(x.id) === slug) : undefined;
    if (n) this.flyTo(n);
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
    this.trail.reset(this.ship.position);
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
      if (!down) { if (e.target === el && !this.frozen) this.hover(e); else this.hoverLabel.style.display = 'none'; return; }
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

  private setRay(e: PointerEvent) {
    const rect = this.space.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.space.camera);
  }

  private pickStar(): Star | null {
    let best: { star: Star; d: number } | null = null;
    for (const sm of this.starMeshes) {
      for (const h of this.raycaster.intersectObject(sm.mesh, false)) {
        if (h.instanceId === undefined) continue;
        if (!best || h.distance < best.d) best = { star: this.stars[sm.ids[h.instanceId]], d: h.distance };
      }
    }
    return best?.star ?? null;
  }

  private hover(e: PointerEvent) {
    this.setRay(e);
    const star = this.pickStar();
    if (!star) { this.hoverLabel.style.display = 'none'; return; }
    const rect = this.space.renderer.domElement.getBoundingClientRect();
    this.hoverLabel.textContent = this.starName(star);
    this.hoverLabel.style.display = '';
    this.hoverLabel.style.transform = `translate(${e.clientX - rect.left + 14}px, ${e.clientY - rect.top - 10}px)`;
  }

  private click(e: PointerEvent) {
    this.setRay(e);
    const hits = this.raycaster.intersectObjects(this.nodes.map(v => v.core), false);
    if (hits.length) {
      const v = this.nodes.find(x => x.core === hits[0].object)!;
      this.flyTo(v.node);
      return;
    }
    const star = this.pickStar();
    if (star) { this.autopilot = new THREE.Vector3(star.x, 4, star.z + star.size + 4); return; }
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
    this.ship.position.x = THREE.MathUtils.clamp(this.ship.position.x, -WORLD_HALF, WORLD_HALF);
    this.ship.position.z = THREE.MathUtils.clamp(this.ship.position.z, -WORLD_HALF, WORLD_HALF);
    this.ship.position.y = 4 + Math.sin(this.t * 1.8) * 0.6;
    if (this.shipVel.lengthSq() > 4) {
      const yaw = Math.atan2(this.shipVel.x, this.shipVel.z);
      this.ship.rotation.y += (Math.atan2(Math.sin(yaw - this.ship.rotation.y), Math.cos(yaw - this.ship.rotation.y))) * Math.min(1, dt * 6);
    }
    rig.lookAt(this.ship.position.x, this.ship.position.z);

    for (const [i, grp] of this.galaxyGroups.entries()) grp.rotation.y = this.t * 0.02 * (i % 2 ? 1 : -1);
    for (const v of this.nodes) v.tick(this.t);
    this.scenery.update(dt, this.t);
    this.glowTick?.(this.t);
    this.trail.update(dt, this.ship.position, this.shipVel.length());
    // sensación de velocidad: el campo de visión se abre y los bordes se oscurecen al acelerar
    const k = THREE.MathUtils.smoothstep(this.shipVel.length() / SHIP_SPEED, 0.45, 1);
    this.warp += (k - this.warp) * Math.min(1, dt * 3);
    const cam = this.space.camera;
    const fov = 50 + this.warp * 8;
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    this.space.setWarp(this.warp);

    // nodo y galaxia donde está la nave
    let near: NodeView | null = null, best = ARRIVE;
    for (const v of this.nodes) {
      const d = Math.hypot(v.pos.x - this.ship.position.x, v.pos.z - this.ship.position.z);
      if (d < best) { best = d; near = v; }
    }
    const node = near?.node ?? null;
    if (node !== this.current) { this.current = node; this.ev.onNode(node); }
    // astro del atlas bajo la nave (los nodos curados tienen prioridad)
    let star: Star | null = null;
    if (!node) {
      let bd = Infinity;
      for (const st of this.stars) {
        const d = Math.hypot(st.x - this.ship.position.x, st.z - this.ship.position.z);
        if (d < st.size + 7 && d < bd) { bd = d; star = st; }
      }
    }
    if (star !== this.currentStar) { this.currentStar = star; this.ev.onStar(star); }
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
      put(el, new THREE.Vector3(g.center[0], 0, g.center[1] - g.radius * 1.15), 0, 3200);
    }
    // nombres de los astros más cercanos a la nave
    const sx = this.ship.position.x, sz = this.ship.position.z;
    const near = this.stars
      .map(st => ({ st, d: Math.hypot(st.x - sx, st.z - sz) }))
      .filter(x => x.d < 260)
      .sort((a, b) => a.d - b.d);
    // sin solapes: se descarta una etiqueta que caería encima de otra ya colocada
    const placed: { x: number; y: number }[] = [];
    const v3 = new THREE.Vector3();
    let k = 0;
    for (const it of near) {
      if (k >= NEAR_LABELS) break;
      v3.set(it.st.x, it.st.size + 5, it.st.z).project(cam);
      if (v3.z >= 1) continue;
      const x = (v3.x * 0.5 + 0.5) * w, y = (-v3.y * 0.5 + 0.5) * h;
      if (placed.some(p => Math.abs(p.x - x) < 90 && Math.abs(p.y - y) < 18)) continue;
      placed.push({ x, y });
      const el = this.nearLabels[k++];
      el.textContent = this.starName(it.st);
      el.classList.toggle('here', it.st === this.currentStar);
      el.style.display = '';
      el.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`;
    }
    for (; k < NEAR_LABELS; k++) this.nearLabels[k].style.display = 'none';
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
    this.space.camera.fov = 50;
    this.space.camera.updateProjectionMatrix();
    this.space.setWarp(0);
  }
}
