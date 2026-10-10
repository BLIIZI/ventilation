// Демонстрационная сеть: 3 поста на общем коллекторе, фильтр, вентилятор.
// ВНИМАНИЕ: геометрия и характеристика вентилятора — [Д] условные, для проверки ядра.
import type { Network, Element } from './network.ts';
import { IE3_4P_GOST } from './norms.ts';
import { bendZeta, HOOD_CONE_ZETA, EXIT_ZETA } from './fittings.ts';

/** Сборка сети «посты вдоль коллектора» с поэлементным учётом местных сопротивлений (Идельчик, 1992):
 *  ветвь поста: зонт (вход) → трение по длине → отвод 90° (R/D = 1,5) → отвод 45° → заслонка → вход в коллектор
 *  (первый пост — отвод 90° в торец коллектора; остальные — боковой вход тройника на слияние);
 *  коллектор: трение → переход на больший диаметр (диффузор 15°) → проход тройника; последний участок — отвод 90° к фильтру;
 *  общий тракт: фильтр → трение → отвод 90° → выход в атмосферу (ζ = 1). [Д] — геометрия демонстрационная. */
export function chainNetwork(dPost: number[], dColl: number[], lBranch = 6, lColl = 5, lMain = 10, dOut = dColl[dColl.length - 1]): Pick<Network, 'segments' | 'hoods'> & { commonTail: Element[] } {
  const N = dPost.length, segs: Network['segments'] = [];
  const B90 = bendZeta(90, 1.5), B45 = bendZeta(45, 1.5), B90r1 = bendZeta(90, 1.0);
  for (let i = 1; i <= N; i++) {
    const db = dPost[i - 1], dc = dColl[i - 1];
    const el: Element[] = [
      { kind: 'local', id: `hood${i}`, d: db, zeta: HOOD_CONE_ZETA, label: 'вход через зонт' },
      { kind: 'duct', id: `branch${i}`, d: db, l: lBranch, zeta: 0 },
      { kind: 'local', id: `bend90_${i}`, d: db, zeta: B90, label: 'отвод 90°, R/D = 1,5' },
      { kind: 'local', id: `bend45_${i}`, d: db, zeta: B45, label: 'отвод 45°, R/D = 1,5' },
      { kind: 'damper', id: `damper${i}`, d: db, alpha: 0 },
    ];
    if (i === 1) { el.push({ kind: 'local', id: 'bend_end', d: db, zeta: B90r1, label: 'отвод 90° в торец коллектора' });
      if (dc > db) el.push({ kind: 'diffuser', id: 'trans1', d1: db, d2: dc }); }
    else el.push({ kind: 'teeSide', id: `tee${i}`, db, dc });
    segs.push({ id: `post${i}`, parent: `c${i}`, elements: el });
    const ce: Element[] = [{ kind: 'duct', id: `c${i}`, d: dc, l: i < N ? lColl : lMain, zeta: 0 }];
    if (i < N) { const dn = dColl[i]; if (dn > dc) ce.push({ kind: 'diffuser', id: `trans_c${i}`, d1: dc, d2: dn }); ce.push({ kind: 'teeStraight', id: `teeP${i + 1}`, dc: dn, side: `post${i + 1}` }); }
    else ce.push({ kind: 'local', id: 'bend_main', d: dc, zeta: B90, label: 'отвод 90° к фильтру' });
    segs.push({ id: `c${i}`, parent: i < N ? `c${i + 1}` : null, elements: ce });
  }
  return { segments: segs, hoods: Array.from({ length: N }, (_, i) => `post${i + 1}`),
    commonTail: [{ kind: 'duct', id: 'discharge', d: dOut, l: 5, zeta: 0 }, { kind: 'local', id: 'bend_out', d: dOut, zeta: B90, label: 'отвод 90°' }, { kind: 'local', id: 'exit', d: dOut, zeta: EXIT_ZETA, label: 'выход в атмосферу' }] };
}

export function demoNetwork(): Network {
  const c = chainNetwork([0.2, 0.2, 0.2], [0.25, 0.315, 0.4]);
  return {
    segments: c.segments, hoods: c.hoods,
    common: [
      { kind: 'filter', id: 'filter', spec: { dpNom: 400, qNom: 4500 / 3600, m: 1, fouling: 1 } },
      // m = 1: перегородка + слой пыли — закон Дарси (Ужов, Мягков, 1970); Δp_ном 400 Па — [Д] до паспорта фильтра
      ...c.commonTail,
    ],
    fan: { n0: 1500, eta: 0.65, points: DEMO_FAN, motorW: 2200, motorEta: 0.867 },
    // двигатель 2,2 кВт, 4 полюса, класс IE3: КПД ≥ 86,7 % (ГОСТ IEC 60034-30-1-2016, табл. 1)
    fanSpeed: 1500,
  };
}
/** Демонстрационная характеристика вентилятора (полное давление, Па, при 1500 об/мин) [Д] — заменяется каталогом */
export const DEMO_FAN: Array<[number, number]> = [[0, 1400], [2000, 1300], [4000, 1050], [5000, 850], [6000, 550], [7000, 150]];

/** Генератор сети на N постов: посты вдоль коллектора, диаметры подбираются на скорость ≈ 12 м/с при расчётном расходе.
 *  [Д] Геометрия условная; вентилятор масштабируется по расходу (характеристика демо-вентилятора × N/3). */
export function makeNetwork(N: number, Qpost = 1500, wDesign = 12): Network {
  return makeNetworkFor(Array(N).fill(Qpost), 1, wDesign);
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
  const q = Qposts.map(x => Math.max(x, 50));
  let cum = 0; const dColl = q.map(x => dFor((cum += x)));
  const dPost = q.map(dFor);
  const c = chainNetwork(dPost, dColl.map((d, i) => Math.max(d, dPost[i])));
  const total = cum, s = total / 4500 * fanScale, ps = fanScale;   // запас по расходу и давлению
  return {
    segments: c.segments, hoods: c.hoods,
    common: [{ kind: 'filter', id: 'filter', spec: { dpNom: 400, qNom: total / 3600, m: 1, fouling: 1 } }, ...c.commonTail],
    fan: { n0: 1500, eta: 0.65, points: DEMO_FAN.map(([x, p]) => [x * s, p * ps] as [number, number]), ...pickMotor(1900 * s * ps) },
    fanSpeed: 1500,
  };
}
