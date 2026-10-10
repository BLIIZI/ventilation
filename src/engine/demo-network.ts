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
      { kind: 'filter', id: 'filter', spec: { dpNom: 400, qNom: 4500 / 3600, m: 1, fouling: 1 } },
      // m = 1: фильтрующий материал + слой пыли — закон Дарси, Δp = S·V при неизменной пылевой нагрузке (US EPA, Air Pollution Control Cost Manual, разд. 6, гл. 1, ур. 1.1, 1.3)
      { kind: 'duct', id: 'discharge', d: 0.4, l: 5, zeta: 1.0 },
    ],
    fan: { n0: 1500, eta: 0.65, points: [[0, 1400], [2000, 1300], [4000, 1050], [5000, 850], [6000, 550], [7000, 150]], motorW: 2200, motorEta: 0.867 },
    // двигатель 2,2 кВт, 4 полюса, класс IE3: КПД ≥ 86,7 % (ГОСТ Р МЭК 60034-30-1 / IEC 60034-30-1, табл. 3); макс. мощность на валу ≈ 1,9 кВт
    fanSpeed: 1500,
  };
}

/** Генератор сети на N постов: посты вдоль коллектора, диаметры подбираются на скорость ≈ 12 м/с при расчётном расходе.
 *  [Д] Геометрия условная; вентилятор масштабируется по расходу (характеристика демо-вентилятора × N/3). */
export function makeNetwork(N: number, Qpost = 1500, wDesign = 12): Network {
  const dFor = (Qm3h: number) => Math.max(0.1, Math.round(Math.sqrt(4 * (Qm3h / 3600) / (Math.PI * wDesign)) * 1000 / 5) * 5 / 1000);
  const segs: Network['segments'] = [];
  for (let i = 1; i <= N; i++) {
    segs.push({ id: `post${i}`, parent: `c${i}`, elements: [
      { kind: 'duct', id: `hood${i}`, d: dFor(Qpost), l: 6, zeta: 1.5 },
      { kind: 'damper', id: `damper${i}`, d: dFor(Qpost), alpha: 0 },
    ] });
    segs.push({ id: `c${i}`, parent: i < N ? `c${i + 1}` : null, elements: [
      { kind: 'duct', id: `c${i}`, d: dFor(Qpost * i), l: i < N ? 5 : 10, zeta: i < N ? 0.2 : 0.5 },
    ] });
  }
  const s = N / 3;
  return {
    segments: segs, hoods: Array.from({ length: N }, (_, i) => `post${i + 1}`),
    common: [
      { kind: 'filter', id: 'filter', spec: { dpNom: 400, qNom: N * Qpost / 3600, m: 1, fouling: 1 } },
      { kind: 'duct', id: 'discharge', d: dFor(Qpost * N), l: 5, zeta: 1.0 },
    ],
    fan: { n0: 1500, eta: 0.65, points: ([[0, 1400], [2000, 1300], [4000, 1050], [5000, 850], [6000, 550], [7000, 150]] as Array<[number, number]>).map(([q, p]) => [q * s, p] as [number, number]), ...pickMotor(1900 * s) },
    fanSpeed: 1500,
  };
}

/** Двигатели IE3, 4 полюса, 50 Гц: номинальная мощность, Вт → минимальный КПД (IEC 60034-30-1, табл. 3) */
export const IE3_4P: Array<[number, number]> = [[750, 0.825], [1100, 0.841], [1500, 0.853], [2200, 0.867], [3000, 0.877], [4000, 0.886], [5500, 0.896], [7500, 0.904], [11000, 0.914], [15000, 0.921], [18500, 0.926], [22000, 0.930], [30000, 0.936], [37000, 0.939], [45000, 0.942], [55000, 0.946], [75000, 0.950]];
/** Подбор двигателя: ближайший стандартный ≥ максимальной мощности на валу */
export function pickMotor(maxShaftW: number) {
  const m = IE3_4P.find(([w]) => w >= maxShaftW) ?? IE3_4P[IE3_4P.length - 1];
  return { motorW: m[0], motorEta: m[1] };
}
