// Efectos visuales: disparos, explosiones, pulsos de ledger y flujos de pago estilo Stellar.
import * as THREE from 'three';
import type { Owner, Vec } from '../sim/types';
import { SIDE_COLORS } from './models';

interface Beam { mesh: THREE.Mesh; life: number; max: number }
interface Bolt { mesh: THREE.Mesh; from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number }
interface Burst { points: THREE.Points; vel: Float32Array; life: number; max: number; flash: THREE.Mesh }
interface Pulse { mesh: THREE.Mesh; life: number; max: number; maxR: number }
interface Payment { mesh: THREE.Mesh; curve: THREE.QuadraticBezierCurve3; t: number; dur: number; trail: THREE.Mesh[] }

const glowColor = (side: Owner, k = 3) => SIDE_COLORS[side].clone().multiplyScalar(k);

export class Fx {
  private beams: Beam[] = [];
  private bolts: Bolt[] = [];
  private bursts: Burst[] = [];
  private pulses: Pulse[] = [];
  private payments: Payment[] = [];
  private beamGeo = new THREE.CylinderGeometry(0.16, 0.16, 1, 6, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);
  private boltGeo = new THREE.SphereGeometry(0.9, 10, 8);
  private ringGeo = new THREE.RingGeometry(0.96, 1, 128);
  private dotGeo = new THREE.SphereGeometry(0.7, 8, 6);

  constructor(private scene: THREE.Scene) {}

  laser(from: Vec, to: Vec, side: Owner, fromY = 6, toY = 4) {
    const mesh = new THREE.Mesh(this.beamGeo, new THREE.MeshBasicMaterial({
      color: glowColor(side, 4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    const a = new THREE.Vector3(from.x, fromY, from.z), b = new THREE.Vector3(to.x, toY, to.z);
    mesh.position.copy(a);
    mesh.lookAt(b);
    mesh.scale.set(1, 1, a.distanceTo(b));
    this.scene.add(mesh);
    this.beams.push({ mesh, life: 0.14, max: 0.14 });
  }

  plasma(from: Vec, to: Vec, side: Owner, fromY = 6, toY = 4) {
    const mesh = new THREE.Mesh(this.boltGeo, new THREE.MeshBasicMaterial({ color: glowColor(side, 5) }));
    const a = new THREE.Vector3(from.x, fromY, from.z), b = new THREE.Vector3(to.x, toY, to.z);
    mesh.position.copy(a);
    this.scene.add(mesh);
    this.bolts.push({ mesh, from: a, to: b, t: 0, dur: Math.max(0.12, a.distanceTo(b) / 120) });
  }

  explosion(pos: Vec, size: number, side: Owner, y = 4) {
    const n = Math.round(24 + size * 10);
    const p = new Float32Array(n * 3), vel = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      const sp = (4 + Math.random() * 10) * (0.6 + size * 0.15);
      vel.set([Math.cos(a) * s * sp, u * sp, Math.sin(a) * s * sp], i * 3);
      p.set([pos.x, y, pos.z], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const points = new THREE.Points(g, new THREE.PointsMaterial({
      color: new THREE.Color(3, 1.6, 0.6), size: 1.4 + size * 0.15, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    const flash = new THREE.Mesh(this.boltGeo, new THREE.MeshBasicMaterial({
      color: glowColor(side, 2).add(new THREE.Color(2, 1.5, 1)), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    flash.position.set(pos.x, y, pos.z);
    this.scene.add(points, flash);
    const max = 0.9 + size * 0.05;
    this.bursts.push({ points, vel, life: max, max, flash });
  }

  // onda que sale del núcleo cada vez que se cierra un ledger
  pulse(pos: Vec, side: Owner, maxR = 90) {
    const mesh = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({
      color: glowColor(side, 2.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(pos.x, 1.2, pos.z);
    this.scene.add(mesh);
    this.pulses.push({ mesh, life: 1.6, max: 1.6, maxR });
  }

  // un pago viaja en arco desde un planeta hasta el núcleo, dejando estela
  payment(from: Vec, to: Vec, side: Owner) {
    const a = new THREE.Vector3(from.x, 8, from.z), b = new THREE.Vector3(to.x, 12, to.z);
    const mid = a.clone().lerp(b, 0.5);
    mid.y += a.distanceTo(b) * 0.35;
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    const mat = new THREE.MeshBasicMaterial({ color: glowColor(side, 5) });
    const mesh = new THREE.Mesh(this.dotGeo, mat);
    mesh.scale.setScalar(1.4);
    const trail: THREE.Mesh[] = [];
    for (let i = 0; i < 10; i++) {
      const t = new THREE.Mesh(this.dotGeo, new THREE.MeshBasicMaterial({
        color: glowColor(side, 3), transparent: true, opacity: 1 - i / 10, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      t.scale.setScalar(1 - i * 0.08);
      trail.push(t);
      this.scene.add(t);
    }
    this.scene.add(mesh);
    this.payments.push({ mesh, curve, t: 0, dur: 1.8, trail });
  }

  update(dt: number) {
    this.beams = this.beams.filter(b => {
      b.life -= dt;
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, b.life / b.max);
      if (b.life > 0) return true;
      this.dispose(b.mesh);
      return false;
    });
    this.bolts = this.bolts.filter(b => {
      b.t += dt / b.dur;
      b.mesh.position.lerpVectors(b.from, b.to, Math.min(1, b.t));
      if (b.t < 1) return true;
      this.dispose(b.mesh);
      return false;
    });
    this.bursts = this.bursts.filter(b => {
      b.life -= dt;
      const pos = b.points.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        pos.setXYZ(i, pos.getX(i) + b.vel[i * 3] * dt, pos.getY(i) + b.vel[i * 3 + 1] * dt, pos.getZ(i) + b.vel[i * 3 + 2] * dt);
        b.vel[i * 3] *= 0.96; b.vel[i * 3 + 1] *= 0.96; b.vel[i * 3 + 2] *= 0.96;
      }
      pos.needsUpdate = true;
      const k = Math.max(0, b.life / b.max);
      (b.points.material as THREE.PointsMaterial).opacity = k;
      (b.flash.material as THREE.MeshBasicMaterial).opacity = k * k;
      b.flash.scale.setScalar(1 + (1 - k) * 6);
      if (b.life > 0) return true;
      this.dispose(b.points);
      this.dispose(b.flash);
      return false;
    });
    this.pulses = this.pulses.filter(p => {
      p.life -= dt;
      const k = 1 - p.life / p.max;
      p.mesh.scale.setScalar(4 + k * p.maxR);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.9;
      if (p.life > 0) return true;
      this.dispose(p.mesh);
      return false;
    });
    this.payments = this.payments.filter(p => {
      p.t += dt / p.dur;
      const t = Math.min(1, p.t);
      p.mesh.position.copy(p.curve.getPoint(t));
      p.trail.forEach((m, i) => m.position.copy(p.curve.getPoint(Math.max(0, t - (i + 1) * 0.018))));
      if (p.t < 1) return true;
      this.dispose(p.mesh);
      p.trail.forEach(m => this.dispose(m));
      return false;
    });
  }

  private dispose(o: THREE.Mesh | THREE.Points) {
    this.scene.remove(o);
    (o.material as THREE.Material).dispose();
    if (o instanceof THREE.Points) o.geometry.dispose();
  }
}
