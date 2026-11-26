// Diorama del menú de entrada: la estación del DEX en primer plano, el bazar, el puerto, el observatorio y
// una ciudadela alrededor, una puerta de salto, planetas con atmósfera, un cinturón de asteroides y naves
// en órbita. La cámara gira despacio y el encuadre se corre a la derecha para dejar sitio al menú.
import * as THREE from 'three';
import type { SpaceScene } from '../render/scene';
import { buildPlanet } from '../render/models';
import { NODES, galaxyOf } from './ecosystem';
import { buildStructure, jumpGate, trafficGeometry } from './spacecraft';

interface Orbit { r: number; y: number; speed: number; phase: number; tilt: number; scale: number }

function glowSprite(color: string, size: number, opacity: number): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.3, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
  s.scale.setScalar(size);
  return s;
}

export class LobbyScene {
  readonly group = new THREE.Group();
  private ticks: ((t: number) => void)[] = [];
  private orbits: Orbit[] = [];
  private hull: THREE.InstancedMesh;
  private engines: THREE.InstancedMesh;
  private t = 0;
  private viewW = 0;
  private viewH = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private sc = new THREE.Vector3();

  constructor(private space: SpaceScene) {
    const place = (id: string, x: number, z: number, s: number) => {
      const n = NODES.find(x => x.id === id);
      if (!n) return;
      const st = buildStructure(n, galaxyOf(n.galaxy).color);
      st.obj.position.set(x, 0, z);
      st.obj.scale.setScalar(s);
      this.group.add(st.obj);
      this.ticks.push(st.tick);
    };
    place('sdex', 0, 0, 2.6);
    place('armory', -105, 70, 1.7);
    place('puerto', 125, 55, 1.6);
    place('observatorio', -95, -95, 1.6);
    place('f-umbral', 105, -105, 1.5);

    const gate = jumpGate(new THREE.Color('#fdda24'));
    gate.obj.position.set(-10, 0, -230);
    gate.obj.scale.setScalar(2.2);
    gate.obj.lookAt(0, 0, 0);
    this.group.add(gate.obj);
    this.ticks.push(gate.tick);

    // planetas con atmósfera, uno grande detrás y otro pequeño a un lado
    const big = buildPlanet(1, 90);
    big.ring.visible = false;
    big.group.position.set(-330, -70, -260);
    this.group.add(big.group);
    const small = buildPlanet(4, 34);
    small.ring.visible = false;
    small.group.position.set(320, -30, -200);
    this.group.add(small.group);
    this.ticks.push(t => { big.group.rotation.y = t * 0.02; small.group.rotation.y = -t * 0.04; });

    // nebulosa local: manchas de luz dorada y violeta detrás de la estación
    const neb = [['#8b5cff', -60, -160, 520, 0.22], ['#fdda24', 140, -120, 360, 0.1], ['#2ee6ff', -200, 80, 380, 0.08]] as const;
    for (const [c, x, z, s, o] of neb) {
      const sp = glowSprite(c, s, o);
      sp.position.set(x, -60, z);
      this.group.add(sp);
    }

    // cinturón de asteroides
    const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0),
      new THREE.MeshStandardMaterial({ color: 0x8a8580, roughness: 0.9, flatShading: true }), 420);
    for (let i = 0; i < 420; i++) {
      const a = (i / 420) * Math.PI * 2 + Math.sin(i * 12.9) * 0.05;
      const r = 300 + Math.sin(i * 7.7) * 26;
      this.v.set(Math.cos(a) * r, Math.sin(i * 3.1) * 8 - 10, Math.sin(a) * r);
      this.q.setFromEuler(new THREE.Euler(i, i * 0.7, 0));
      const s = 0.8 + Math.pow(Math.abs(Math.sin(i * 5.3)), 4) * 4;
      this.sc.set(s, s * 0.7, s);
      this.m.compose(this.v, this.q, this.sc);
      rocks.setMatrixAt(i, this.m);
    }
    this.group.add(rocks);

    // naves en órbita alrededor de la estación
    const geo = trafficGeometry();
    for (let i = 0; i < 16; i++) {
      this.orbits.push({ r: 70 + (i % 5) * 32 + Math.sin(i) * 8, y: 8 + (i % 4) * 9, speed: (0.12 + (i % 3) * 0.05) * (i % 2 ? 1 : -1), phase: i * 1.7, tilt: Math.sin(i * 2.3) * 0.18, scale: 2 + (i % 3) * 0.6 });
    }
    this.hull = new THREE.InstancedMesh(geo.hull, new THREE.MeshStandardMaterial({ color: 0xdfe3ec, metalness: 0.5, roughness: 0.45 }), this.orbits.length);
    this.engines = new THREE.InstancedMesh(geo.engine, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 1.8, 2.6) }), this.orbits.length);
    this.hull.frustumCulled = this.engines.frustumCulled = false;
    this.group.add(this.hull, this.engines);

    space.scene.add(this.group);
    // cámara de cine: más baja, más lejos y girando alrededor de la estación
    space.rig.lookAt(0, 0);
    space.rig.rotate(0, -0.4);
    space.rig.zoom(1.75);
  }

  update(dt: number) {
    this.t += dt;
    const t = this.t;
    for (const f of this.ticks) f(t);
    const up = new THREE.Vector3(0, 1, 0);
    this.orbits.forEach((o, i) => {
      const a = o.phase + t * o.speed;
      this.v.set(Math.cos(a) * o.r, o.y + Math.sin(a * 2) * o.r * o.tilt * 0.3, Math.sin(a) * o.r);
      // tangente de la órbita: hacia dónde mira la nave
      const dir = new THREE.Vector3(-Math.sin(a) * Math.sign(o.speed), 0, Math.cos(a) * Math.sign(o.speed));
      this.q.setFromRotationMatrix(this.m.lookAt(new THREE.Vector3(), dir.negate(), up));
      this.sc.setScalar(o.scale);
      this.m.compose(this.v, this.q, this.sc);
      this.hull.setMatrixAt(i, this.m);
      this.engines.setMatrixAt(i, this.m);
    });
    this.hull.instanceMatrix.needsUpdate = true;
    this.engines.instanceMatrix.needsUpdate = true;
    this.space.rig.rotate(dt * 0.035, 0);

    // en pantallas anchas el encuadre se corre a la derecha para dejar el menú a la izquierda
    const el = this.space.renderer.domElement;
    const w = el.clientWidth, h = el.clientHeight;
    if (w !== this.viewW || h !== this.viewH) {
      this.viewW = w; this.viewH = h;
      if (w > 900) this.space.camera.setViewOffset(w, h, -w * 0.2, 0, w, h);
      else this.space.camera.clearViewOffset();
    }
  }

  dispose() {
    this.space.scene.remove(this.group);
    this.group.traverse(o => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach(x => x.dispose()); else mat?.dispose();
    });
    this.space.camera.clearViewOffset();
    this.space.rig.rotate(0, 0.4);
    this.space.rig.zoom(1 / 1.75);
  }
}
