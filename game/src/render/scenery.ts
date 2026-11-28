// Escenografía de Stellar en el mapa de partida. Solo decora: la simulación no la ve ni choca con ella.
// - Un holograma del logo de Stellar bajo el planeta central.
// - Dos quórums de validadores (SCP) en las esquinas libres, que se enlazan con un destello en cada ledger.
// - Una ruta de path payments con boyas ancla y paquetes de luz que la recorren.
// - Satélites relé que orbitan el mapa y parpadean al cerrar cada ledger.
import * as THREE from 'three';

const GOLD = new THREE.Color('#fdda24');
const VIOLET = new THREE.Color('#8b5cff');
const CYAN = new THREE.Color('#2ee6ff');

const add = (o: THREE.Object3D, x: number, y: number, z: number) => { o.position.set(x, y, z); return o; };
const glowMat = (c: THREE.Color, k = 1.4, opacity = 1) => new THREE.MeshBasicMaterial({
  color: c.clone().multiplyScalar(k), transparent: opacity < 1, opacity, blending: opacity < 1 ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: opacity >= 1,
});

interface Packet { mesh: THREE.Mesh; t: number; speed: number; lane: THREE.CatmullRomCurve3 }

export class Scenery {
  readonly group = new THREE.Group();
  private emblem: THREE.Group;
  private emblemMat: THREE.MeshBasicMaterial;
  private quorumLinks: THREE.LineBasicMaterial[] = [];
  private nodes: THREE.Mesh[] = [];
  private packets: Packet[] = [];
  private sats: { obj: THREE.Group; light: THREE.MeshBasicMaterial; r: number; speed: number; phase: number; y: number }[] = [];
  private flash = 0;

  constructor(scene: THREE.Scene) {
    const hull = new THREE.MeshStandardMaterial({ color: 0xc9cfdc, metalness: 0.5, roughness: 0.4 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2c3244, metalness: 0.6, roughness: 0.4 });

    // holograma del logo bajo el planeta central: anillo y dos barras, muy tenue
    this.emblemMat = new THREE.MeshBasicMaterial({ color: GOLD.clone().multiplyScalar(0.9), transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.emblem = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(34, 37, 96), this.emblemMat);
    this.emblem.add(ring);
    for (const dy of [-8, 8]) {
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(98, 3), this.emblemMat);
      bar.position.y = dy;
      this.emblem.add(bar);
    }
    this.emblem.rotation.x = -Math.PI / 2;
    const tilt = new THREE.Group();
    tilt.add(this.emblem);
    tilt.position.y = -4;
    this.group.add(tilt);

    // quórums de validadores en las dos esquinas sin bases
    for (const [cx, cz] of [[-325, -325], [325, 325]]) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + (cx < 0 ? 0.3 : 1.3);
        const p = new THREE.Vector3(cx + Math.cos(a) * 26, -2, cz + Math.sin(a) * 26);
        pts.push(p);
        const node = new THREE.Group();
        node.add(add(new THREE.Mesh(new THREE.CylinderGeometry(3.2, 4, 2, 6), dark), 0, 0, 0));
        const gem = new THREE.Mesh(new THREE.OctahedronGeometry(2.4, 0), glowMat(VIOLET, 1.5));
        gem.scale.y = 1.6;
        node.add(add(gem, 0, 5, 0));
        this.nodes.push(gem);
        const band = new THREE.Mesh(new THREE.TorusGeometry(3.6, 0.25, 6, 24), glowMat(VIOLET, 1.2));
        band.rotation.x = Math.PI / 2;
        node.add(add(band, 0, 1.2, 0));
        add(node, p.x, p.y, p.z);
        node.scale.setScalar(1.7);
        this.group.add(node);
      }
      const mat = new THREE.LineBasicMaterial({ color: VIOLET.clone().multiplyScalar(1.3), transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false });
      const geo = new THREE.BufferGeometry().setFromPoints([...pts, pts[0]].map(p => p.clone().setY(6)));
      this.group.add(new THREE.Line(geo, mat));
      this.quorumLinks.push(mat);
    }

    // ruta de path payments: curva suave de esquina a esquina con boyas ancla
    const lane = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-370, -3, -225), new THREE.Vector3(-180, -3, -310), new THREE.Vector3(0, -3, -355),
      new THREE.Vector3(180, -3, -325), new THREE.Vector3(360, -3, -165),
    ]);
    const lane2 = new THREE.CatmullRomCurve3(lane.points.map(p => new THREE.Vector3(-p.x, p.y, -p.z)));
    for (const l of [lane, lane2]) {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(l.getPoints(80)),
        new THREE.LineDashedMaterial({ color: GOLD.clone().multiplyScalar(0.8), dashSize: 4, gapSize: 5, transparent: true, opacity: 0.35 }));
      line.computeLineDistances();
      this.group.add(line);
      for (let i = 0; i <= 4; i++) {
        const p = l.getPoint(i / 4);
        const buoy = new THREE.Group();
        buoy.add(new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.6, 3, 8), hull));
        buoy.add(add(new THREE.Mesh(new THREE.SphereGeometry(0.8, 10, 8), glowMat(GOLD, 1.6)), 0, 2.4, 0));
        const halo = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.15, 6, 24), glowMat(GOLD, 1.1));
        halo.rotation.x = Math.PI / 2;
        buoy.add(halo);
        add(buoy, p.x, p.y, p.z);
        buoy.scale.setScalar(1.8);
        this.group.add(buoy);
      }
      for (let i = 0; i < 6; i++) {
        const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(1.6, 0), glowMat(i % 2 ? CYAN : GOLD, 2));
        this.group.add(mesh);
        this.packets.push({ mesh, t: i / 6, speed: 0.025 + (i % 3) * 0.006, lane: l });
      }
    }

    // satélites relé en órbita alta alrededor del mapa
    for (let i = 0; i < 4; i++) {
      const sat = new THREE.Group();
      sat.scale.setScalar(1.6);
      sat.add(new THREE.Mesh(new THREE.BoxGeometry(2, 1.4, 2), hull));
      for (const x of [-3, 3]) sat.add(add(new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.1, 1.6), new THREE.MeshStandardMaterial({ color: 0x14204a, emissive: 0x0b1f6b, emissiveIntensity: 0.6, metalness: 0.6, roughness: 0.3 })), x, 0, 0));
      const light = glowMat(CYAN, 2);
      sat.add(add(new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), light), 0, 1, 0));
      this.group.add(sat);
      this.sats.push({ obj: sat, light, r: 420 + (i % 2) * 24, speed: 0.02 + i * 0.004, phase: i * 1.6, y: 18 + i * 4 });
    }

    scene.add(this.group);
  }

  // destello del consenso: los quórums se enlazan y los satélites parpadean
  onLedger() { this.flash = 1; }

  update(t: number, dt: number) {
    this.flash = Math.max(0, this.flash - dt * 1.2);
    this.emblem.rotation.z = t * 0.03;
    this.emblemMat.opacity = 0.12 + 0.05 * Math.sin(t * 0.8) + this.flash * 0.12;
    for (const m of this.quorumLinks) m.opacity = 0.18 + this.flash * 0.7;
    this.nodes.forEach((n, i) => { n.rotation.y = t * 0.8 + i; n.position.y = 5 + Math.sin(t * 1.5 + i) * 0.5; });
    for (const p of this.packets) {
      p.t = (p.t + p.speed * dt) % 1;
      p.mesh.position.copy(p.lane.getPoint(p.t)).setY(0);
      p.mesh.rotation.y += dt * 3;
    }
    for (const s of this.sats) {
      const a = s.phase + t * s.speed;
      s.obj.position.set(Math.cos(a) * s.r, s.y, Math.sin(a) * s.r);
      s.obj.rotation.y = -a;
      s.light.color.copy(CYAN).multiplyScalar(0.8 + this.flash * 2.5 + (Math.sin(t * 4 + s.phase) > 0.8 ? 1 : 0));
    }
  }

  dispose() {
    this.group.parent?.remove(this.group);
    this.group.traverse(o => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach(x => x.dispose()); else mat?.dispose();
    });
  }
}
