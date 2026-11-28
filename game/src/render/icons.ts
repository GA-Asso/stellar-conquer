// Íconos de módulos y unidades: el mismo símbolo flota sobre el módulo en 3D y aparece en los botones del HUD.
import * as THREE from 'three';
import type { ModuleType, UnitType } from '../sim/types';

/**
 * Íconos vectoriales propios (rejilla 24×24, solo trazo): se ven igual en cualquier sistema, a diferencia de
 * los símbolos Unicode, que dependían de la fuente. La misma ruta se dibuja en el HUD (SVG) y en 3D (Path2D).
 */
export const ICON_PATHS: Record<string, string[]> = {
  // módulos
  core: ['M12 2l2.6 7.4L22 12l-7.4 2.6L12 22l-2.6-7.4L2 12l7.4-2.6z', 'M12 9.5v5', 'M9.5 12h5'],
  habitat: ['M3 11l9-7 9 7', 'M5 9.5V20h14V9.5', 'M10 20v-5h4v5'],
  solar: ['M3 15h18l-2.5-9h-13z', 'M12 6v9', 'M4.4 10.5h15.2', 'M12 15v5', 'M8 20h8'],
  anchor: ['M12 3v10', 'M8 9l4 4 4-4', 'M4 14v6h16v-6', 'M8 17h8'],
  hangar: ['M12 2c3 3 4.5 7 4.5 11L12 16l-4.5-3C7.5 9 9 5 12 2z', 'M7.5 12L4 15.5V19l3.5-2', 'M16.5 12l3.5 3.5V19l-3.5-2', 'M12 7.5v2', 'M10.5 19L12 22l1.5-3'],
  factory: ['M5 9h14v10H5z', 'M9 13h1', 'M14 13h1', 'M9 16h6', 'M12 9V5', 'M10 4h4', 'M3 12v4', 'M21 12v4'],
  lab: ['M9 3h6', 'M10 3v6l-5.4 9.2A2 2 0 0 0 6.3 21h11.4a2 2 0 0 0 1.7-2.8L14 9V3', 'M7.2 15h9.6'],
  turret: ['M12 5a7 7 0 1 0 0 14a7 7 0 1 0 0-14z', 'M12 2v6', 'M12 16v6', 'M2 12h6', 'M16 12h6'],
  beacon: ['M5 21V3', 'M5 4h12l-2.5 4.5L17 13H5', 'M3 21h6'],
  seti: ['M3.5 10.5a9 9 0 0 0 10 10z', 'M8.5 15.5L14 10', 'M15 3.5a5.5 5.5 0 0 1 5.5 5.5', 'M15 7a2 2 0 0 1 2 2', 'M8 21h8'],
  replicator: ['M8 3l4.5 4.5L8 12 3.5 7.5z', 'M16 12l4.5 4.5L16 21l-4.5-4.5z', 'M12.5 7.5h4.5v4', 'M11.5 16.5H7v-4'],
  shield: ['M12 3l8 3v6c0 5-3.5 8.2-8 9.5C7.5 20.2 4 17 4 12V6z', 'M8.5 12l2.5 2.5 4.5-5'],
  dyson: ['M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z', 'M2 12a10 4 0 1 0 20 0a10 4 0 1 0-20 0', 'M12 2v3', 'M12 19v3'],
  matrioshka: ['M7 7h10v10H7z', 'M10 10h4v4h-4z', 'M9.5 3v4', 'M14.5 3v4', 'M9.5 17v4', 'M14.5 17v4', 'M3 9.5h4', 'M3 14.5h4', 'M17 9.5h4', 'M17 14.5h4'],
  // unidades
  drone: ['M12 4l6 8-6 8-6-8z', 'M12 9v6', 'M3 6h4', 'M17 6h4'],
  interceptor: ['M3 12l18-8-5.5 8 5.5 8z', 'M15.5 12H9'],
  mecha: ['M8.5 3h7v5h-7z', 'M5.5 8h13v7h-13z', 'M9 15l-2 6', 'M15 15l2 6', 'M10.5 11.5h3'],
  frigate: ['M2.5 15h19l-3 4.5h-13z', 'M6.5 15v-5h8.5l3 5', 'M10 10V6h3.5v4'],
  titan: ['M9.5 2h5v5h-5z', 'M4 7h16v8H4z', 'M4 7V4.5', 'M20 7V4.5', 'M8 15l-2 7', 'M16 15l2 7', 'M10 11h4'],
  dreadnought: ['M2 13h20l-4 5.5H6z', 'M5 13V9h14v4', 'M9 9V5h6v4', 'M12 5V2', 'M8 16h.5', 'M12 16h.5', 'M16 16h.5'],
  // acciones
  era: ['M12 20V5', 'M6 11l6-6 6 6', 'M5 21h14'],
};

/** ícono como SVG en línea; toma el color del texto (currentColor) */
export function svgIcon(name: string): string {
  return `<svg class="vi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${(ICON_PATHS[name] ?? []).map(d => `<path d="${d}"/>`).join('')}</svg>`;
}

const svgOf = <K extends string>(keys: readonly K[]) => Object.fromEntries(keys.map(k => [k, svgIcon(k)])) as Record<K, string>;
export const MODULE_GLYPH: Record<ModuleType, string> = svgOf(['core', 'habitat', 'solar', 'anchor', 'hangar', 'factory', 'lab', 'turret', 'beacon', 'seti', 'replicator', 'shield', 'dyson', 'matrioshka'] as const);
/**
 * Función de cada módulo. Cada función tiene un color propio que se repite en la base del edificio, en su
 * ícono flotante y en el botón de construir: así una estación grande se lee por zonas y no se confunde.
 */
export type ModuleRole = 'core' | 'eco' | 'pop' | 'mil' | 'def' | 'tech';
export const MODULE_ROLE: Record<ModuleType, ModuleRole> = {
  core: 'core', habitat: 'pop', solar: 'eco', anchor: 'eco', seti: 'eco', dyson: 'eco',
  hangar: 'mil', factory: 'mil', turret: 'def', shield: 'def',
  lab: 'tech', replicator: 'tech', matrioshka: 'tech', beacon: 'tech',
};
export const ROLE_INFO: Record<ModuleRole, { label: string; color: string }> = {
  core: { label: 'Mando', color: '#fdda24' },
  eco: { label: 'Economía', color: '#ffb547' },
  pop: { label: 'Población', color: '#4ade80' },
  mil: { label: 'Militar', color: '#ff5a4e' },
  def: { label: 'Defensa', color: '#38bdf8' },
  tech: { label: 'Tecnología', color: '#a78bfa' },
};
export const UNIT_GLYPH: Record<UnitType, string> = svgOf(['drone', 'interceptor', 'mecha', 'frigate', 'titan', 'dreadnought'] as const);

const cache = new Map<string, THREE.SpriteMaterial>();

/** `icon` es el nombre en ICON_PATHS; `color` es el marco (bando) y `glyphColor` el símbolo (función del módulo) */
export function iconSprite(icon: string, color: string, glyphColor = color): THREE.Sprite {
  const key = icon + color + glyphColor;
  let mat = cache.get(key);
  if (!mat) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d')!;
    x.fillStyle = 'rgba(6,8,16,0.78)';
    x.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      x.lineTo(64 + Math.cos(a) * 58, 64 + Math.sin(a) * 58);
    }
    x.closePath();
    x.fill();
    x.lineWidth = 5;
    x.strokeStyle = color;
    x.stroke();
    // el mismo ícono vectorial del HUD, escalado de 24 a 64 px y centrado
    x.save();
    x.translate(32, 32);
    x.scale(64 / 24, 64 / 24);
    x.strokeStyle = glyphColor;
    x.lineWidth = 2.1;
    x.lineCap = 'round';
    x.lineJoin = 'round';
    for (const d of ICON_PATHS[icon] ?? []) x.stroke(new Path2D(d));
    x.restore();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.9, sizeAttenuation: false });
    cache.set(key, mat);
  }
  const s = new THREE.Sprite(mat);
  // tamaño fijo en pantalla: no tapa el módulo al acercarse
  s.scale.setScalar(0.034);
  return s;
}
