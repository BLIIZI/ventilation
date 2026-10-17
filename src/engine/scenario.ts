// Сценарий смены: 3 поста MAG-сварки, 8 ч с обедом. Все численные параметры — [Д] условные, кроме помеченных.
import type { SimParams, Mode } from './sim.ts';
import { m3h, fanPressure } from './physics.ts';
import { balance, anglesForSpeed } from './balance.ts';
import { demoNetwork } from './demo-network.ts';
import { ETA_LEV_DEFAULT, Q_POST_MIN_M3H, SV08G2S, PDK_MN_WELD_LE20, MN_ATM_SS, MOSCOW_HEATING, T_IN_WINTER, wireRate, sp60General } from './norms.ts';

/** Базовый режим сварки блока 3: ток 225 А, проволока Св-08Г2С Ø1,2 мм, вылет 15 мм → B = α_р·I (norms.ts) */
export const I_BASE = 225;
export const B_BASE = wireRate(I_BASE);
/** Общеобменная вентиляция по СП 60.13330.2020: L_оо = L − L_wz, L = L_wz + (m − L_wz(q_wz − q_in))/(q_l − q_in);
 *  m = n·(1−η)·g_Mn·B — марганец, попавший в цех; L_wz = n·1500 м³/ч — местные отсосы (они тоже разбавляют воздух цеха) */
export function genVentByFormula(n = 3, eta = ETA_LEV_DEFAULT, B = B_BASE, QpostM3h = Q_POST_MIN_M3H) {
  const m = n * (1 - eta) * SV08G2S.mn * 1000 * B / 3600;   // мг/с
  return sp60General(m, n * QpostM3h / 3600, PDK_MN_WELD_LE20.ss, MN_ATM_SS);   // м³/с
}

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
/** Пусконаладка демо-сети (3 поста × 1500 м³/ч).
 *  angles, n — режим минимального давления (критическая заслонка открыта) — нужен регуляторам;
 *  nNom, fixedAngles — «стандарт» без регулирования: вентилятор на номинальной частоте, заслонки зажаты на углы, при которых каждый пост получает норму.
 *  Демо-характеристика вентилятора имеет запас ≈ 19 % по давлению; чтобы стандарт соответствовал правилу подбора «запас 10 %» (FAN_MARGIN, plant.ts),
 *  номинальной считается частота, при которой p(Q_треб) = 1,1·p_треб — по законам подобия это тот же вентилятор, подобранный с запасом 10 % [Д]. */
export function commissioning() {
  const req = { post1: m3h(1500), post2: m3h(1500), post3: m3h(1500) };
  const b = balance(demoNetwork(), req);
  const pReq = b.sol.pFan, qReq = b.sol.Qtotal, fan = demoNetwork().fan;
  let lo = b.fanSpeed, hi = 1500;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (fanPressure(fan, qReq, m) < 1.1 * pReq) lo = m; else hi = m; }
  const nNom = hi, fixed = anglesForSpeed(demoNetwork(), req, nNom);
  return { angles: b.angles, n: b.fanSpeed, pSet: b.sol.pFan - b.sol.segLoss['common'], pReq, nNom, fixedAngles: fixed.angles };
}

export function shiftParams(mode: Mode, pSet?: number, balanced = true): SimParams {
  const c0 = commissioning(), com = balanced ? c0 : null;
  const ids = ['post1', 'post2', 'post3'];
  const duration = 8 * 3600;
  return {
    mode, dt: 1, duration, schedule: makeSchedule(ids, duration), record: 10,
    posts: ids.map(id => ({ id, B: B_BASE, Qset: m3h(Q_POST_MIN_M3H), etaNom: ETA_LEV_DEFAULT })),  // 1500 м³/ч — ГОСТ 12.3.003-86 п. 2.11.1; η = 0,8 — Методика 1997
    substances: [
      { name: 'Mn', g: SV08G2S.mn, pdk: PDK_MN_WELD_LE20.ss, qIn: MN_ATM_SS },   // Методика 1997 табл. 1; СанПиН 1.2.3685-21 табл. 2.1, 1.1
      { name: 'Fe2O3', g: SV08G2S.fe, pdk: 6, qIn: 0.04 },                          // СанПиН 1.2.3685-21, табл. 2.1, стр. 1031: -/6 (с.с.), Ф, 4 кл. — сверено
    ],
    room: { V: 48 * 24 * 14.4, Lgen: genVentByFormula(), dT: T_IN_WINTER - MOSCOW_HEATING.tAvg },
    // объём цеха — из диплома; Δt = 18 − (−1,7) = 19,7 °C (СанПиН 1.2.3685-21; СП 131.13330.2025)
    damperStroke: mode === 'manual' ? 2.5 : 8,  // 8 с — из ряда времени полного хода ГОСТ 7192-89 (исследованы также 15 и 30 с); одинаково для всех режимов
    fanRamp: 10, nMax: 1500, nMin: 300, pSet: pSet ?? c0.pSet, kI: 4,   // уставка разрежения — из пусконаладки, если не задана
    nFF: mode === 'adaptive' ? feedforwardTable(ids, m3h(1500)) : undefined,
    openAngles: com ? (mode === 'constant' || mode === 'manual' ? com.fixedAngles : com.angles) : undefined, nConst: com ? com.nNom : undefined,
  };
}
