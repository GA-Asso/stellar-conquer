// Agujeros de gusano: cada boca es un túnel que gira hacia dentro, enmarcado por un anillo de pilones. Las dos
// bocas de una pareja comparten color para que se lea cuál lleva a cuál (también en el minimapa).
import * as THREE from 'three';
import type { Wormhole } from '../sim/types';

export const WORMHOLE_COLORS = ['#35f2c9', '#ff8af0'];

const vert = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
// túnel: anillos que caen hacia el centro y brazos en espiral, con el fondo oscuro de la garganta
const frag = `uniform float uTime; uniform vec3 uColor; varying vec2 vUv;
  void main(){
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;
    float a = atan(p.y, p.x);
    float depth = 1.0 / (r + 0.08);
    float rings = 0.5 + 0.5 * sin(depth * 3.0 - uTime * 4.0);
    float arms = 0.5 + 0.5 * sin(a * 4.0 + depth * 1.4 - uTime * 2.2);
    float glow = pow(rings * 0.6 + arms * 0.4, 2.0);
    float edge = smoothstep(1.0, 0.86, r) * smoothstep(0.55, 0.95, r);
    float throat = smoothstep(0.35, 0.0, r);
    vec3 col = uColor * (glow * 0.9 + edge * 1.4) + vec3(1.0) * throat * 0.6 * (0.6 + 0.4 * sin(uTime * 3.0));
    float alpha = clamp(glow * 0.75 * smoothstep(1.0, 0.7, r) + edge * 0.8 + throat * 0.5, 0.0, 1.0);
    gl_FragColor = vec4(col * alpha, alpha);
  }`;

export class Wormholes {
  readonly group = new THREE.Group();
  private mats: THREE.ShaderMaterial[] = [];
  private spinners: THREE.Object3D[] = [];

  constructor(scene: THREE.Scene, list: Wormhole[]) {
    list.forEach((w, i) => {
      const color = new THREE.Color(WORMHOLE_COLORS[i % WORMHOLE_COLORS.length]);
      for (const p of [w.a, w.b]) this.group.add(this.mouth(p.x, p.z, w.radius, color));
    });
    scene.add(this.group);
  }

  private mouth(x: number, z: number, r: number, color: THREE.Color): THREE.Group {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uTime: { value: Math.random() * 10 }, uColor: { value: color.clone().multiplyScalar(1.6) } },
      vertexShader: vert, fragmentShader: frag,
    });
    this.mats.push(mat);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 64), mat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.6;
    g.add(disc);
    // anillo de pilones que gira despacio
    const frame = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0x2a3042, metalness: 0.7, roughness: 0.35 });
    const light = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(2.2) });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const post = new THREE.Mesh(new THREE.BoxGeometry(1.4, 5, 2.4), metal);
      post.position.set(Math.cos(a) * (r + 1.5), 2.5, Math.sin(a) * (r + 1.5));
      post.rotation.y = -a;
      frame.add(post);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.6, 10, 8), light);
      tip.position.set(Math.cos(a) * (r + 1.5), 5.4, Math.sin(a) * (r + 1.5));
      frame.add(tip);
    }
    const band = new THREE.Mesh(new THREE.TorusGeometry(r + 1.5, 0.3, 8, 96), light);
    band.rotation.x = Math.PI / 2;
    band.position.y = 0.8;
    frame.add(band);
    g.add(frame);
    this.spinners.push(frame);
    return g;
  }

  update(t: number, dt: number) {
    for (const m of this.mats) m.uniforms.uTime.value += dt;
    for (const s of this.spinners) s.rotation.y += dt * 0.25;
    void t;
  }

  dispose() { this.group.removeFromParent(); }
}
