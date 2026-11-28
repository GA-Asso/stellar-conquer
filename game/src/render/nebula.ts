// Nebulosas iónicas: nubes de gas en capas que flotan por encima de las naves y las tapan a medias, con
// destellos de rayos de vez en cuando. Las unidades rivales dentro se ocultan (lo decide view.ts con la sim).
import * as THREE from 'three';
import type { Nebula } from '../sim/types';

let puffTex: THREE.Texture | null = null;
function puff(): THREE.Texture {
  if (puffTex) return puffTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  // mancha irregular: varios círculos suaves superpuestos
  for (let i = 0; i < 9; i++) {
    const x = 64 + (Math.sin(i * 2.3) * 22), y = 64 + (Math.cos(i * 1.7) * 22), r = 30 + (i % 3) * 8;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.35)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
  }
  puffTex = new THREE.CanvasTexture(c);
  puffTex.colorSpace = THREE.SRGBColorSpace;
  return puffTex;
}

const PALETTE = ['#3fb8ff', '#6a5cff', '#2ee6c8', '#9a7bff'];

export class Nebulae {
  readonly group = new THREE.Group();
  private puffs: { s: THREE.Sprite; base: THREE.Vector3; ph: number; sp: number }[] = [];
  private bolts: { light: THREE.PointLight; next: number; at: THREE.Vector3; r: number }[] = [];

  constructor(scene: THREE.Scene, list: Nebula[]) {
    list.forEach((n, ni) => {
      const count = Math.round(n.radius * 1.1);
      for (let i = 0; i < count; i++) {
        const a = i * 2.399 + ni, d = Math.sqrt((i + 0.5) / count) * n.radius * 0.85;
        const base = new THREE.Vector3(n.pos.x + Math.cos(a) * d, 4 + (i % 4) * 3.5, n.pos.z + Math.sin(a) * d);
        const col = new THREE.Color(PALETTE[(i + ni) % PALETTE.length]);
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff(), color: col, transparent: true, opacity: 0.13, depthWrite: false, blending: THREE.AdditiveBlending }));
        s.position.copy(base);
        s.scale.setScalar(n.radius * (0.38 + ((i * 7) % 5) * 0.07));
        s.material.rotation = i;
        this.group.add(s);
        this.puffs.push({ s, base, ph: i * 1.3, sp: 0.15 + (i % 5) * 0.04 });
      }
      // rayo interno: una luz que se enciende un instante cada pocos segundos
      const light = new THREE.PointLight(0x9fd8ff, 0, n.radius * 1.6, 2);
      this.group.add(light);
      this.bolts.push({ light, next: 1 + ni * 1.7, at: new THREE.Vector3(n.pos.x, 10, n.pos.z), r: n.radius });
    });
    scene.add(this.group);
  }

  update(t: number) {
    for (const p of this.puffs) {
      p.s.position.set(p.base.x + Math.sin(t * p.sp + p.ph) * 3, p.base.y, p.base.z + Math.cos(t * p.sp * 0.8 + p.ph) * 3);
      p.s.material.rotation += 0.0015;
    }
    for (const b of this.bolts) {
      if (t > b.next) {
        b.light.position.set(b.at.x + (Math.random() - 0.5) * b.r, 10, b.at.z + (Math.random() - 0.5) * b.r);
        b.light.intensity = 9000;
        b.next = t + 2.5 + Math.random() * 4;
      }
      b.light.intensity *= 0.82;
    }
  }

  dispose() { this.group.removeFromParent(); }
}
