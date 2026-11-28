// Planetas procedurales del atlas: cada galaxia tiene su propio bioma (gigantes gaseosos, mundos helados,
// volcánicos, oceánicos, desérticos…), así una constelación se reconoce por cómo son sus planetas y no solo
// por el color. Las texturas se pintan una vez en un canvas (ruido fractal con semilla, sin descargas) y se
// comparten entre todos los planetas de la misma variante; la atmósfera lleva el color del estado del proyecto.
import * as THREE from 'three';

export type BiomeKind = 'gas' | 'ice' | 'lava' | 'ocean' | 'desert' | 'rock' | 'storm';

export interface Biome {
  kind: BiomeKind;
  /** de oscuro a claro: fondo, tono medio, realce */
  palette: [string, string, string];
  /** nombre corto para la ficha y la leyenda */
  label: string;
}

/** bioma de cada galaxia del mapa; las que no estén aquí usan roca */
export const BIOMES: Record<string, Biome> = {
  nucleo: { kind: 'gas', palette: ['#6b4a12', '#d9a531', '#fff0b8'], label: 'gigantes gaseosos' },
  wallets: { kind: 'ice', palette: ['#1d5f7a', '#8fe3f5', '#f4fdff'], label: 'mundos helados' },
  defi: { kind: 'gas', palette: ['#2a1660', '#7d5cf0', '#d9ccff'], label: 'gigantes violeta' },
  pagos: { kind: 'ocean', palette: ['#0b3a5c', '#2f9e5a', '#e8f2d8'], label: 'mundos oceánicos' },
  soroban: { kind: 'lava', palette: ['#1a0d08', '#5a2a14', '#ffb347'], label: 'mundos volcánicos' },
  frontera: { kind: 'rock', palette: ['#2a0b18', '#8a2a4e', '#ff9cc0'], label: 'rocas en disputa' },
  rwa: { kind: 'desert', palette: ['#5a1d14', '#c8573a', '#f6c79a'], label: 'desiertos rojos' },
  ia: { kind: 'storm', palette: ['#2e0b3d', '#b24ad6', '#ffd6ff'], label: 'tormentas magenta' },
  juegos: { kind: 'ocean', palette: ['#173b0c', '#8fcf2e', '#f2ffcf'], label: 'selvas' },
  comunidad: { kind: 'ice', palette: ['#4a5670', '#c3cde0', '#ffffff'], label: 'lunas perladas' },
};
const ROCK: Biome = { kind: 'rock', palette: ['#2a2a30', '#6c6c78', '#c9cbd6'], label: 'rocosos' };
export const biomeOf = (galaxy: string): Biome => BIOMES[galaxy] ?? ROCK;

// ---------- ruido con semilla ----------

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5 >>> 0) / 4294967296);
}

/** ruido de valor 3D sobre la esfera: sin costura en el meridiano ni pellizco en los polos */
function noise3(seed: number) {
  const r = rng(seed);
  const perm = new Uint8Array(512), val = new Float32Array(256);
  for (let i = 0; i < 256; i++) { perm[i] = i; val[i] = r(); }
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const h = (x: number, y: number, z: number) => val[perm[perm[perm[x & 255] + (y & 255)] + (z & 255)]];
  const sm = (t: number) => t * t * (3 - 2 * t);
  const n = (x: number, y: number, z: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = sm(x - xi), yf = sm(y - yi), zf = sm(z - zi);
    const l = (a: number, b: number, t: number) => a + (b - a) * t;
    return l(
      l(l(h(xi, yi, zi), h(xi + 1, yi, zi), xf), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), xf), yf),
      l(l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), xf), l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), xf), yf),
      zf,
    );
  };
  return (x: number, y: number, z: number, oct = 5) => {
    let a = 0.5, f = 1, s = 0, norm = 0;
    for (let o = 0; o < oct; o++) { s += a * n(x * f, y * f, z * f); norm += a; a *= 0.5; f *= 2.03; }
    return s / norm;
  };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const sstep = (e0: number, e1: number, x: number) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };

/** mezcla en la rampa de 3 colores de la paleta */
function ramp(p: THREE.Color[], t: number, out: THREE.Color) {
  t = clamp01(t);
  return t < 0.5 ? out.copy(p[0]).lerp(p[1], t * 2) : out.copy(p[1]).lerp(p[2], (t - 0.5) * 2);
}

const W = 256, H = 128;
const cache = new Map<string, { map: THREE.Texture; glow: THREE.Texture | null }>();

/**
 * Textura equirectangular del planeta. `glow` solo existe para los mundos volcánicos (grietas de lava que
 * brillan en la cara oscura).
 */
export function planetTextures(biome: Biome, variant: number): { map: THREE.Texture; glow: THREE.Texture | null } {
  const key = biome.kind + biome.palette.join() + variant;
  const hit = cache.get(key);
  if (hit) return hit;
  const seed = 1013 + variant * 7919 + biome.palette[1].charCodeAt(2) * 31;
  const fbm = noise3(seed), warp = noise3(seed + 17);
  const pal = biome.palette.map(c => new THREE.Color(c));
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const img = g.createImageData(W, H);
  let glowImg: ImageData | null = null, gc: HTMLCanvasElement | null = null;
  if (biome.kind === 'lava') { gc = document.createElement('canvas'); gc.width = W; gc.height = H; glowImg = gc.getContext('2d')!.createImageData(W, H); }
  const col = new THREE.Color(), tmp = new THREE.Color();
  const ocean = new THREE.Color('#2378c4'), deep = new THREE.Color('#0f3f78'), snow = new THREE.Color('#f2f6ff');
  const bandShift = rng(seed)() * 10;

  for (let y = 0; y < H; y++) {
    const lat = (y / (H - 1) - 0.5) * Math.PI;
    for (let x = 0; x < W; x++) {
      const lon = (x / W) * Math.PI * 2;
      const px = Math.cos(lat) * Math.cos(lon), py = Math.sin(lat), pz = Math.cos(lat) * Math.sin(lon);
      const s = 2.2;
      let glow = 0;
      switch (biome.kind) {
        case 'gas':
        case 'storm': {
          // bandas por latitud deformadas por turbulencia; las tormentas añaden óvalos y más contraste
          const turb = warp(px * 3, py * 3, pz * 3, 4) - 0.5;
          const bands = Math.sin((py + turb * (biome.kind === 'storm' ? 0.35 : 0.18)) * (biome.kind === 'storm' ? 9 : 14) + bandShift);
          const fine = fbm(px * 6, py * 22, pz * 6, 3);
          let t = 0.5 + bands * 0.32 + (fine - 0.5) * 0.5;
          if (biome.kind === 'storm') {
            const eye = fbm(px * 1.6 + 3, py * 1.6, pz * 1.6, 3);
            t += sstep(0.62, 0.72, eye) * 0.45;
          }
          ramp(pal, t, col);
          break;
        }
        case 'ice': {
          const n = fbm(px * s, py * s, pz * s);
          const cracks = 1 - Math.abs(warp(px * 5, py * 5, pz * 5, 3) - 0.5) * 2;
          ramp(pal, 0.45 + (n - 0.5) * 1.3, col);
          col.lerp(tmp.copy(pal[0]), sstep(0.86, 0.97, cracks) * 0.6);
          col.lerp(snow, sstep(0.55, 0.9, Math.abs(py)) * 0.85);
          break;
        }
        case 'ocean': {
          const h = fbm(px * s + warp(px, py, pz, 3) * 0.8, py * s, pz * s);
          if (h < 0.5) col.copy(deep).lerp(ocean, sstep(0.3, 0.5, h)).lerp(tmp.copy(pal[0]), 0.2);
          else ramp(pal, Math.min(0.72, 0.4 + (h - 0.5) * 1.8), col);
          col.lerp(snow, sstep(0.84, 0.95, Math.abs(py) + (h - 0.5) * 0.3));
          // nubes
          const cl = fbm(px * 4 + 9, py * 5, pz * 4, 4);
          col.lerp(snow, sstep(0.62, 0.8, cl) * 0.5);
          break;
        }
        case 'desert': {
          const h = fbm(px * s, py * s, pz * s);
          const dunes = Math.sin((px + py * 0.4) * 30 + warp(px * 3, py * 3, pz * 3) * 6) * 0.05;
          ramp(pal, 0.2 + h * 0.9 + dunes, col);
          const crater = warp(px * 7, py * 7, pz * 7, 2);
          col.multiplyScalar(1 - sstep(0.7, 0.78, crater) * 0.35);
          col.lerp(snow, sstep(0.86, 0.95, Math.abs(py)) * 0.7);
          break;
        }
        case 'lava': {
          const h = fbm(px * s, py * s, pz * s);
          ramp(pal, h * 0.7, col);
          const vein = 1 - Math.abs(warp(px * 4, py * 4, pz * 4, 4) - 0.5) * 2;
          glow = sstep(0.82, 0.96, vein) * (0.6 + h * 0.6);
          col.lerp(tmp.copy(pal[2]), glow * 0.85);
          break;
        }
        default: {
          const h = fbm(px * s * 1.4, py * s * 1.4, pz * s * 1.4);
          ramp(pal, 0.15 + h * 0.85, col);
          const crater = warp(px * 8, py * 8, pz * 8, 2);
          col.multiplyScalar(1 - sstep(0.68, 0.76, crater) * 0.4 + sstep(0.76, 0.8, crater) * 0.15);
        }
      }
      const i = (y * W + x) * 4;
      img.data[i] = Math.round(clamp01(col.r) * 255);
      img.data[i + 1] = Math.round(clamp01(col.g) * 255);
      img.data[i + 2] = Math.round(clamp01(col.b) * 255);
      img.data[i + 3] = 255;
      if (glowImg) {
        const k = Math.round(glow * 255);
        glowImg.data[i] = k; glowImg.data[i + 1] = Math.round(k * 0.45); glowImg.data[i + 2] = Math.round(k * 0.12); glowImg.data[i + 3] = 255;
      }
    }
  }
  g.putImageData(img, 0, 0);
  const tex = (cv: HTMLCanvasElement) => {
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.anisotropy = 4;
    return t;
  };
  let glowTex: THREE.Texture | null = null;
  if (gc && glowImg) { gc.getContext('2d')!.putImageData(glowImg, 0, 0); glowTex = tex(gc); }
  const out = { map: tex(c), glow: glowTex };
  cache.set(key, out);
  return out;
}

/** material del planeta: superficie con relieve de luz y, en los volcánicos, lava que brilla */
export function planetMaterial(biome: Biome, variant: number): THREE.MeshStandardMaterial {
  const { map, glow } = planetTextures(biome, variant);
  const gassy = biome.kind === 'gas' || biome.kind === 'storm';
  return new THREE.MeshStandardMaterial({
    map,
    roughness: gassy ? 0.9 : biome.kind === 'ice' ? 0.45 : 0.85,
    metalness: 0,
    // la propia textura brilla un poco: la cara de noche se intuye en vez de quedar negra
    emissive: 0xffffff,
    emissiveMap: glow ?? map,
    emissiveIntensity: glow ? 1.6 : 0.22,
  });
}

/**
 * Atmósfera instanciada: un halo de Fresnel (más intenso en el borde) del color de cada instancia, que es el
 * estado del proyecto. Así el estado se sigue leyendo sin pintar encima de la superficie del planeta.
 */
export function atmosphereMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vC;
      void main(){
        mat4 m = modelMatrix * instanceMatrix;
        vec4 wp = m * vec4(position, 1.0);
        vN = normalize(mat3(m) * normal);
        vV = normalize(cameraPosition - wp.xyz);
        #ifdef USE_INSTANCING_COLOR
          vC = instanceColor;
        #else
          vC = vec3(1.0);
        #endif
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `varying vec3 vN; varying vec3 vV; varying vec3 vC;
      void main(){
        float f = 1.0 - max(dot(normalize(vN), normalize(vV)), 0.0);
        float a = pow(f, 2.6) * 1.15;
        gl_FragColor = vec4(vC * a, a);
      }`,
  });
}
