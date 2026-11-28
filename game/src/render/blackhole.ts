// Agujeros negros del mapa de partida: horizonte negro, anillo de fotones, disco de acreción que gira y un
// remolino tenue que marca hasta dónde llega el frenado. La simulación solo conoce posición y radio.
import * as THREE from 'three';
import type { BlackHole } from '../sim/types';

const diskVert = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// disco plano en coordenadas polares: brazos en espiral que giran más rápido cerca del centro
const diskFrag = `uniform float uTime; uniform float uInner; varying vec2 vUv;
  void main(){
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0 || r < uInner) discard;
    float a = atan(p.y, p.x);
    float t = (r - uInner) / (1.0 - uInner);
    float swirl = a * 3.0 + log(r) * 9.0 + uTime * (1.6 / (r + 0.15));
    float arms = 0.55 + 0.45 * sin(swirl);
    float hot = pow(1.0 - t, 2.4);
    vec3 col = mix(vec3(0.45, 0.25, 1.1), vec3(1.6, 0.75, 0.25), hot);
    col = mix(col, vec3(2.2, 2.0, 1.7), pow(1.0 - t, 9.0));
    float alpha = (hot * 0.95 + 0.12 * (1.0 - t)) * arms;
    alpha *= smoothstep(0.0, 0.05, r - uInner);
    gl_FragColor = vec4(col * alpha, alpha);
  }`;

// zona de influencia: espiral muy tenue hasta el borde, para que se lea dónde empieza a frenar
const zoneFrag = `uniform float uTime; varying vec2 vUv;
  void main(){
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;
    float a = atan(p.y, p.x);
    float s = 0.5 + 0.5 * sin(a * 2.0 + log(max(r, 0.02)) * 7.0 + uTime * 0.9);
    float edge = smoothstep(0.93, 0.99, r) * (1.0 - smoothstep(0.99, 1.0, r));
    float alpha = (s * 0.16 * smoothstep(1.0, 0.3, r) + edge * 0.5);
    vec3 col = mix(vec3(0.35, 0.2, 0.9), vec3(0.9, 0.5, 1.2), edge);
    gl_FragColor = vec4(col * alpha, alpha);
  }`;

export class BlackHoles {
  readonly group = new THREE.Group();
  private mats: THREE.ShaderMaterial[] = [];
  private disks: THREE.Object3D[] = [];

  constructor(scene: THREE.Scene, holes: BlackHole[]) {
    for (const h of holes) {
      const g = new THREE.Group();
      g.position.set(h.pos.x, 0, h.pos.z);
      const r = h.radius;

      // sombra: oscurece el fondo bajo el agujero (mezcla normal, no aditiva)
      const shadow = new THREE.Mesh(
        new THREE.CircleGeometry(r * 0.55, 48),
        new THREE.ShaderMaterial({
          transparent: true, depthWrite: false,
          vertexShader: diskVert,
          fragmentShader: `varying vec2 vUv; void main(){ float r = length(vUv * 2.0 - 1.0); gl_FragColor = vec4(0.0, 0.0, 0.0, smoothstep(1.0, 0.35, r) * 0.9); }`,
        }),
      );
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = -1.5;
      g.add(shadow);

      const zoneMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { uTime: { value: 0 } }, vertexShader: diskVert, fragmentShader: zoneFrag });
      const zone = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 2), zoneMat);
      zone.rotation.x = -Math.PI / 2;
      zone.position.y = -1;
      g.add(zone);
      this.mats.push(zoneMat);

      // disco de acreción algo inclinado: se ve el volumen desde la cámara del RTS
      const tilt = new THREE.Group();
      tilt.position.y = 6;
      tilt.rotation.set(-0.22, 0, 0.12);
      const diskMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { uTime: { value: 0 }, uInner: { value: 0.38 } }, vertexShader: diskVert, fragmentShader: diskFrag });
      const disk = new THREE.Mesh(new THREE.PlaneGeometry(r * 1.5, r * 1.5), diskMat);
      disk.rotation.x = -Math.PI / 2;
      tilt.add(disk);
      this.mats.push(diskMat);
      this.disks.push(disk);

      // horizonte de sucesos y anillo de fotones
      const horizon = new THREE.Mesh(new THREE.SphereGeometry(r * 0.25, 32, 20), new THREE.MeshBasicMaterial({ color: 0x000000 }));
      tilt.add(horizon);
      const photon = new THREE.Mesh(new THREE.TorusGeometry(r * 0.27, r * 0.012, 8, 96), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.9, 1.4) }));
      photon.rotation.x = Math.PI / 2;
      tilt.add(photon);
      // anillo de lente vertical: la luz del disco que se curva por detrás del horizonte
      const lens = new THREE.Mesh(new THREE.TorusGeometry(r * 0.29, r * 0.02, 8, 96), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 0.8, 0.35), transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }));
      tilt.add(lens);
      g.add(tilt);
      this.group.add(g);
    }
    scene.add(this.group);
  }

  update(t: number, camera: THREE.Camera) {
    for (const m of this.mats) m.uniforms.uTime.value = t;
    // el anillo de lente mira siempre a la cámara, como la imagen real de un agujero negro
    for (const d of this.disks) {
      const lens = d.parent!.children[3];
      lens.quaternion.copy(camera.quaternion);
      lens.quaternion.premultiply(d.parent!.getWorldQuaternion(new THREE.Quaternion()).invert());
    }
  }

  dispose() {
    this.group.removeFromParent();
  }
}
