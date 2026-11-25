// Modelos procedurales: todo se arma con primitivas de Three.js, sin archivos externos.
import * as THREE from 'three';
import type { AsteroidKind, ModuleType, Owner, UnitType } from '../sim/types';

export const SIDE_COLORS: Record<Owner, THREE.Color> = {
  0: new THREE.Color('#2ee6ff'),
  1: new THREE.Color('#ff3d8b'),
  [-1]: new THREE.Color('#9aa3c7'),
} as Record<Owner, THREE.Color>;

export interface Spin { obj: THREE.Object3D; axis: 'x' | 'y' | 'z'; speed: number }

interface Mats {
  hull: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  trim: THREE.MeshStandardMaterial;
  glow: THREE.MeshBasicMaterial;
  glass: THREE.MeshStandardMaterial;
  panel: THREE.MeshStandardMaterial;
  deck: THREE.MeshStandardMaterial;
  windows: THREE.MeshBasicMaterial;
  furnace: THREE.MeshBasicMaterial;
  portal: THREE.MeshBasicMaterial;
}

const matCache = new Map<Owner, Mats>();
export function mats(side: Owner): Mats {
  let m = matCache.get(side);
  if (m) return m;
  const c = SIDE_COLORS[side];
  m = {
    hull: new THREE.MeshStandardMaterial({ color: 0xdfe3ec, metalness: 0.3, roughness: 0.55 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1b1f2e, metalness: 0.7, roughness: 0.4 }),
    trim: new THREE.MeshStandardMaterial({ color: c, metalness: 0.4, roughness: 0.3, emissive: c, emissiveIntensity: 0.15 }),
    // color > 1 para que el bloom lo haga brillar
    glow: new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(1.15) }),
    glass: new THREE.MeshStandardMaterial({ color: 0x7fd8ff, metalness: 0.1, roughness: 0.05, emissive: 0x2a6aff, emissiveIntensity: 0.6, transparent: true, opacity: 0.85 }),
    panel: new THREE.MeshStandardMaterial({ color: 0x14204a, metalness: 0.6, roughness: 0.35, emissive: 0x0b1f6b, emissiveIntensity: 0.5 }),
    deck: new THREE.MeshStandardMaterial({ color: 0x2a3042, metalness: 0.4, roughness: 0.7 }),
    windows: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.95, 0.85, 0.6) }),
    furnace: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.9, 0.25) }),
    portal: new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(1.3), transparent: true, opacity: 0.55, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
  };
  matCache.set(side, m);
  return m;
}

const box = (w: number, h: number, d: number, m: THREE.Material) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
const cyl = (rt: number, rb: number, h: number, m: THREE.Material, seg = 16) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
const sphere = (r: number, m: THREE.Material, w = 24, h = 16) => new THREE.Mesh(new THREE.SphereGeometry(r, w, h), m);
const torus = (r: number, t: number, m: THREE.Material, seg = 48) => new THREE.Mesh(new THREE.TorusGeometry(r, t, 10, seg), m);

function at<T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T { o.position.set(x, y, z); return o; }
function flat<T extends THREE.Object3D>(o: T): T { o.rotation.x = Math.PI / 2; return o; }

// base hexagonal oscura con borde luminoso fino y luces en las esquinas: muestra la grilla sin tapar el módulo
function hexBase(m: Mats, r: number): THREE.Group {
  const g = new THREE.Group();
  const plate = cyl(r, r * 1.06, 1.2, m.dark, 6);
  plate.rotation.y = Math.PI / 6;
  g.add(at(plate, 0, 0.6, 0));
  const deck = cyl(r * 0.82, r * 0.82, 0.2, m.deck, 6);
  deck.rotation.y = Math.PI / 6;
  g.add(at(deck, 0, 1.25, 0));
  const side = r; // lado de un hexágono regular = radio
  for (let i = 0; i < 6; i++) {
    const a0 = (i / 6) * Math.PI * 2, a1 = ((i + 1) / 6) * Math.PI * 2;
    const mx = (Math.cos(a0) + Math.cos(a1)) / 2 * r * 0.99, mz = (Math.sin(a0) + Math.sin(a1)) / 2 * r * 0.99;
    const edge = box(side * 0.92, 0.22, 0.32, m.trim);
    edge.position.set(mx, 1.25, mz);
    edge.rotation.y = -Math.atan2(mz, mx) + Math.PI / 2;
    g.add(edge);
    g.add(at(sphere(0.32, m.glow, 8, 6), Math.cos(a0) * r, 1.35, Math.sin(a0) * r));
  }
  return g;
}

// el logo de Stellar: un anillo con dos barras paralelas que lo cruzan en diagonal
function stellarEmblem(m: Mats, r: number): THREE.Group {
  const g = new THREE.Group();
  g.add(torus(r, r * 0.09, m.glow, 48));
  for (const dy of [-0.22, 0.22]) {
    const bar = box(r * 2.7, r * 0.13, r * 0.13, m.glow);
    bar.position.y = dy * r;
    g.add(bar);
  }
  g.rotation.z = -0.3;
  return g;
}

export interface ModuleModel { group: THREE.Group; spins: Spin[]; tick?: (t: number) => void }

export function buildModule(type: ModuleType, side: Owner): ModuleModel {
  const m = mats(side);
  const g = new THREE.Group();
  const spins: Spin[] = [];
  let tick: ((t: number) => void) | undefined;
  switch (type) {
    case 'core': {
      g.add(hexBase(m, 9));
      // torre escalonada: tambor oscuro, anillo de ventanas, cuerpo blanco y esfera
      g.add(at(cyl(6.2, 7, 2.4, m.dark, 24), 0, 2.4, 0));
      g.add(at(cyl(5.2, 6, 1, m.windows, 24), 0, 4.1, 0));
      g.add(at(cyl(4.2, 5.2, 4, m.hull, 24), 0, 6.6, 0));
      g.add(at(sphere(4.2, m.hull), 0, 10.4, 0));
      g.add(flat(at(torus(4.25, 0.18, m.trim, 40), 0, 10.4, 0)));
      // brazos de atraque con balizas
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.5;
        const arm = box(7, 0.8, 1, m.hull);
        arm.position.set(Math.cos(a) * 7, 4.6, Math.sin(a) * 7);
        arm.rotation.y = -a;
        g.add(arm);
        g.add(at(sphere(0.55, m.glow, 8, 6), Math.cos(a) * 10.4, 4.6, Math.sin(a) * 10.4));
      }
      // logo de Stellar flotando y girando sobre el núcleo
      const emblemPivot = at(new THREE.Group(), 0, 19, 0);
      emblemPivot.add(stellarEmblem(m, 4));
      g.add(emblemPivot);
      spins.push({ obj: emblemPivot, axis: 'y', speed: 0.6 });
      g.add(at(cyl(0.25, 0.25, 4, m.hull, 6), 0, 15.5, 0));
      break;
    }
    case 'habitat': {
      g.add(hexBase(m, 7));
      // torre residencial de tres pisos con franjas de ventanas encendidas
      for (let i = 0; i < 3; i++) {
        g.add(at(cyl(3.6 - i * 0.4, 3.8 - i * 0.4, 2.2, m.hull, 20), 0, 2.6 + i * 2.8, 0));
        g.add(at(cyl(3.65 - i * 0.4, 3.65 - i * 0.4, 0.5, m.windows, 20), 0, 3.9 + i * 2.8, 0));
      }
      const dome = new THREE.Mesh(new THREE.SphereGeometry(2.6, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), m.glass);
      g.add(at(dome, 0, 10.6, 0));
      // pequeña rueda de gravedad en la cima
      const wheel = at(new THREE.Group(), 0, 11.5, 0);
      const ring = torus(4.2, 0.35, m.hull, 32);
      ring.rotation.x = Math.PI / 2;
      wheel.add(ring);
      for (let i = 0; i < 3; i++) {
        const spoke = box(8.4, 0.18, 0.18, m.trim);
        spoke.rotation.y = (i * Math.PI) / 3;
        wheel.add(spoke);
      }
      g.add(wheel);
      spins.push({ obj: wheel, axis: 'y', speed: 0.5 });
      break;
    }
    case 'solar': {
      g.add(hexBase(m, 6.5));
      g.add(at(cyl(1.4, 1.8, 2, m.dark, 8), 0, 2.2, 0));
      g.add(at(cyl(0.45, 0.45, 6, m.hull, 8), 0, 6, 0));
      // cuatro alas en cruz que siguen al sol
      const pivot = at(new THREE.Group(), 0, 9, 0);
      for (let w = 0; w < 4; w++) {
        const wing = new THREE.Group();
        wing.rotation.y = (w * Math.PI) / 2 + Math.PI / 4;
        for (let i = 0; i < 3; i++) wing.add(at(box(2.4, 0.14, 3.2, m.panel), 2 + i * 2.6, 0, 0));
        wing.add(at(box(8, 0.2, 0.25, m.hull), 4.6, 0.1, 0));
        pivot.add(wing);
      }
      pivot.rotation.x = -0.25;
      g.add(pivot);
      spins.push({ obj: pivot, axis: 'y', speed: 0.1 });
      g.add(at(sphere(0.8, m.glow, 10, 8), 0, 9.4, 0));
      break;
    }
    case 'anchor': {
      g.add(hexBase(m, 7));
      // puerta de anclaje: un portal vertical con disco de energía girando, como un puente entre redes
      g.add(at(box(2, 3, 9, m.dark), 0, 2.6, 0));
      const gate = at(new THREE.Group(), 0, 9.5, 0);
      gate.add(torus(5, 0.7, m.hull, 40));
      gate.add(torus(5.05, 0.25, m.trim, 40));
      const disc = new THREE.Mesh(new THREE.CircleGeometry(4.3, 40), m.portal);
      gate.add(disc);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        gate.add(at(box(0.6, 0.6, 1.8, m.dark), Math.cos(a) * 5.4, Math.sin(a) * 5.4, 0));
      }
      g.add(gate);
      spins.push({ obj: disc, axis: 'z', speed: 1.5 });
      tick = t => { gate.rotation.y = Math.sin(t * 0.3) * 0.6; (m.portal as THREE.MeshBasicMaterial).opacity = 0.45 + 0.2 * Math.sin(t * 3); };
      break;
    }
    case 'hangar': {
      g.add(hexBase(m, 8));
      // casco alargado con bahía abierta, pista iluminada y torre de control
      g.add(at(box(13, 1, 9, m.dark), 0, 1.9, 0));
      for (const z of [-4, 4]) g.add(at(box(13, 4.5, 1, m.hull), 0, 4.6, z));
      g.add(at(box(13, 0.8, 9.6, m.hull), -1.5, 7.2, 0));
      for (let i = 0; i < 6; i++) g.add(at(box(0.9, 0.12, 0.5, m.glow), -5.5 + i * 2.2, 2.45, 0));
      g.add(at(cyl(0.9, 1.1, 5, m.hull, 10), -5, 10, -3));
      g.add(at(cyl(1.8, 1.4, 1.6, m.glass, 10), -5, 13.2, -3));
      const radar = at(new THREE.Group(), -5, 14.4, -3);
      const dish = new THREE.Mesh(new THREE.SphereGeometry(1.4, 12, 6, 0, Math.PI * 2, 0, Math.PI / 3), m.hull);
      dish.rotation.x = Math.PI / 2.3;
      radar.add(dish);
      g.add(radar);
      spins.push({ obj: radar, axis: 'y', speed: 1.2 });
      break;
    }
    case 'factory': {
      g.add(hexBase(m, 8));
      // bloque industrial con horno encendido, pórtico de grúa y brazos robóticos
      g.add(at(box(9, 5.5, 7, m.dark), -0.5, 4, 0));
      g.add(at(box(6, 1.6, 0.3, m.furnace), -0.5, 3.6, 3.6));
      g.add(at(box(9.4, 0.6, 7.4, m.trim), -0.5, 7, 0));
      for (const x of [-4, 3]) g.add(at(cyl(0.9, 1.2, 8, m.hull, 8), x, 9, -2.5));
      for (const x of [-4, 3]) g.add(at(cyl(0.95, 0.95, 0.5, m.furnace, 8), x, 13.1, -2.5));
      for (const x of [-6.5, 5.5]) g.add(at(box(0.6, 12, 0.6, m.hull), x, 7, 3.5));
      g.add(at(box(12.6, 0.7, 0.7, m.hull), -0.5, 13, 3.5));
      const arms: THREE.Group[] = [];
      for (const x of [-2.5, 2]) {
        const arm = at(new THREE.Group(), x, 7.5, 2.5);
        const seg = at(box(0.6, 0.6, 4, m.hull), 0, 0, 1.6);
        seg.rotation.x = 0.5;
        arm.add(seg);
        arm.add(at(sphere(0.5, m.furnace, 8, 6), 0, -1, 3.4));
        g.add(arm);
        arms.push(arm);
      }
      tick = t => arms.forEach((a, i) => { a.rotation.y = Math.sin(t * 1.4 + i * 2) * 0.7; });
      break;
    }
    case 'lab': {
      g.add(hexBase(m, 7));
      const dome = new THREE.Mesh(new THREE.SphereGeometry(4.2, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), m.glass);
      g.add(at(dome, -1.2, 1.4, 1));
      g.add(at(sphere(1.2, m.glow, 12, 8), -1.2, 3, 1));
      // un soroban (ábaco japonés) gigante: varillas con cuentas que se deslizan calculando
      const abacus = at(new THREE.Group(), 2.2, 6.5, -2.6);
      abacus.rotation.y = -0.5;
      for (const y of [-3, 3]) abacus.add(at(box(8, 0.5, 0.5, m.hull), 0, y, 0));
      for (const x of [-4, 4]) abacus.add(at(box(0.5, 6.5, 0.5, m.hull), x, 0, 0));
      abacus.add(at(box(8, 0.25, 0.3, m.trim), 0, 1.4, 0));
      const beads: THREE.Mesh[] = [];
      for (let i = 0; i < 5; i++) {
        const x = -3 + i * 1.5;
        abacus.add(at(cyl(0.08, 0.08, 6, m.hull, 4), x, 0, 0));
        for (let j = 0; j < 3; j++) {
          const bead = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 6), j === 0 ? m.glow : m.trim);
          bead.scale.y = 0.6;
          bead.position.set(x, -2.2 + j * 0.7, 0);
          bead.userData.base = bead.position.y;
          bead.userData.phase = i * 1.3 + j * 0.4;
          abacus.add(bead);
          beads.push(bead);
        }
      }
      g.add(at(box(1, 6.5, 1, m.dark), 2.2, 3.2, -2.6));
      g.add(abacus);
      tick = t => beads.forEach(b => {
        const k = Math.max(0, Math.sin(t * 1.2 + b.userData.phase));
        b.position.y = b.userData.base + k * 1.6;
      });
      break;
    }
    case 'turret': {
      g.add(hexBase(m, 6));
      g.add(at(cyl(3, 3.8, 3, m.dark, 12), 0, 3, 0));
      g.add(flat(at(torus(3.1, 0.2, m.trim, 24), 0, 4.5, 0)));
      const head = at(new THREE.Group(), 0, 6, 0);
      head.add(sphere(2.6, m.hull));
      for (const x of [-1, 1]) {
        const barrel = cyl(0.35, 0.35, 6, m.dark, 8);
        barrel.rotation.x = Math.PI / 2;
        head.add(at(barrel, x * 1.1, 0.4, 3.4));
        head.add(at(sphere(0.4, m.glow), x * 1.1, 0.4, 6.4));
      }
      g.add(head);
      tick = t => { head.rotation.y = Math.sin(t * 0.5) * 1.2; };
      break;
    }
    case 'beacon': {
      g.add(hexBase(m, 9));
      g.add(at(cyl(1.5, 4, 26, m.hull, 8), 0, 14, 0));
      g.add(at(cyl(1.55, 1.55, 18, m.windows, 8), 0, 16, 0));
      const top = at(new THREE.Group(), 0, 31, 0);
      top.add(stellarEmblem(m, 4.5));
      g.add(top);
      spins.push({ obj: top, axis: 'y', speed: 0.8 });
      for (let i = 0; i < 3; i++) {
        const pivot = at(new THREE.Group(), 0, 8 + i * 6, 0);
        const r = torus(6.5 - i * 1.4, 0.35, m.trim, 48);
        r.rotation.x = Math.PI / 2 + (i - 1) * 0.3;
        pivot.add(r);
        g.add(pivot);
        spins.push({ obj: pivot, axis: 'y', speed: (i % 2 ? -1 : 1) * (0.6 + i * 0.3) });
      }
      break;
    }
  }
  return { group: g, spins, tick };
}

export function buildUnit(type: UnitType, side: Owner): { group: THREE.Group; spins: Spin[]; engines: THREE.Object3D[] } {
  const m = mats(side);
  const g = new THREE.Group();
  const spins: Spin[] = [];
  const engines: THREE.Object3D[] = [];
  // los modelos miran hacia +z
  switch (type) {
    case 'drone': {
      const body = new THREE.Mesh(new THREE.OctahedronGeometry(1.3, 0), m.hull);
      body.scale.set(1, 0.7, 1.2);
      g.add(body);
      const ring = torus(1.9, 0.18, m.trim, 24);
      ring.rotation.x = Math.PI / 2;
      g.add(ring);
      g.add(at(sphere(0.45, m.glow, 10, 8), 0, 0, 1.4));
      const claw = at(box(0.3, 0.3, 1.2, m.dark), 0, -0.6, 1.2);
      g.add(claw);
      spins.push({ obj: ring, axis: 'z', speed: 3 });
      break;
    }
    case 'interceptor': {
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.9, 4.5, 6), m.hull);
      nose.rotation.x = Math.PI / 2;
      g.add(nose);
      const wings = box(5.2, 0.2, 1.6, m.trim);
      g.add(at(wings, 0, 0, -0.8));
      for (const x of [-2.4, 2.4]) g.add(at(box(0.25, 1.4, 1.4, m.hull), x, 0.4, -1));
      g.add(at(sphere(0.5, m.glass, 10, 8), 0, 0.5, 0.4));
      const eng = at(sphere(0.55, m.glow, 10, 8), 0, 0, -2.3);
      g.add(eng);
      engines.push(eng);
      break;
    }
    case 'frigate': {
      g.add(at(box(2.6, 1.8, 8, m.hull), 0, 0, 0));
      const prow = new THREE.Mesh(new THREE.ConeGeometry(1.5, 3, 4), m.hull);
      prow.rotation.x = Math.PI / 2;
      prow.rotation.z = Math.PI / 4;
      g.add(at(prow, 0, 0, 5.4));
      g.add(at(box(6.5, 0.4, 2.4, m.trim), 0, 0, -1.6));
      g.add(at(box(1.4, 1.2, 2.4, m.dark), 0, 1.4, 0.5));
      const cannon = cyl(0.3, 0.3, 4, m.dark, 8);
      cannon.rotation.x = Math.PI / 2;
      g.add(at(cannon, 0, 1.6, 2.6));
      for (const x of [-0.8, 0.8]) {
        const eng = at(sphere(0.6, m.glow, 10, 8), x, 0, -4.2);
        g.add(eng);
        engines.push(eng);
      }
      break;
    }
    case 'dreadnought': {
      g.add(at(box(5, 3, 16, m.hull), 0, 0, 0));
      const prow = new THREE.Mesh(new THREE.ConeGeometry(2.8, 6, 4), m.hull);
      prow.rotation.x = Math.PI / 2;
      prow.rotation.z = Math.PI / 4;
      g.add(at(prow, 0, 0, 11));
      g.add(at(box(14, 0.8, 5, m.trim), 0, 0, -3));
      g.add(at(box(3, 3, 5, m.dark), 0, 2.8, -2));
      g.add(at(sphere(1, m.glass, 12, 8), 0, 4.4, -1));
      for (const z of [2, 5.5]) {
        const turret = at(new THREE.Group(), 0, 1.8, z);
        turret.add(cyl(1.1, 1.1, 0.8, m.dark, 10));
        const b = cyl(0.3, 0.3, 3.6, m.trim, 8);
        b.rotation.x = Math.PI / 2;
        turret.add(at(b, 0, 0.2, 1.8));
        g.add(turret);
      }
      // anillo de consenso alrededor del casco
      const ring = torus(5.2, 0.3, m.glow, 48);
      g.add(at(ring, 0, 0, -6));
      for (const x of [-1.5, 0, 1.5]) {
        const eng = at(sphere(0.9, m.glow, 10, 8), x, 0, -8.2);
        g.add(eng);
        engines.push(eng);
      }
      break;
    }
    case 'mecha': {
      // robot bípedo con botas magnéticas
      g.add(at(box(2.4, 2, 1.6, m.hull), 0, 2.4, 0));
      g.add(at(box(1.4, 0.9, 1.2, m.dark), 0, 3.9, 0.1));
      g.add(at(box(1, 0.25, 0.1, m.glow), 0, 3.95, 0.72));
      for (const x of [-0.7, 0.7]) {
        g.add(at(box(0.7, 1.8, 0.8, m.dark), x, 0.9, 0));
        g.add(at(box(0.9, 0.35, 1.3, m.trim), x, 0.1, 0.15));
      }
      for (const x of [-1.6, 1.6]) {
        g.add(at(box(0.6, 1.8, 0.7, m.hull), x, 2.2, 0.2));
        g.add(at(box(0.7, 0.7, 0.9, m.trim), x, 1.2, 0.5));
      }
      break;
    }
    case 'titan': {
      g.add(at(box(4.6, 3.8, 3, m.hull), 0, 4.6, 0));
      g.add(at(box(2.2, 1.6, 2, m.dark), 0, 7.2, 0.3));
      g.add(at(box(1.8, 0.4, 0.1, m.glow), 0, 7.3, 1.32));
      g.add(at(sphere(1, m.glow, 12, 8), 0, 4.8, 1.55));
      for (const x of [-1.3, 1.3]) {
        g.add(at(box(1.3, 3, 1.4, m.dark), x, 1.6, 0));
        g.add(at(box(1.6, 0.6, 2.2, m.trim), x, 0.2, 0.3));
      }
      for (const x of [-3, 3]) {
        g.add(at(box(1.3, 3.6, 1.4, m.hull), x, 4.4, 0.2));
        g.add(at(box(1.6, 1.6, 2.4, m.trim), x, 2.4, 0.8));
      }
      break;
    }
  }
  return { group: g, spins, engines };
}

// asteroides: icosaedros deformados y mate. Lumen: roca violeta oscura con cristales dorados.
// Metal: roca cobriza con vetas de hierro. Ningún color coincide con los de los equipos.
const ASTEROID_MATS = {
  lumenRock: new THREE.MeshStandardMaterial({ color: 0x2a2236, roughness: 1, metalness: 0, flatShading: true }),
  crystal: new THREE.MeshStandardMaterial({
    color: 0xffe680, emissive: new THREE.Color('#fdda24'), emissiveIntensity: 0.75, roughness: 0.7, metalness: 0, flatShading: true,
  }),
  metalRock: new THREE.MeshStandardMaterial({ color: 0x6a4a36, roughness: 1, metalness: 0, flatShading: true }),
  vein: new THREE.MeshStandardMaterial({ color: 0xb87a4b, roughness: 0.8, metalness: 0.15, flatShading: true }),
};

export function buildAsteroid(kind: AsteroidKind, radius: number, seed: number): THREE.Group {
  let st = seed * 9301 + 49297;
  const rnd = () => { st = (st * 16807) % 2147483647; return st / 2147483647; };
  const geo = new THREE.IcosahedronGeometry(radius, 1);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const k = 0.75 + rnd() * 0.45;
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.8, p.getZ(i) * k);
  }
  geo.computeVertexNormals();
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geo, kind === 'lumen' ? ASTEROID_MATS.lumenRock : ASTEROID_MATS.metalRock));
  if (kind === 'lumen') {
    for (let i = 0; i < 5; i++) {
      const c = new THREE.Mesh(new THREE.OctahedronGeometry(radius * (0.25 + rnd() * 0.25), 0), ASTEROID_MATS.crystal);
      c.scale.y = 2.4;
      const a = rnd() * Math.PI * 2, e = rnd() * 0.8;
      c.position.set(Math.cos(a) * radius * 0.55, radius * (0.3 + e * 0.4), Math.sin(a) * radius * 0.55);
      c.rotation.set(rnd() - 0.5, rnd() * 3, rnd() - 0.5);
      g.add(c);
    }
  } else {
    for (let i = 0; i < 4; i++) {
      const c = new THREE.Mesh(new THREE.DodecahedronGeometry(radius * (0.22 + rnd() * 0.15), 0), ASTEROID_MATS.vein);
      const a = rnd() * Math.PI * 2;
      c.position.set(Math.cos(a) * radius * 0.65, radius * (0.1 + rnd() * 0.4), Math.sin(a) * radius * 0.65);
      c.rotation.set(rnd(), rnd() * 3, rnd());
      g.add(c);
    }
  }
  g.rotation.set(rnd() * 0.6, rnd() * Math.PI * 2, rnd() * 0.6);
  return g;
}

const planetVert = /* glsl */ `
varying vec3 vN; varying vec3 vP; varying vec3 vW;
void main() {
  vN = normalize(normalMatrix * normal);
  vP = position;
  vW = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
}`;
const planetFrag = /* glsl */ `
varying vec3 vN; varying vec3 vP; varying vec3 vW;
uniform vec3 uA; uniform vec3 uB; uniform vec3 uOwner; uniform float uSeed; uniform float uTime; uniform vec3 uSun;
float hash(vec3 p) { p = fract(p * 0.3183099 + uSeed); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.1; a *= 0.5; } return v; }
void main() {
  vec3 p = normalize(vP);
  float bands = fbm(vec3(p.x * 2.0, p.y * 7.0 + fbm(p * 3.0 + uTime * 0.02) * 2.0, p.z * 2.0));
  vec3 col = mix(uA, uB, smoothstep(0.3, 0.75, bands));
  float light = max(dot(vN, normalize(uSun)), 0.0) * 0.9 + 0.12;
  col *= light;
  // ciudades del dueño en el lado nocturno
  float city = step(0.78, fbm(p * 18.0)) * (1.0 - smoothstep(0.0, 0.25, light));
  col += uOwner * city * 2.5;
  // borde atmosférico
  float rim = pow(1.0 - max(dot(vN, normalize(cameraPosition - vW)), 0.0), 3.0);
  col += mix(vec3(0.4, 0.6, 1.0), uOwner, 0.6) * rim * 1.2;
  gl_FragColor = vec4(col, 1.0);
}`;

const PLANET_PALETTES: [string, string][] = [
  ['#2c1f5e', '#c9a0ff'], ['#0f3b57', '#6fe3ff'], ['#5a3212', '#ffc46b'], ['#123d2a', '#8cff9e'], ['#4b1030', '#ff8fb8'],
];

export function buildPlanet(index: number, radius: number): { group: THREE.Group; material: THREE.ShaderMaterial; ring: THREE.Mesh } {
  const [a, b] = PLANET_PALETTES[index % PLANET_PALETTES.length];
  const material = new THREE.ShaderMaterial({
    vertexShader: planetVert, fragmentShader: planetFrag,
    uniforms: {
      uA: { value: new THREE.Color(a) }, uB: { value: new THREE.Color(b) }, uOwner: { value: new THREE.Color(0x222233) },
      uSeed: { value: 0.1 + index * 0.137 }, uTime: { value: 0 }, uSun: { value: new THREE.Vector3(-0.5, 0.7, 0.4) },
    },
  });
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 32), material));
  // anillo de captura: se tiñe del color del dueño y crece con el progreso
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius * 1.35, radius * 1.5, 96),
    new THREE.MeshBasicMaterial({ color: 0x9aa3c7, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2 + 0.25;
  g.add(ring);
  if (index % 2 === 0) {
    const belt = new THREE.Mesh(
      new THREE.RingGeometry(radius * 1.7, radius * 2.3, 96),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(b).multiplyScalar(0.7), transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }),
    );
    belt.rotation.x = -Math.PI / 2 + 0.25;
    g.add(belt);
  }
  return { group: g, material, ring };
}

// pasillo que une un módulo con el módulo al que se acopló
export function buildConnector(side: Owner, length: number): THREE.Group {
  const m = mats(side);
  const g = new THREE.Group();
  const tube = cyl(1.3, 1.3, length, m.hull, 10);
  tube.rotation.z = Math.PI / 2;
  g.add(at(tube, 0, 3, 0));
  for (const t of [-0.3, 0, 0.3]) {
    const collar = at(torus(1.5, 0.22, m.trim, 16), t * length, 3, 0);
    collar.rotation.y = Math.PI / 2;
    g.add(collar);
  }
  const light = cyl(0.25, 0.25, length * 0.9, m.glow, 6);
  light.rotation.z = Math.PI / 2;
  g.add(at(light, 0, 4.4, 0));
  return g;
}
