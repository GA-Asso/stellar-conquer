// Infraestructura espacial del Universo: cada nodo es una construcción que dice qué hace (estación de
// anillo para el DEX, bazar orbital, puerto de carga, radiotelescopio, ciudadela, satélites temáticos),
// y alrededor hay puertas de salto, rutas comerciales con tráfico de naves, planetas y cinturones de
// asteroides. Todo procedural con primitivas de Three.js, sin archivos externos.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildPlanet, buildUnit } from '../render/models';
import { nodeWorldPos, type Galaxy, type WorldNode } from './ecosystem';

export interface Structure { obj: THREE.Group; core: THREE.Mesh; ring: THREE.Mesh; tick(t: number): void }

// ---------- materiales compartidos ----------
let kit: ReturnType<typeof makeKit> | null = null;
function makeKit() {
  return {
    hull: new THREE.MeshStandardMaterial({ color: 0xd8dde8, metalness: 0.55, roughness: 0.38 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1a1e2c, metalness: 0.75, roughness: 0.35 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x59617a, metalness: 0.7, roughness: 0.4 }),
    panel: new THREE.MeshStandardMaterial({ color: 0x14275e, metalness: 0.8, roughness: 0.22, emissive: 0x0a1d66, emissiveIntensity: 0.7 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xfdda24, metalness: 0.9, roughness: 0.25, emissive: 0x6b5200, emissiveIntensity: 0.45 }),
    // colores > 1: el bloom los hace brillar
    windows: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.7, 1.4, 0.9) }),
    red: new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.35, 0.3) }),
    white: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.2, 2.4) }),
    cyan: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 2, 2.6) }),
  };
}
const K = () => (kit ??= makeKit());

const box = (w: number, h: number, d: number, m: THREE.Material) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
const cyl = (rt: number, rb: number, h: number, m: THREE.Material, seg = 20) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
const sph = (r: number, m: THREE.Material, w = 20, h = 14) => new THREE.Mesh(new THREE.SphereGeometry(r, w, h), m);
const tor = (r: number, t: number, m: THREE.Material, seg = 64) => new THREE.Mesh(new THREE.TorusGeometry(r, t, 10, seg), m);
/** franja de luz: cilindro sin tapas, para que solo brille el borde */
const band = (r: number, h: number, m: THREE.Material, seg = 24) => new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg, 1, true), m);
function at<T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T { o.position.set(x, y, z); return o; }
function flat<T extends THREE.Object3D>(o: T): T { o.rotation.x = Math.PI / 2; return o; }

/** luz de posición que parpadea con su propio desfase */
function blinker(m: THREE.Material, r: number, phase: number, lights: { o: THREE.Object3D; p: number }[]) {
  const s = sph(r, m, 8, 6);
  lights.push({ o: s, p: phase });
  return s;
}
const blink = (lights: { o: THREE.Object3D; p: number }[], t: number, rate = 1.3) => {
  for (const l of lights) l.o.visible = ((t * rate + l.p) % 1) < 0.55;
};

/** par de alas solares con su mástil */
function solarWings(span: number, chord: number, y: number): THREE.Group {
  const g = at(new THREE.Group(), 0, y, 0);
  g.add(flat(at(cyl(0.35, 0.35, span * 2 + 4, K().steel, 6), 0, 0, 0)).rotateZ(Math.PI / 2));
  for (const s of [-1, 1]) {
    const w = at(box(span, 0.18, chord, K().panel), s * (span / 2 + 2.2), 0, 0);
    g.add(w);
    // nervios del panel
    for (let i = 1; i < 4; i++) g.add(at(box(0.12, 0.22, chord, K().steel), s * (2.2 + (span * i) / 4), 0, 0));
  }
  return g;
}

// ---------- construcciones por tipo de nodo ----------

/** DEX: estación de anillo giratorio con hub central y anillo exterior de atraque */
function ringStation(core: THREE.Mesh, ring: THREE.Mesh): Structure {
  const k = K(), g = new THREE.Group(), lights: { o: THREE.Object3D; p: number }[] = [];
  g.add(at(cyl(3.2, 3.6, 12, k.hull, 24), 0, 4, 0));
  g.add(at(band(3.7, 1.2, k.windows), 0, 5, 0));
  g.add(at(core, 0, 11, 0));
  const spin = at(new THREE.Group(), 0, 4, 0);
  spin.add(flat(tor(17, 2.1, k.hull, 72)));
  spin.add(flat(tor(19.2, 0.32, k.windows, 72)));
  for (let i = 0; i < 3; i++) {
    const s = box(34, 0.9, 0.9, k.steel);
    s.rotation.y = (i / 3) * Math.PI;
    spin.add(s);
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    spin.add(at(box(2.6, 2.6, 2.6, k.dark), Math.cos(a) * 17, 0, Math.sin(a) * 17));
  }
  g.add(spin);
  g.add(solarWings(9, 3.5, -3));
  g.add(at(cyl(0.18, 0.18, 9, k.steel, 6), 0, 16, 0));
  g.add(at(blinker(k.red, 0.6, 0, lights), 0, 20.5, 0));
  ring.scale.setScalar(1.45);
  g.add(at(ring, 0, 4, 0));
  return { obj: g, core, ring, tick: t => { spin.rotation.y = t * 0.22; ring.rotation.z = -t * 0.12; blink(lights, t); } };
}

/** Mercado: bazar orbital, una espina con módulos y anillos de contenedores de colores */
function bazaar(core: THREE.Mesh, ring: THREE.Mesh): Structure {
  const k = K(), g = new THREE.Group(), lights: { o: THREE.Object3D; p: number }[] = [];
  const crate = ['#ff8a3d', '#2ee6ff', '#fdda24', '#8b5cff', '#ff3d8b', '#7cf5c8'].map(c =>
    new THREE.MeshStandardMaterial({ color: c, metalness: 0.35, roughness: 0.5, emissive: c, emissiveIntensity: 0.12 }));
  g.add(at(cyl(1.2, 1.2, 30, k.steel, 8), 0, 6, 0));
  const stack = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const y = -4 + i * 6;
    stack.add(at(cyl(4.4, 4.4, 3.4, i % 2 ? k.dark : k.hull, 24), 0, y, 0));
    stack.add(at(band(4.5, 0.5, k.windows), 0, y + 0.9, 0));
    const n = 7;
    for (let j = 0; j < n; j++) {
      const a = (j / n) * Math.PI * 2 + i * 0.4;
      const c = at(box(2.2, 2.4, 3.6, crate[(i * 3 + j) % crate.length]), Math.cos(a) * 6.6, y, Math.sin(a) * 6.6);
      c.rotation.y = -a;
      stack.add(c);
    }
  }
  g.add(stack);
  g.add(solarWings(10, 4, 21));
  g.add(at(core, 0, 25, 0));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    g.add(at(blinker(i % 2 ? k.white : k.red, 0.5, i * 0.25, lights), Math.cos(a) * 9, -6, Math.sin(a) * 9));
  }
  ring.scale.setScalar(1.15);
  g.add(at(ring, 0, -6, 0));
  return { obj: g, core, ring, tick: t => { stack.rotation.y = t * 0.15; ring.rotation.z = t * 0.2; blink(lights, t, 0.9); } };
}

/** Puerto Comercial: plataforma hexagonal con brazos de atraque, cargueros amarrados y torre de control */
function cargoPort(core: THREE.Mesh, ring: THREE.Mesh): Structure {
  const k = K(), g = new THREE.Group(), lights: { o: THREE.Object3D; p: number }[] = [];
  g.add(at(cyl(14, 13, 1.6, k.dark, 6), 0, 0, 0));
  g.add(at(band(14.1, 0.35, k.windows, 6), 0, 0.7, 0));
  g.add(at(cyl(9, 9, 0.4, k.steel, 6), 0, 1, 0));
  g.add(at(cyl(2.2, 3.2, 12, k.hull, 12), 0, 7, 0));
  g.add(at(band(3.4, 2, k.cyan, 12), 0, 12.5, 0));
  g.add(at(core, 0, 15.5, 0));
  const docked: THREE.Group[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const arm = at(box(12, 1.1, 2.4, k.hull), Math.cos(a) * 19, 0.5, Math.sin(a) * 19);
    arm.rotation.y = -a;
    g.add(arm);
    // luces de pista a lo largo del brazo, encendidas en secuencia
    for (let j = 0; j < 4; j++) g.add(at(blinker(k.white, 0.35, j * 0.18, lights), Math.cos(a) * (14.5 + j * 3), 1.4, Math.sin(a) * (14.5 + j * 3)));
    if (i % 2 === 0) {
      const ship = buildUnit('frigate', -1).group;
      ship.scale.setScalar(0.9);
      ship.position.set(Math.cos(a + 0.35) * 22, 3, Math.sin(a + 0.35) * 22);
      ship.rotation.y = -a + Math.PI / 2;
      g.add(ship);
      docked.push(ship);
    }
  }
  ring.scale.setScalar(1.75);
  g.add(at(ring, 0, 1, 0));
  return {
    obj: g, core, ring, tick: t => {
      blink(lights, t, 0.8);
      docked.forEach((s, i) => { s.position.y = 3 + Math.sin(t * 1.2 + i) * 0.4; });
      ring.rotation.z = t * 0.1;
    },
  };
}

/** Observatorio Raven: radiotelescopio principal y una red de antenas menores */
function observatory(core: THREE.Mesh, ring: THREE.Mesh): Structure {
  const k = K(), g = new THREE.Group(), lights: { o: THREE.Object3D; p: number }[] = [];
  const dishGeo = new THREE.SphereGeometry(12, 36, 10, 0, Math.PI * 2, 0, Math.PI * 0.3);
  const dishMat = new THREE.MeshStandardMaterial({ color: 0xe7ebf3, metalness: 0.6, roughness: 0.3, side: THREE.DoubleSide });
  const dish = (scale: number) => {
    const piv = new THREE.Group();
    const d = new THREE.Mesh(dishGeo, dishMat);
    d.rotation.x = Math.PI; // cóncava hacia arriba
    d.position.y = 12 * scale;
    d.scale.setScalar(scale);
    piv.add(d);
    piv.add(at(cyl(0.15 * scale, 0.15 * scale, 7 * scale, k.steel, 6), 0, 3.6 * scale, 0));
    return piv;
  };
  g.add(at(cyl(6, 7.5, 2.2, k.dark, 8), 0, 0, 0));
  g.add(at(cyl(1.3, 1.8, 8, k.hull, 12), 0, 5, 0));
  const head = at(new THREE.Group(), 0, 9, 0);
  const tilt = new THREE.Group();
  tilt.rotation.x = -0.55;
  const main = dish(1);
  main.position.y = -12 + 0.5;
  tilt.add(main);
  tilt.add(at(cyl(0.2, 0.2, 9, k.steel, 6), 0, 5, 0));
  tilt.add(at(core, 0, 9.5, 0));
  head.add(tilt);
  g.add(head);
  const minis: THREE.Group[] = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.6;
    const m = dish(0.4);
    m.position.set(Math.cos(a) * 15, -2.5, Math.sin(a) * 15);
    m.rotation.x = -0.5;
    g.add(at(cyl(0.9, 1.2, 1.4, k.dark, 8), Math.cos(a) * 15, 0, Math.sin(a) * 15));
    g.add(m);
    minis.push(m);
    g.add(at(blinker(k.cyan, 0.4, i / 3, lights), Math.cos(a) * 15, 3.5, Math.sin(a) * 15));
  }
  ring.scale.setScalar(1.6);
  g.add(at(ring, 0, 1, 0));
  return {
    obj: g, core, ring, tick: t => {
      head.rotation.y = t * 0.12;
      minis.forEach((m, i) => { m.rotation.y = t * 0.12 + i; });
      blink(lights, t, 0.7);
      ring.rotation.z = t * 0.15;
    },
  };
}

/** Frontera: ciudadela con muralla hexagonal, torres y escudo; se tiñe del color de su dueño */
function citadel(core: THREE.Mesh, ring: THREE.Mesh): Structure {
  const k = K(), g = new THREE.Group(), lights: { o: THREE.Object3D; p: number }[] = [];
  g.add(at(cyl(13, 14, 2, k.dark, 6), 0, 0, 0));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const wall = at(box(12.5, 3.5, 1.2, k.steel), Math.cos(a + Math.PI / 6) * 11.3, 2.5, Math.sin(a + Math.PI / 6) * 11.3);
    wall.rotation.y = -(a + Math.PI / 6) + Math.PI / 2;
    g.add(wall);
    g.add(at(cyl(1.4, 1.8, 7, k.hull, 8), Math.cos(a) * 13, 3.5, Math.sin(a) * 13));
    g.add(at(blinker(k.red, 0.5, i / 6, lights), Math.cos(a) * 13, 7.5, Math.sin(a) * 13));
  }
  g.add(at(cyl(4, 5.5, 6, k.hull, 6), 0, 3, 0));
  core.geometry.dispose();
  core.geometry = new THREE.OctahedronGeometry(6);
  g.add(at(core, 0, 13, 0));
  const coreMat = core.material as THREE.MeshStandardMaterial;
  const shieldMat = new THREE.MeshBasicMaterial({ color: coreMat.color, wireframe: true, transparent: true, opacity: 0.12, depthWrite: false });
  const shield = at(new THREE.Mesh(new THREE.IcosahedronGeometry(19, 1), shieldMat), 0, 2, 0);
  g.add(shield);
  ring.scale.setScalar(1.6);
  g.add(at(ring, 0, 1, 0));
  return {
    obj: g, core, ring, tick: t => {
      core.rotation.y = t * 0.8;
      core.position.y = 13 + Math.sin(t * 1.5) * 0.8;
      shieldMat.color.copy(coreMat.color);
      shieldMat.opacity = 0.09 + Math.sin(t * 2) * 0.03;
      shield.rotation.y = -t * 0.1;
      blink(lights, t, 1.1);
    },
  };
}

/** satélites de los nodos de información: la forma depende de la galaxia */
function satellite(galaxy: string, core: THREE.Mesh, ring: THREE.Mesh): Structure {
  const k = K(), g = new THREE.Group(), lights: { o: THREE.Object3D; p: number }[] = [];
  const glow = ring.material as THREE.Material;
  const spins: { o: THREE.Object3D; ax: 'x' | 'y' | 'z'; s: number }[] = [];
  switch (galaxy) {
    case 'nucleo': { // nodo validador: monolito con franjas de luz y un satélite en órbita
      g.add(at(box(5, 13, 5, k.dark), 0, 4.5, 0));
      for (const [x, z] of [[-2.55, -2.55], [2.55, -2.55], [-2.55, 2.55], [2.55, 2.55]]) g.add(at(box(0.35, 11, 0.35, glow), x, 4.5, z));
      for (let i = 0; i < 4; i++) g.add(at(box(5.1, 0.25, 5.1, k.windows), 0, 0 + i * 3, 0));
      g.add(at(core, 0, 13.5, 0));
      const orbit = new THREE.Group();
      const sat = at(new THREE.Group(), 9, 6, 0);
      sat.add(box(1.4, 1.4, 1.4, k.hull));
      sat.add(at(box(4, 0.1, 1.2, k.panel), 0, 0, 0));
      orbit.add(sat);
      g.add(orbit);
      spins.push({ o: orbit, ax: 'y', s: 0.7 });
      break;
    }
    case 'wallets': { // bóveda: prisma hexagonal con bandas doradas y cerrojo giratorio
      g.add(at(cyl(4.5, 4.5, 8, k.hull, 6), 0, 3, 0));
      g.add(at(cyl(4.6, 4.6, 0.6, k.gold, 6), 0, 0.5, 0));
      g.add(at(cyl(4.6, 4.6, 0.6, k.gold, 6), 0, 5.5, 0));
      const lock = at(new THREE.Group(), 0, 3, 0);
      lock.add(tor(6.2, 0.45, k.gold, 6));
      g.add(lock);
      spins.push({ o: lock, ax: 'y', s: 0.5 });
      g.add(at(core, 0, 9, 0));
      break;
    }
    case 'defi': { // reactor: núcleo de energía dentro de anillos de cardán
      g.add(at(core, 0, 7, 0));
      core.scale.setScalar(1.5);
      for (let i = 0; i < 3; i++) {
        const gim = at(new THREE.Group(), 0, 7, 0);
        gim.add(tor(5 + i * 1.2, 0.3, i === 1 ? k.gold : k.hull, 48));
        gim.rotation.set(i * 1.1, i * 0.7, 0);
        g.add(gim);
        spins.push({ o: gim, ax: i === 0 ? 'x' : i === 1 ? 'y' : 'z', s: 0.6 + i * 0.25 });
      }
      g.add(at(cyl(0.5, 1.5, 6, k.steel, 8), 0, 1, 0));
      break;
    }
    case 'soroban': { // forja: base hexagonal, horno encendido y grúa giratoria
      g.add(at(cyl(6, 6.5, 2.4, k.dark, 6), 0, 0, 0));
      g.add(at(cyl(3, 3.6, 5, k.steel, 6), 0, 3.5, 0));
      g.add(at(core, 0, 7, 0));
      const crane = at(new THREE.Group(), 0, 0, 0);
      crane.add(at(box(1, 12, 1, k.gold), 5, 6, 0));
      crane.add(at(box(10, 0.8, 0.8, k.gold), 1, 12, 0));
      crane.add(at(box(1.6, 1.6, 1.6, k.hull), -3, 10, 0));
      g.add(crane);
      spins.push({ o: crane, ax: 'y', s: 0.35 });
      break;
    }
    default: { // repetidor de comunicaciones con alas solares y antena
      g.add(at(box(3.6, 3.6, 6, k.hull), 0, 4, 0));
      g.add(at(box(3.7, 0.4, 6.1, k.windows), 0, 4.6, 0));
      g.add(solarWings(7, 3, 4));
      const d = new THREE.Mesh(new THREE.SphereGeometry(2.4, 20, 8, 0, Math.PI * 2, 0, Math.PI * 0.35),
        new THREE.MeshStandardMaterial({ color: 0xe7ebf3, metalness: 0.6, roughness: 0.3, side: THREE.DoubleSide }));
      d.rotation.x = Math.PI * 0.75;
      g.add(at(d, 0, 4, 4.6));
      g.add(at(cyl(0.12, 0.12, 5, k.steel, 6), 0, 8, 0));
      g.add(at(core, 0, 11, 0));
      core.scale.setScalar(0.7);
    }
  }
  g.add(at(blinker(k.red, 0.35, Math.random(), lights), 0, -0.5, 0));
  g.add(at(ring, 0, 4, 0));
  return {
    obj: g, core, ring, tick: t => {
      for (const s of spins) s.o.rotation[s.ax] = t * s.s;
      ring.rotation.z = t * 0.4;
      blink(lights, t);
    },
  };
}

export function buildStructure(n: WorldNode, color: string): Structure {
  const col = new THREE.Color(color);
  const core = sph(2.6, new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.9, roughness: 0.3, metalness: 0.2 }));
  const service = n.kind !== 'info';
  const ring = tor(10, service ? 0.45 : 0.3, new THREE.MeshBasicMaterial({
    color: service ? new THREE.Color('#fdda24').multiplyScalar(1.25) : col.clone().multiplyScalar(1.3), transparent: true, opacity: 0.7,
  }));
  ring.rotation.x = Math.PI / 2;
  let s: Structure;
  switch (n.kind) {
    case 'dex': s = ringStation(core, ring); break;
    case 'market': s = bazaar(core, ring); break;
    case 'trade': s = cargoPort(core, ring); break;
    case 'atlas': s = observatory(core, ring); break;
    case 'frontier': s = citadel(core, ring); break;
    default: s = satellite(n.galaxy, core, ring);
  }
  const [x, z] = nodeWorldPos(n);
  s.obj.position.set(x, 0, z);
  s.obj.scale.setScalar(service ? 1.4 : 1.25);
  return s;
}

// ---------- escenario: puertas de salto, rutas, tráfico, planetas y asteroides ----------

const hash = (s: string, i = 0) => {
  let h = 2166136261 ^ i;
  for (let k = 0; k < s.length; k++) h = Math.imul(h ^ s.charCodeAt(k), 16777619);
  return ((h >>> 0) % 10_000) / 10_000;
};

/** puerta de salto: anillo segmentado vertical con portal pulsante, mirando hacia la ruta */
function jumpGate(color: THREE.Color): { obj: THREE.Group; tick(t: number): void } {
  const k = K(), g = new THREE.Group(), lights: { o: THREE.Object3D; p: number }[] = [];
  const R = 13;
  const frame = at(new THREE.Group(), 0, R + 2, 0);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const seg = at(box(6.4, 2.6, 3, i % 2 ? k.steel : k.hull), Math.cos(a) * R, Math.sin(a) * R, 0);
    seg.rotation.z = a + Math.PI / 2;
    frame.add(seg);
    if (i % 2 === 0) frame.add(at(blinker(k.white, 0.45, i / 10, lights), Math.cos(a) * (R + 1.8), Math.sin(a) * (R + 1.8), 0));
  }
  frame.add(tor(R - 1.6, 0.45, new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(2) }), 64));
  const portalMat = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(1.2), transparent: true, opacity: 0.25, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
  const portal = new THREE.Mesh(new THREE.CircleGeometry(R - 1.8, 48), portalMat);
  frame.add(portal);
  g.add(frame);
  // pilones de anclaje
  for (const s of [-1, 1]) g.add(at(box(2, 4, 2, k.dark), s * (R - 2), 1, 0));
  return {
    obj: g, tick: t => {
      portalMat.opacity = 0.18 + (Math.sin(t * 2.2) * 0.5 + 0.5) * 0.18;
      portal.rotation.z = t * 0.5;
      blink(lights, t, 0.6);
    },
  };
}

/** casco de nave de tráfico (una sola geometría para instanciar): carguero con contenedores */
function trafficGeometry(): { hull: THREE.BufferGeometry; engine: THREE.BufferGeometry } {
  const parts: THREE.BufferGeometry[] = [];
  const add = (geo: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0) => {
    if (rx) geo.rotateX(rx);
    geo.translate(x, y, z);
    parts.push(geo.toNonIndexed());
  };
  add(new THREE.BoxGeometry(1.4, 0.9, 3.6), 0, 0, 0);
  add(new THREE.ConeGeometry(0.75, 1.6, 6), 0, 0, 2.6, Math.PI / 2);
  add(new THREE.BoxGeometry(4.2, 0.14, 1.3), 0, 0, -0.6);
  add(new THREE.BoxGeometry(1.1, 1.1, 1.4), 0, 0.95, -0.3);
  add(new THREE.BoxGeometry(0.15, 1, 1), 0, 0.7, -1.5);
  const engine = new THREE.SphereGeometry(0.42, 8, 6);
  engine.scale(1, 1, 1.8);
  const e2 = engine.clone();
  engine.translate(-0.45, 0, -2);
  e2.translate(0.45, 0, -2);
  return { hull: mergeGeometries(parts)!, engine: mergeGeometries([engine.toNonIndexed(), e2.toNonIndexed()])! };
}

interface Traveler { a: THREE.Vector3; b: THREE.Vector3; u: number; speed: number; arc: number; scale: number; pool?: THREE.Vector3[] }

export class Scenery {
  readonly group = new THREE.Group();
  private ticks: ((t: number) => void)[] = [];
  private ships: Traveler[] = [];
  private hull!: THREE.InstancedMesh;
  private engines!: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private tan = new THREE.Vector3();
  private sc = new THREE.Vector3();
  private fwd = new THREE.Vector3(0, 0, 1);

  constructor(galaxies: Galaxy[], nodes: WorldNode[]) {
    const hub = galaxies.find(g => g.id === 'nucleo')!;
    const hubC = new THREE.Vector3(hub.center[0], 0, hub.center[1]);

    // rutas comerciales: del núcleo a cada galaxia, con una puerta de salto a la entrada
    const laneMat = new THREE.LineDashedMaterial({ color: new THREE.Color('#fdda24'), dashSize: 9, gapSize: 12, transparent: true, opacity: 0.32, depthWrite: false });
    for (const g of galaxies) {
      if (g === hub) continue;
      const c = new THREE.Vector3(g.center[0], 0, g.center[1]);
      const dir = c.clone().sub(hubC).normalize();
      const a = hubC.clone().addScaledVector(dir, hub.radius * 0.95);
      const b = c.clone().addScaledVector(dir, -g.radius * 1.08);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a.clone().setY(0.5), b.clone().setY(0.5)]), laneMat);
      line.computeLineDistances();
      this.group.add(line);
      const gate = jumpGate(new THREE.Color(g.color));
      gate.obj.position.copy(b);
      gate.obj.lookAt(hubC.x, 0, hubC.z);
      this.group.add(gate.obj);
      this.ticks.push(gate.tick);
      // tráfico de ida y vuelta por la ruta, cada sentido por su carril
      const side = new THREE.Vector3(-dir.z, 0, dir.x);
      for (let i = 0; i < 3; i++) {
        const fwdLane = i % 2 === 0;
        const off = side.clone().multiplyScalar(fwdLane ? 5 : -5);
        const p = a.clone().add(off).setY(7), q = b.clone().add(off).setY(7);
        this.ships.push({ a: fwdLane ? p : q, b: fwdLane ? q : p, u: hash(g.id, i), speed: 45 + hash(g.id, i + 7) * 30, arc: 0, scale: 1.7 + hash(g.id, i + 3) * 0.8 });
      }
    }

    // lanzaderas entre los nodos de cada galaxia (o puntos de su disco si no tiene nodos)
    for (const g of galaxies) {
      const pts = nodes.filter(n => n.galaxy === g.id).map(n => { const [x, z] = nodeWorldPos(n); return new THREE.Vector3(x, 6, z); });
      if (pts.length < 2) {
        for (let i = 0; i < 5; i++) {
          const a = hash(g.id, 40 + i) * Math.PI * 2, r = g.radius * (0.3 + hash(g.id, 50 + i) * 0.5);
          pts.push(new THREE.Vector3(g.center[0] + Math.cos(a) * r, 6, g.center[1] + Math.sin(a) * r));
        }
      }
      for (let i = 0; i < 3; i++) {
        const a = pts[i % pts.length], b = pts[(i * 2 + 1) % pts.length];
        this.ships.push({ a, b, u: hash(g.id, 60 + i), speed: 22 + hash(g.id, 70 + i) * 16, arc: 10 + hash(g.id, 80 + i) * 10, scale: 1.1 + hash(g.id, 90 + i) * 0.5, pool: pts });
      }
    }

    const geo = trafficGeometry();
    const n = this.ships.length;
    this.hull = new THREE.InstancedMesh(geo.hull, new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.5, roughness: 0.45 }), n);
    this.engines = new THREE.InstancedMesh(geo.engine, new THREE.MeshBasicMaterial({ color: 0xffffff }), n);
    const tints = ['#d8dde8', '#c9b48a', '#a9c6e8', '#e8c9c9', '#bfe8d0'];
    const col = new THREE.Color();
    for (let i = 0; i < n; i++) {
      this.hull.setColorAt(i, col.set(tints[i % tints.length]));
      this.engines.setColorAt(i, i % 3 ? col.setRGB(0.6, 1.8, 2.6) : col.setRGB(2.6, 1.2, 0.4));
    }
    this.hull.frustumCulled = this.engines.frustumCulled = false;
    this.group.add(this.hull, this.engines);

    // planetas decorativos bajo el plano (dan profundidad) y cinturones de asteroides
    galaxies.forEach((g, i) => {
      const r = 16 + hash(g.id, 5) * 16;
      const p = buildPlanet(i + 2, r);
      p.ring.visible = false;
      const a = hash(g.id, 6) * Math.PI * 2, d = g.radius * (0.7 + hash(g.id, 8) * 0.25);
      p.group.position.set(g.center[0] + Math.cos(a) * d, -55 - hash(g.id, 9) * 30, g.center[1] + Math.sin(a) * d);
      p.group.rotation.z = (hash(g.id, 10) - 0.5) * 0.6;
      this.group.add(p.group);
      const mat = p.material;
      this.ticks.push(t => { if (mat.uniforms.uTime) mat.uniforms.uTime.value = t; p.group.rotation.y = t * 0.03; });
    });
    this.buildBelts(galaxies.filter(g => ['defi', 'soroban', 'frontera', 'juegos', 'rwa'].includes(g.id)));
  }

  private buildBelts(gs: Galaxy[]) {
    const per = 260;
    const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0.1, flatShading: true }), per * gs.length);
    const col = new THREE.Color();
    let k = 0;
    for (const g of gs) {
      for (let i = 0; i < per; i++) {
        const a = (i / per) * Math.PI * 2 + hash(g.id, i) * 0.05;
        const r = g.radius * 1.02 + (hash(g.id, i + 1000) - 0.5) * 22;
        this.v.set(g.center[0] + Math.cos(a) * r, (hash(g.id, i + 2000) - 0.5) * 6 - 4, g.center[1] + Math.sin(a) * r);
        this.q.setFromEuler(new THREE.Euler(hash(g.id, i + 3000) * 6, hash(g.id, i + 4000) * 6, 0));
        const s = 0.5 + Math.pow(hash(g.id, i + 5000), 3) * 3;
        this.sc.set(s, s * (0.6 + hash(g.id, i + 6000) * 0.5), s);
        this.m.compose(this.v, this.q, this.sc);
        rocks.setMatrixAt(k, this.m);
        const shade = 0.35 + hash(g.id, i + 7000) * 0.35;
        rocks.setColorAt(k, hash(g.id, i + 8000) > 0.85 ? col.setRGB(shade * 1.6, shade * 1.25, shade * 0.6) : col.setRGB(shade, shade * 0.95, shade * 1.05));
        k++;
      }
    }
    rocks.instanceMatrix.needsUpdate = true;
    this.group.add(rocks);
  }

  update(dt: number, t: number) {
    for (const f of this.ticks) f(t);
    const up = 1;
    this.ships.forEach((s, i) => {
      const len = Math.max(1, s.a.distanceTo(s.b));
      s.u += (s.speed * dt) / len;
      if (s.u >= 1) {
        s.u = 0;
        const from = s.b;
        if (s.pool) {
          // siguiente destino: otro nodo de la galaxia
          let next = s.pool[Math.floor(Math.random() * s.pool.length)];
          if (next === from) next = s.pool[(s.pool.indexOf(from) + 1) % s.pool.length];
          s.a = from; s.b = next;
        } else {
          s.b = s.a; s.a = from;
        }
      }
      const u = s.u;
      this.v.lerpVectors(s.a, s.b, u);
      this.v.y += Math.sin(Math.PI * u) * s.arc * up;
      this.tan.subVectors(s.b, s.a);
      this.tan.y += Math.cos(Math.PI * u) * Math.PI * s.arc;
      this.q.setFromUnitVectors(this.fwd, this.tan.normalize());
      this.sc.setScalar(s.scale);
      this.m.compose(this.v, this.q, this.sc);
      this.hull.setMatrixAt(i, this.m);
      // las toberas laten un poco
      this.sc.setScalar(s.scale * (0.9 + Math.sin(t * 14 + i) * 0.1));
      this.m.compose(this.v, this.q, this.sc);
      this.engines.setMatrixAt(i, this.m);
    });
    this.hull.instanceMatrix.needsUpdate = true;
    this.engines.instanceMatrix.needsUpdate = true;
  }
}

/** estela de la nave del jugador: puntos que se desvanecen */
export class Trail {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private n = 40;
  private acc = 0;
  constructor() {
    this.pos = new Float32Array(this.n * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    const fade = new Float32Array(this.n);
    for (let i = 0; i < this.n; i++) fade[i] = 1 - i / this.n;
    geo.setAttribute('aFade', new THREE.BufferAttribute(fade, 1));
    this.points = new THREE.Points(geo, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute float aFade; varying float vF;
        void main(){ vF = aFade; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = (2.0 + 9.0 * aFade) * 260.0 / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vF;
        void main(){ float r = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, r) * vF * vF; gl_FragColor = vec4(vec3(0.5, 1.6, 2.4) * a, a); }`,
    }));
    this.points.frustumCulled = false;
  }
  reset(p: THREE.Vector3) { for (let i = 0; i < this.n; i++) this.pos.set([p.x, p.y, p.z], i * 3); }
  update(dt: number, p: THREE.Vector3, speed: number) {
    this.acc += dt;
    if (this.acc < 1 / 45) return;
    this.acc = 0;
    this.pos.copyWithin(3, 0, (this.n - 1) * 3);
    this.pos.set([p.x, p.y, p.z], 0);
    (this.points.material as THREE.ShaderMaterial).visible = speed > 6;
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

/** halo titilante de los proyectos del atlas: una nube de puntos con tamaño y color por astro */
export function starGlow(stars: { x: number; z: number; size: number }[], colors: THREE.Color[]): { points: THREE.Points; tick(t: number): void } {
  const n = stars.length;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n), phase = new Float32Array(n);
  stars.forEach((s, i) => {
    pos.set([s.x, 0, s.z], i * 3);
    col.set([colors[i].r, colors[i].g, colors[i].b], i * 3);
    size[i] = s.size * 4.2;
    phase[i] = (i * 2.399) % (Math.PI * 2);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uScale: { value: 700 } },
    vertexShader: `attribute vec3 aColor; attribute float aSize; attribute float aPhase; uniform float uTime; uniform float uScale;
      varying vec3 vC; varying float vT;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vT = 0.7 + 0.3 * sin(uTime * 1.6 + aPhase);
        gl_PointSize = aSize * uScale * (0.85 + 0.15 * vT) / -mv.z; vC = aColor; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec3 vC; varying float vT;
      void main(){ float r = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, r); a = a * a * 0.4 * vT; gl_FragColor = vec4(vC * a, a); }`,
  });
  const points = new THREE.Points(geo, mat);
  return { points, tick: t => { mat.uniforms.uTime.value = t; } };
}
