import { describe, expect, it } from 'vitest';
import { searchTargets, type SearchTarget } from '../src/world/search';

const T = (kind: SearchTarget['kind'], label: string, sub = '', tags = ''): SearchTarget => ({ kind, ref: label, label, sub, tags, x: 0, z: 0, standoff: 5 });
const list = [
  T('galaxy', 'Núcleo de Consenso', 'Galaxia'),
  T('node', 'Stellar Consensus Protocol', 'Núcleo de Consenso'),
  T('project', 'Soroswap', 'Galaxia DeFi · En producción', 'DEX'),
  T('project', 'Blend', 'Galaxia DeFi · En producción', 'Lending'),
  T('partner', 'MoneyGram Access', 'Cúmulo de Pagos · socio', 'on-off-ramp'),
];

describe('buscador del universo', () => {
  it('ignora acentos y mayúsculas', () => {
    expect(searchTargets(list, 'nucleo')[0].label).toBe('Núcleo de Consenso');
  });
  it('prioriza el nombre que empieza por la consulta', () => {
    expect(searchTargets(list, 'sor')[0].label).toBe('Soroswap');
  });
  it('encuentra por tipo y exige todas las palabras', () => {
    expect(searchTargets(list, 'lending').map(t => t.label)).toEqual(['Blend']);
    expect(searchTargets(list, 'defi dex').map(t => t.label)).toEqual(['Soroswap']);
  });
  it('consulta vacía no devuelve nada', () => {
    expect(searchTargets(list, '  ')).toEqual([]);
  });
});
