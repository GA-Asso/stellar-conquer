// Íconos de módulos y unidades: el mismo símbolo flota sobre el módulo en 3D y aparece en los botones del HUD.
import * as THREE from 'three';
import type { ModuleType, UnitType } from '../sim/types';

export const MODULE_GLYPH: Record<ModuleType, string> = {
  core: '✦', habitat: '⌂', solar: '☀', anchor: '⚓', hangar: '✈', factory: '⚙', lab: '⚗', turret: '⌖', beacon: '✺',
  seti: '≋', replicator: '⟁', shield: '⛨', dyson: '☼', matrioshka: '◎',
};
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
export const UNIT_GLYPH: Record<UnitType, string> = {
  drone: '◇', interceptor: '➤', mecha: '♜', frigate: '⛴', titan: '♛', dreadnought: '✠',
};

const cache = new Map<string, THREE.SpriteMaterial>();

/** `color` es el marco (bando) y `glyphColor` el símbolo (función del módulo) */
export function iconSprite(glyph: string, color: string, glyphColor = color): THREE.Sprite {
  const key = glyph + color + glyphColor;
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
    x.fillStyle = glyphColor;
    x.font = '64px "Apple Symbols", "Segoe UI Symbol", "Noto Sans Symbols 2", sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(glyph, 64, 68);
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
