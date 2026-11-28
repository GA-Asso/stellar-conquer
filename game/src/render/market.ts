// Mercado Central: estación comercial neutral en el centro del mapa. Plataforma dorada, torre con anillo
// giratorio de muelles, tres "monedas" de los recursos orbitando y la zona de acceso marcada en el suelo, que
// se ilumina cuando tienes flota dentro y puedes comerciar.
import * as THREE from 'three';
import { MARKET } from '../sim/defs';

const GOLD = new THREE.Color('#fdda24');
const RES_COLORS = ['#fdda24', '#d0946a', '#5cc8ff'];

export class MarketView {
  private group = new THREE.Group();
  private ring: THREE.Group;
  private coins: THREE.Group;
  private zone: THREE.Mesh;
  private zoneMat: THREE.MeshBasicMaterial;
  private sign: THREE.Mesh;

  constructor(private scene: THREE.Scene) {
    const { x, z } = MARKET.pos;
    const R = MARKET.radius;
    this.group.position.set(x, 0, z);
    const hull = new THREE.MeshStandardMaterial({ color: 0xe4e7ef, metalness: 0.35, roughness: 0.45 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b1f2e, metalness: 0.7, roughness: 0.4 });
    const gold = new THREE.MeshStandardMaterial({ color: GOLD, metalness: 0.8, roughness: 0.25, emissive: GOLD, emissiveIntensity: 0.25 });
    const glow = new THREE.MeshBasicMaterial({ color: GOLD.clone().multiplyScalar(2) });

    // plataforma octogonal con borde dorado
    this.group.add(at(new THREE.Mesh(new THREE.CylinderGeometry(R, R * 1.05, 1.6, 8), dark), 0, 0.8, 0));
    this.group.add(at(new THREE.Mesh(new THREE.CylinderGeometry(R * 0.9, R * 0.9, 0.3, 8), hull), 0, 1.7, 0));
    const edge = new THREE.Mesh(new THREE.TorusGeometry(R * 1.02, 0.35, 6, 8), gold);
    edge.rotation.x = Math.PI / 2;
    edge.rotation.z = Math.PI / 8;
    edge.position.y = 1.7;
    this.group.add(edge);
    // torre central: lonja con ventanas y cúpula dorada
    this.group.add(at(new THREE.Mesh(new THREE.CylinderGeometry(6, 7.5, 6, 16), hull), 0, 4.8, 0));
    this.group.add(at(new THREE.Mesh(new THREE.CylinderGeometry(6.2, 6.2, 1.2, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.9, 0.6) })), 0, 8.2, 0));
    this.group.add(at(new THREE.Mesh(new THREE.CylinderGeometry(4.5, 6, 5, 16), hull), 0, 11.2, 0));
    this.group.add(at(new THREE.Mesh(new THREE.SphereGeometry(4.6, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), gold), 0, 13.7, 0));
    this.group.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 8, 6), dark), 0, 21, 0));
    this.group.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 10), glow), 0, 25.2, 0));

    // anillo de muelles que gira: brazos con naves de carga atracadas
    this.ring = new THREE.Group();
    this.ring.position.y = 9;
    const torus = new THREE.Mesh(new THREE.TorusGeometry(R * 0.78, 0.6, 8, 64), hull);
    torus.rotation.x = Math.PI / 2;
    this.ring.add(torus);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(R * 0.78 - 6, 0.5, 0.8), dark);
      arm.position.set(Math.cos(a) * (R * 0.39 + 3), 0, Math.sin(a) * (R * 0.39 + 3));
      arm.rotation.y = -a;
      this.ring.add(arm);
      const pod = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.4, 1.6), i % 2 ? gold : hull);
      pod.position.set(Math.cos(a) * R * 0.78, 1.2, Math.sin(a) * R * 0.78);
      pod.rotation.y = -a;
      this.ring.add(pod);
      this.ring.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), glow), Math.cos(a) * R * 0.78, 2.3, Math.sin(a) * R * 0.78));
    }
    this.group.add(this.ring);

    // las tres monedas de los recursos
    this.coins = new THREE.Group();
    this.coins.position.y = 17;
    RES_COLORS.forEach((c, i) => {
      const col = new THREE.Color(c);
      const coin = new THREE.Mesh(new THREE.OctahedronGeometry(1.5, 0), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.9, metalness: 0.5, roughness: 0.3 }));
      const a = (i / 3) * Math.PI * 2;
      coin.position.set(Math.cos(a) * 8, 0, Math.sin(a) * 8);
      this.coins.add(coin);
    });
    this.group.add(this.coins);

    // zona de acceso: hasta dónde tiene que llegar tu flota para comerciar
    this.zoneMat = new THREE.MeshBasicMaterial({ color: GOLD.clone().multiplyScalar(1.4), transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    this.zone = new THREE.Mesh(new THREE.RingGeometry(MARKET.reach - 0.8, MARKET.reach, 128), this.zoneMat);
    this.zone.rotation.x = -Math.PI / 2;
    this.zone.position.y = 0.4;
    this.group.add(this.zone);
    // rótulo holográfico que mira a la cámara
    this.sign = new THREE.Mesh(new THREE.PlaneGeometry(26, 6.5), new THREE.MeshBasicMaterial({ map: signTexture(), transparent: true, depthWrite: false }));
    this.sign.position.y = 31;
    this.group.add(this.sign);
    scene.add(this.group);
  }

  update(t: number, dt: number, camera: THREE.Camera, access: boolean) {
    this.ring.rotation.y += dt * 0.22;
    this.coins.rotation.y -= dt * 0.6;
    this.coins.children.forEach((c, i) => { c.rotation.y += dt * 2; c.position.y = Math.sin(t * 1.5 + i * 2) * 1.2; });
    const target = access ? 0.75 + Math.sin(t * 4) * 0.15 : 0.22;
    this.zoneMat.opacity += (target - this.zoneMat.opacity) * Math.min(1, dt * 5);
    this.sign.quaternion.copy(camera.quaternion);
  }

  dispose() { this.scene.remove(this.group); }
}

function at<T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T { o.position.set(x, y, z); return o; }

function signTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(8,10,20,0.75)';
  g.beginPath(); g.roundRect(4, 4, 504, 120, 60); g.fill();
  g.strokeStyle = '#fdda24'; g.lineWidth = 5; g.stroke();
  g.fillStyle = '#fdda24';
  g.font = '700 44px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('MERCADO CENTRAL', 256, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
