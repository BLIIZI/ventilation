// Блок 4: смена с переменным током сварки, общеобменная вентиляция по потребности.
import type { SimParams, GenVent } from './sim.ts';
import { m3h } from './physics.ts';
import { shiftParams } from './scenario.ts';

/** Расход проволоки ER70S-6 Ø1,2 мм (аналог Св-08Г2С [Д]) от тока: 175 А — 1,68; 225 А — 2,36; 270 А — 3,73 кг/ч.
 *  Источник: materialwelding.com (ориентировочные значения, без ссылки на испытания) — [П] уточнить по данным производителя. */
export const WIRE_12: Array<[number, number]> = [[175, 1.68], [225, 2.36], [270, 3.73]];

/** Те же интервалы горения дуги, что в блоке 3; каждому интервалу — свой режим (175/225/270 А) */
export function makeShift(ids: string[], duration: number, seed = 7) {
  let x = seed; const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  const iv: Record<string, Array<[number, number, number]>> = {};
  for (const id of ids) {
    iv[id] = []; let t = rnd() * 300;
    while (t < duration) { const on = 60 + rnd() * 240; const I = [175, 225, 270][Math.floor(rnd() * 3)]; iv[id].push([t, t + on, I]); t += on + 60 + rnd() * 360; }
  }
  const lunch = (t: number) => t >= 4 * 3600 && t < 5 * 3600;
  return {
    schedule: (id: string, t: number) => !lunch(t) && iv[id].some(([a, b]) => t >= a && t < b),
    current: (id: string) => (t: number) => { const r = iv[id].find(([a, b]) => t >= a && t < b); return r && !lunch(t) ? r[2] : 0; },
  };
}

export const MN = { name: 'Mn', g: 1.90, pdk: 0.2, qIn: 0.001 };   // СанПиН 1.2.3685-21, табл. 2.1, стр. 1222 (Mn ≤ 20 %)
export const AER = { name: 'aerosol', g: 10.0, pdk: 1e9, qIn: 0 };   // сварочный аэрозоль, общая масса (для датчика)

/** Расчётный (проектный) расход ОВ: все 3 поста одновременно на максимальном режиме 270 А, C = ПДК (блок 1) */
export function designLgen(eta = 0.9, n = 3) {
  const G = n * (1 - eta) * MN.g * 1000 * 3.73 / 3600; // мг/с
  return G / (MN.pdk - MN.qIn);
}

export function shift4(mode: GenVent['mode'], opts: { Cset?: number; etaReal?: number } = {}): SimParams {
  const ids = ['post1', 'post2', 'post3'];
  const base = shiftParams('adaptive', 351);
  const sh = makeShift(ids, base.duration);
  const Ld = designLgen();
  return {
    ...base, schedule: sh.schedule, wire: WIRE_12,
    posts: ids.map(id => ({ id, B: 0, Qset: m3h(1500), etaNom: 0.9, etaReal: opts.etaReal, current: sh.current(id) })),
    substances: [MN, AER],
    gen: {
      mode, Ldesign: Ld, Lmin: 0.2 * Ld, Lmax: 1.5 * Ld, limiting: 'Mn', Cset: opts.Cset ?? 0.5 * MN.pdk,
      sensor: { of: 'aerosol', ratio: MN.g / AER.g, tau: 30, noise: 0.1 },   // [Д] датчик: τ = 30 с, шум ±10 %
      kP: 0.5, kI: 0.005, ffTau: 600, dpDesign: 600, etaFan: 0.6, ramp: 20,  // [Д]; ffTau, kI подобраны на модели (таблица настройки в блоке 4)
    },
  };
}
