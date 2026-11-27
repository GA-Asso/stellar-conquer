// Buscador del Universo: galaxias, nodos del mapa, proyectos del atlas y socios en un solo índice.
// Lógica pura (sin DOM ni Three.js) para poder probarla: el Universo aporta las posiciones.

export type TargetKind = 'galaxy' | 'node' | 'project' | 'partner';

export interface SearchTarget {
  kind: TargetKind;
  /** id estable: id de galaxia o nodo, o índice del astro en el atlas */
  ref: string | number;
  label: string;
  /** línea secundaria: galaxia, tipo, estado */
  sub: string;
  /** texto extra que también se busca (tipos, categoría) pero no se muestra */
  tags?: string;
  x: number;
  z: number;
  /** distancia a la que se detiene la nave para no quedar encima del objetivo */
  standoff: number;
  color?: string;
}

/** minúsculas y sin acentos, para que "nucleo" encuentre "Núcleo" */
export const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const KIND_RANK: Record<TargetKind, number> = { galaxy: 0, node: 1, project: 2, partner: 3 };

/**
 * Devuelve los mejores resultados para `query`. Puntúa más alto un nombre que empieza por la consulta,
 * después una palabra del nombre que empieza por ella, después cualquier coincidencia en el nombre y por
 * último coincidencias en los tags. Todas las palabras de la consulta tienen que aparecer.
 */
export function searchTargets(targets: SearchTarget[], query: string, limit = 8): SearchTarget[] {
  const q = fold(query);
  if (!q) return [];
  const words = q.split(/\s+/).filter(Boolean);
  const scored: { t: SearchTarget; score: number }[] = [];
  for (const t of targets) {
    const name = fold(t.label);
    const hay = name + ' ' + fold(t.sub) + ' ' + fold(t.tags ?? '');
    if (!words.every(w => hay.includes(w))) continue;
    let score = 0;
    if (name === q) score = 100;
    else if (name.startsWith(q)) score = 80;
    else if (name.split(/[\s\-·.]+/).some(p => p.startsWith(words[0]))) score = 60;
    else if (name.includes(q)) score = 40;
    else score = 10;
    score -= KIND_RANK[t.kind] * 2;
    scored.push({ t, score });
  }
  scored.sort((a, b) => b.score - a.score || a.t.label.length - b.t.label.length || a.t.label.localeCompare(b.t.label));
  return scored.slice(0, limit).map(x => x.t);
}
