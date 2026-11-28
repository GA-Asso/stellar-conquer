// Miniaturas de los módulos para las tarjetas del HUD: se renderiza el mismo modelo 3D del juego en un lienzo
// aparte, en vista de tres cuartos, y se guarda como imagen. Se hace una vez por módulo y bando.
import * as THREE from 'three';
import type { ModuleType, Side } from '../sim/types';
import { buildModule } from './models';

const SIZE = 256;
const cache = new Map<string, string>();
let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;

function setup() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE, SIZE, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xbfd0ff, 0x1a1030, 1.1));
  const key = new THREE.DirectionalLight(0xfff1d0, 2.4);
  key.position.set(-30, 50, 40);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x6fd8ff, 1.2);
  rim.position.set(40, 20, -40);
  scene.add(rim);
  camera = new THREE.PerspectiveCamera(32, 1, 0.1, 1000);
}

/** imagen (data URL) del módulo tal como se ve en la partida */
export function moduleThumb(type: ModuleType, side: Side): string {
  const id = `${type}:${side}`;
  const hit = cache.get(id);
  if (hit) return hit;
  if (!renderer) setup();
  const model = buildModule(type, side).group;
  scene!.add(model);
  // encuadre: la caja del modelo centrada, vista desde arriba en diagonal
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
  const r = Math.max(size.x, size.y * 0.9, size.z) * 0.62;
  const dist = r / Math.tan(THREE.MathUtils.degToRad(camera!.fov / 2)) * 1.05;
  camera!.position.set(center.x + dist * 0.62, center.y + dist * 0.55, center.z + dist * 0.56);
  camera!.lookAt(center);
  renderer!.render(scene!, camera!);
  const url = renderer!.domElement.toDataURL('image/png');
  scene!.remove(model);
  model.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  cache.set(id, url);
  return url;
}
