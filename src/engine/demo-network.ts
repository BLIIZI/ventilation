// Демонстрационная сеть: 3 поста на общем коллекторе, фильтр, вентилятор.
// ВНИМАНИЕ: геометрия и характеристика вентилятора — [Д] условные, для проверки ядра.
import type { Network } from './network.ts';

export function demoNetwork(): Network {
  const post = (i: number, parent: string) => ({
    id: `post${i}`, parent,
    elements: [
      { kind: 'duct' as const, id: `hood${i}`, d: 0.2, l: 6, zeta: 1.5 },   // отсос + отвод + вход в тройник
      { kind: 'damper' as const, id: `damper${i}`, d: 0.2, alpha: 0 },
    ],
  });
  return {
    segments: [
      post(1, 'c1'), post(2, 'c2'), post(3, 'c3'),
      { id: 'c1', parent: 'c2', elements: [{ kind: 'duct', id: 'c1', d: 0.25, l: 5, zeta: 0.2 }] },
      { id: 'c2', parent: 'c3', elements: [{ kind: 'duct', id: 'c2', d: 0.315, l: 5, zeta: 0.2 }] },
      { id: 'c3', parent: null, elements: [{ kind: 'duct', id: 'main', d: 0.4, l: 10, zeta: 0.5 }] },
    ],
    hoods: ['post1', 'post2', 'post3'],
    common: [
      { kind: 'filter', id: 'filter', spec: { dpNom: 400, qNom: 4500 / 3600, m: 2, fouling: 1 } },
      { kind: 'duct', id: 'discharge', d: 0.4, l: 5, zeta: 1.0 },
    ],
    fan: { n0: 1500, eta: 0.65, points: [[0, 1400], [2000, 1300], [4000, 1050], [5000, 850], [6000, 550], [7000, 150]] },
    fanSpeed: 1500,
  };
}
