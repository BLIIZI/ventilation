// Демонстрационная сеть: 3 поста на общем коллекторе, фильтр, вентилятор.
// ВНИМАНИЕ: геометрия и характеристика вентилятора — [Д] условные, для проверки ядра.
import type { Network } from './network.ts';
import { IE3_4P_GOST } from './norms.ts';

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
      // m = 1: перегородка + слой пыли — закон Дарси (Ужов, Мягков, 1970); Δp_ном 400 Па — [Д] до паспорта фильтра
      { kind: 'duct', id: 'discharge', d: 0.4, l: 5, zeta: 1.0 },
    ],
    fan: { n0: 1500, eta: 0.65, points: [[0, 1400], [2000, 1300], [4000, 1050], [5000, 850], [6000, 550], [7000, 150]], motorW: 2200, motorEta: 0.867 },
    // двигатель 2,2 кВт, 4 полюса, класс IE3: КПД ≥ 86,7 % (ГОСТ IEC 60034-30-1-2016, табл. 1); макс. мощность на валу ≈ 1,9 кВт
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

/** Двигатели IE3, 4 полюса, 50 Гц: номинальная мощность, Вт → минимальный КПД (ГОСТ IEC 60034-30-1-2016, табл. 1) */
export const IE3_4P = IE3_4P_GOST;   // ГОСТ IEC 60034-30-1-2016, табл. 1
/** Подбор двигателя: ближайший стандартный ≥ максимальной мощности на валу */
export function pickMotor(maxShaftW: number) {
  const m = IE3_4P.find(([w]) => w >= maxShaftW) ?? IE3_4P[IE3_4P.length - 1];
  return { motorW: m[0], motorEta: m[1] };
}

/** Сеть под произвольные расходы постов (м³/ч): диаметры — на ≈ 12 м/с, вентилятор — демо-характеристика × k (k подбирается в plant.ts). [Д] */
export function makeNetworkFor(Qposts: number[], fanScale = 1, wDesign = 12): Network {
  const dFor = (Qm3h: number) => Math.max(0.1, Math.round(Math.sqrt(4 * (Qm3h / 3600) / (Math.PI * wDesign)) * 1000 / 5) * 5 / 1000);
  const N = Qposts.length, segs: Network['segments'] = [];
  let cum = 0;
  for (let i = 1; i <= N; i++) {
    const q = Math.max(Qposts[i - 1], 50); cum += q;
    segs.push({ id: `post${i}`, parent: `c${i}`, elements: [
      { kind: 'duct', id: `hood${i}`, d: dFor(q), l: 6, zeta: 1.5 },
      { kind: 'damper', id: `damper${i}`, d: dFor(q), alpha: 0 },
    ] });
    segs.push({ id: `c${i}`, parent: i < N ? `c${i + 1}` : null, elements: [
      { kind: 'duct', id: `c${i}`, d: dFor(cum), l: i < N ? 5 : 10, zeta: i < N ? 0.2 : 0.5 },
    ] });
  }
  const total = Qposts.reduce((a, b) => a + Math.max(b, 50), 0), s = total / 4500 * fanScale, ps = fanScale;   // запас по расходу и давлению
  return {
    segments: segs, hoods: Array.from({ length: N }, (_, i) => `post${i + 1}`),
    common: [
      { kind: 'filter', id: 'filter', spec: { dpNom: 400, qNom: total / 3600, m: 1, fouling: 1 } },
      { kind: 'duct', id: 'discharge', d: dFor(total), l: 5, zeta: 1.0 },
    ],
    fan: { n0: 1500, eta: 0.65, points: ([[0, 1400], [2000, 1300], [4000, 1050], [5000, 850], [6000, 550], [7000, 150]] as Array<[number, number]>).map(([q, p]) => [q * s, p * ps] as [number, number]), ...pickMotor(1900 * s * ps) },
    fanSpeed: 1500,
  };
}
