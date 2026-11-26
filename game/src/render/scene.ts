// Escena espacial: cámara orbital, nebulosa procedural y bloom (sin campos de estrellas).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { MAP_HALF } from '../sim/defs';

export const STELLAR_GOLD = new THREE.Color('#fdda24');
export const STELLAR_VIOLET = new THREE.Color('#8b5cff');

// Cámara que orbita un punto del plano de juego. yaw = giro, pitch = inclinación.
export class OrbitRig {
  target = new THREE.Vector3(0, 0, 0);
  yaw = Math.PI * 0.25;
  pitch = 0.95;
  distance = 190;
  /** hasta dónde puede alejarse el punto de mira del origen (el universo es mayor que una partida) */
  bound = MAP_HALF + 20;
  private goal = { yaw: this.yaw, pitch: this.pitch, distance: this.distance, target: this.target.clone() };

  constructor(public camera: THREE.PerspectiveCamera) {}

  rotate(dYaw: number, dPitch: number) {
    this.goal.yaw += dYaw;
    this.goal.pitch = THREE.MathUtils.clamp(this.goal.pitch + dPitch, 0.25, 1.48);
  }
  zoom(f: number) { this.goal.distance = THREE.MathUtils.clamp(this.goal.distance * f, 45, 520); }
  // desplaza en coordenadas de pantalla (derecha / adelante) respecto al giro actual
  pan(right: number, forward: number) {
    const k = this.goal.distance / 200;
    const sx = Math.cos(this.goal.yaw), sz = -Math.sin(this.goal.yaw);
    const fx = -Math.sin(this.goal.yaw), fz = -Math.cos(this.goal.yaw);
    this.goal.target.x += (sx * right + fx * forward) * k;
    this.goal.target.z += (sz * right + fz * forward) * k;
    this.clampTarget();
  }
  lookAt(x: number, z: number) { this.goal.target.set(x, 0, z); this.clampTarget(); }
  private clampTarget() {
    const m = this.bound;
    this.goal.target.x = THREE.MathUtils.clamp(this.goal.target.x, -m, m);
    this.goal.target.z = THREE.MathUtils.clamp(this.goal.target.z, -m, m);
  }

  update(dt: number) {
    const k = 1 - Math.exp(-dt * 10);
    this.yaw += (this.goal.yaw - this.yaw) * k;
    this.pitch += (this.goal.pitch - this.pitch) * k;
    this.distance += (this.goal.distance - this.distance) * k;
    this.target.lerp(this.goal.target, k);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * cp * this.distance,
      this.target.y + sp * this.distance,
      this.target.z + Math.cos(this.yaw) * cp * this.distance,
    );
    this.camera.lookAt(this.target);
  }
}

const nebulaVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// fbm de ruido de valor sobre la dirección: nubes violetas con vetas doradas al estilo Stellar
const nebulaFrag = /* glsl */ `
varying vec3 vDir;
uniform float uTime;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 6; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
void main() {
  vec3 d = normalize(vDir);
  float n = fbm(d * 2.4 + vec3(0.0, uTime * 0.004, 0.0));
  float m = fbm(d * 5.0 - vec3(uTime * 0.003));
  float band = exp(-pow(d.y * 2.2 + 0.25 * sin(d.x * 3.0), 2.0));
  vec3 deep = vec3(0.012, 0.012, 0.03);
  vec3 violet = vec3(0.22, 0.09, 0.42);
  vec3 blue = vec3(0.04, 0.1, 0.26);
  vec3 gold = vec3(0.99, 0.85, 0.14);
  vec3 col = deep;
  col = mix(col, blue, smoothstep(0.35, 0.8, n) * 0.7);
  col = mix(col, violet, smoothstep(0.45, 0.9, n * band + m * 0.3) * 0.85);
  col += gold * pow(smoothstep(0.62, 0.95, m * band), 3.0) * 0.35;
  gl_FragColor = vec4(col, 1.0);
}`;

// pasada final, después del tone mapping: gradación de color (sombras hacia el azul, luces hacia el oro),
// viñeta, aberración cromática solo en los bordes y un grano muy fino que quita el aspecto plano del CG
const FinishShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uWarp: { value: 0 }, uAspect: { value: 1 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uWarp; uniform float uAspect; varying vec2 vUv;
    float rnd(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      float r = length(c * vec2(uAspect, 1.0));
      // aberración cromática que crece hacia los bordes (y un poco más a toda velocidad)
      vec2 off = c * (0.0016 + uWarp * 0.004) * smoothstep(0.15, 0.75, r);
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, col * vec3(0.92, 0.98, 1.12), (1.0 - smoothstep(0.0, 0.45, l)) * 0.6);
      col = mix(col, col * vec3(1.06, 1.02, 0.92), smoothstep(0.55, 1.0, l) * 0.5);
      col = mix(vec3(l), col, 1.08);
      col *= mix(1.0, smoothstep(1.05, 0.25, r), 0.55 + uWarp * 0.2);
      col += (rnd(vUv * 731.0 + fract(uTime * 7.3)) - 0.5) * 0.022;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export interface SpaceScene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  rig: OrbitRig;
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  nebula: THREE.ShaderMaterial;
  /** 0..1: intensidad del efecto de velocidad (viñeta y aberración) */
  setWarp(k: number): void;
  resize(): void;
  render(dt: number): void;
}

export function createSpaceScene(host: HTMLElement): SpaceScene {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#03040a');
  scene.fog = new THREE.FogExp2(0x05060f, 0.0011);
  const camera = new THREE.PerspectiveCamera(50, 1, 1, 6000);
  const rig = new OrbitRig(camera);

  const nebula = new THREE.ShaderMaterial({
    vertexShader: nebulaVert, fragmentShader: nebulaFrag, side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTime: { value: 0 } },
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(2800, 48, 32), nebula);
  sky.renderOrder = -10;
  scene.add(sky);

  // sol lejano: luz principal y un halo que el bloom hace brillar
  const sun = new THREE.DirectionalLight(0xfff1d0, 1.8);
  sun.position.set(-300, 400, 200);
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0x8fa3ff, 0x1a0b2e, 0.55));
  const sunGlow = new THREE.Mesh(new THREE.SphereGeometry(60, 32, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.6, 1.6), fog: false }));
  sunGlow.position.set(-1500, 1100, 900);
  scene.add(sunGlow);

  // con posprocesado el canvas pierde su antialiasing: el render target lleva su propio MSAA
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: renderer.capabilities.isWebGL2 ? 4 : 0 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.35, 1.0);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const finish = new ShaderPass(FinishShader);
  composer.addPass(finish);

  const resize = () => {
    const w = host.clientWidth, h = host.clientHeight;
    renderer.setSize(w, h);
    composer.setSize(w, h);
    bloom.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    finish.uniforms.uAspect.value = w / Math.max(1, h);
  };
  resize();
  window.addEventListener('resize', resize);

  let t = 0;
  return {
    renderer, scene, camera, rig, composer, bloom, nebula, resize,
    setWarp(k: number) { finish.uniforms.uWarp.value = k; },
    render(dt: number) {
      t += dt;
      finish.uniforms.uTime.value = t;
      nebula.uniforms.uTime.value = t;
      rig.update(dt);
      sky.position.copy(camera.position);
      composer.render(dt);
    },
  };
}
