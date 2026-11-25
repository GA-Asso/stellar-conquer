// Íconos de módulos y unidades: el mismo símbolo flota sobre el módulo en 3D y aparece en los botones del HUD.
import * as THREE from 'three';
import type { ModuleType, UnitType } from '../sim/types';

export const MODULE_GLYPH: Record<ModuleType, string> = {
  core: '✦', habitat: '⌂', solar: '☀', anchor: '⚓', hangar: '✈', factory: '⚙', lab: '⚗', turret: '⌖', beacon: '✺',
};
export const UNIT_GLYPH: Record<UnitType, string> = {
  drone: '◇', interceptor: '➤', mecha: '♜', frigate: '⛴', titan: '♛', dreadnought: '✠',
};

const cache = new Map<string, THREE.SpriteMaterial>();

export function iconSprite(glyph: string, color: string): THREE.Sprite {
  const key = glyph + color;
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
    x.fillStyle = color;
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
