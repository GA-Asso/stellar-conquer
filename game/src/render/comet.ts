// Cometa: aviso con una franja punteada sobre su trayectoria y, al cruzar, núcleo helado brillante con coma y
// una cola larga de partículas que se queda atrás. Todo se deriva de s.comet: la vista no decide nada.
import * as THREE from 'three';
import { cometHead } from '../sim/sim';
import type { SimState } from '../sim/types';

const TAIL = 420;

export class CometView {
  private group = new THREE.Group();
  private warnLine: THREE.Line;
  private warnMat: THREE.LineDashedMaterial;
  private head: THREE.Group;
  private tail: THREE.Points;
  private tailPos = new Float32Array(TAIL * 3);
  private tailVel = new Float32Array(TAIL * 3);
  private tailLife = new Float32Array(TAIL);
  private cursor = 0;
  private light: THREE.PointLight;
  private key = '';

  constructor(private scene: THREE.Scene) {
    this.warnMat = new THREE.LineDashedMaterial({ color: new THREE.Color(1.6, 2.2, 2.6), dashSize: 8, gapSize: 7, transparent: true, opacity: 0, depthWrite: false });
    this.warnLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), this.warnMat);
    this.group.add(this.warnLine);

    this.head = new THREE.Group();
    this.head.add(new THREE.Mesh(new THREE.IcosahedronGeometry(3.2, 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3.4, 3.8) })));
    const coma = new THREE.Mesh(new THREE.SphereGeometry(7, 24, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 1.2, 1.8), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.head.add(coma);
    this.light = new THREE.PointLight(0xaee8ff, 0, 160, 2);
    this.head.add(this.light);
    this.head.visible = false;
    this.group.add(this.head);

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.tailPos, 3));
    this.tail = new THREE.Points(g, new THREE.PointsMaterial({ color: new THREE.Color(1.3, 2.2, 2.8), size: 2.6, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.tail.frustumCulled = false;
    this.tailPos.fill(-9999);
    this.group.add(this.tail);
    scene.add(this.group);
  }

  update(s: SimState, alpha: number, dt: number) {
    const c = s.comet;
    if (c) {
      const key = `${c.from.x},${c.from.z}`;
      if (key !== this.key) {
        this.key = key;
        const pos = this.warnLine.geometry.attributes.position as THREE.BufferAttribute;
        pos.setXYZ(0, c.from.x, 1, c.from.z);
        pos.setXYZ(1, c.to.x, 1, c.to.z);
        pos.needsUpdate = true;
        this.warnLine.computeLineDistances();
        this.warnLine.geometry.computeBoundingSphere();
      }
      // aviso que parpadea hasta que el cometa entra; luego se apaga despacio
      const warning = s.tick < c.start;
      const target = warning ? 0.35 + 0.35 * Math.sin(performance.now() / 120) : 0;
      this.warnMat.opacity += (target - this.warnMat.opacity) * Math.min(1, dt * 8);
    } else {
      this.warnMat.opacity = Math.max(0, this.warnMat.opacity - dt);
    }

    const head = c ? cometHead(c, s.tick) : null;
    const next = c ? cometHead(c, s.tick + 1) : null;
    this.head.visible = !!head;
    if (head && c) {
      const p = next ? { x: head.x + (next.x - head.x) * alpha, z: head.z + (next.z - head.z) * alpha } : head;
      this.head.position.set(p.x, 14, p.z);
      this.head.rotation.y += dt * 2;
      this.light.intensity = 9000;
      // cola: partículas que nacen en la cabeza y se quedan atrás, abriéndose
      const dx = c.to.x - c.from.x, dz = c.to.z - c.from.z, l = Math.hypot(dx, dz);
      for (let k = 0; k < 9; k++) {
        const i = this.cursor = (this.cursor + 1) % TAIL;
        this.tailPos.set([p.x + (Math.random() - 0.5) * 4, 14 + (Math.random() - 0.5) * 4, p.z + (Math.random() - 0.5) * 4], i * 3);
        const back = 10 + Math.random() * 25;
        this.tailVel.set([-dx / l * back + (Math.random() - 0.5) * 8, (Math.random() - 0.3) * 4, -dz / l * back + (Math.random() - 0.5) * 8], i * 3);
        this.tailLife[i] = 1.6;
      }
    }
    for (let i = 0; i < TAIL; i++) {
      if (this.tailLife[i] <= 0) continue;
      this.tailLife[i] -= dt;
      if (this.tailLife[i] <= 0) { this.tailPos[i * 3 + 1] = -9999; continue; }
      this.tailPos[i * 3] += this.tailVel[i * 3] * dt;
      this.tailPos[i * 3 + 1] += this.tailVel[i * 3 + 1] * dt;
      this.tailPos[i * 3 + 2] += this.tailVel[i * 3 + 2] * dt;
    }
    (this.tail.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose() { this.scene.remove(this.group); }
}
