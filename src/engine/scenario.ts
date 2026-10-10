// Сценарий смены: 3 поста MAG-сварки, 8 ч с обедом. Все численные параметры — [Д] условные, кроме помеченных.
import type { SimParams, Mode } from './sim.ts';
import { m3h } from './physics.ts';
import { balance } from './balance.ts';
import { demoNetwork } from './demo-network.ts';

/** Таблица упреждения: расчётная частота вентилятора для каждого набора работающих постов (по установившемуся режиму блока 2) */
export function feedforwardTable(ids: string[], Qset: number) {
  const cache = new Map<string, number>();
  return (active: string[]) => {
    const key = active.join(',');
    if (!cache.has(key)) {
      const req = Object.fromEntries(ids.map(id => [id, active.includes(id) ? Qset : 0]));
      cache.set(key, balance(demoNetwork(), req).fanSpeed);
    }
    return cache.get(key)!;
  };
}

/** Детерминированное псевдослучайное расписание: дуга горит отрезками 1–5 мин, паузы 1–7 мин;
 *  обед 4:00–5:00 — все посты выключены. Доля горения ~40–45 % — порядок значений для MIG/MAG по данным TWI. */
export function makeSchedule(ids: string[], duration: number, seed = 7) {
  let x = seed; const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  const iv: Record<string, Array<[number, number]>> = {};
  for (const id of ids) {
    iv[id] = []; let t = rnd() * 300;
    while (t < duration) { const on = 60 + rnd() * 240; iv[id].push([t, t + on]); t += on + 60 + rnd() * 360; }
  }
  return (id: string, t: number) => !(t >= 4 * 3600 && t < 5 * 3600) && iv[id].some(([a, b]) => t >= a && t < b);
}

/** Пусконаладка: балансировка ветвей при расчётном режиме (все посты по 1500 м³/ч) — фиксированные углы и частота */
export function commissioning() {
  const b = balance(demoNetwork(), { post1: m3h(1500), post2: m3h(1500), post3: m3h(1500) });
  return { angles: b.angles, n: b.fanSpeed, pSet: b.sol.pFan - b.sol.segLoss['common'] };
}

export function shiftParams(mode: Mode, pSet?: number, balanced = true): SimParams {
  const c0 = commissioning(), com = balanced ? c0 : null;
  const ids = ['post1', 'post2', 'post3'];
  const duration = 8 * 3600;
  return {
    mode, dt: 1, duration, schedule: makeSchedule(ids, duration), record: 10,
    posts: ids.map(id => ({ id, B: 3, Qset: m3h(1500), etaNom: 0.9 })),       // 1500 м³/ч — ГОСТ 12.3.003-86 п. 2.11.1
    substances: [
      { name: 'Mn', g: 1.90, pdk: 0.2, qIn: 0.001 },   // Св-08Г2С, блок 1
      { name: 'Fe2O3', g: 7.67, pdk: 6, qIn: 0.04 },
    ],
    room: { V: 48 * 24 * 14.4, Lgen: m3h(8600), dT: 19.7 },  // Δt = 18 − (−1,7): t_в = 18 °C [Д]; −1,7 °C — средняя за отопительный период (≤ 8 °C, 202 сут), Москва, СП 131.13330.2025, табл. 3.1
    // объём цеха из диплома; общеобменная — по блоку 1 (η = 0,9, 3 поста)
    damperStroke: 8,  // 8 с — время хода заслонки Plymovent AD (паспорт); одинаково для сравнения режимов
    fanRamp: 10, nMax: 1500, nMin: 300, pSet: pSet ?? c0.pSet, kI: 4,   // уставка разрежения — из пусконаладки, если не задана
    nFF: mode === 'adaptive' ? feedforwardTable(ids, m3h(1500)) : undefined,
    openAngles: com ? com.angles : undefined, nConst: com ? com.n : undefined,
  };
}
