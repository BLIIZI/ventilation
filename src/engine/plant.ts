// СБОРКА ЦЕХА ИЗ НАСТРОЕК ПОСТОВ (универсальная модель).
// Вход: для каждого поста — процесс, материал, параметры, тип отсоса. Выход: сеть, параметры моделирования, отчёт:
//  1) выделение всех веществ на каждом посту (библиотека процессов, российские методики);
//  2) ПДК каждого вещества (СанПиН), категория Mn — по доле в аэрозоле, группы суммации;
//  3) уставка расхода каждого отсоса — не ниже нормы для выбранного укрытия;
//  4) подбор вентилятора (запас, пока режим «все посты» достижим), пусконаладка, упреждение;
//  5) общеобменная вентиляция по всем веществам: L = max по группам Σ(G_i/ПДК_i)/(1 − Σ q_пр,i/ПДК_i) (СП 60.13330.2020; Σ C/ПДК ≤ 1).
import type { SimParams, Substance, GenVent, Mode } from './sim.ts';
import type { Network } from './network.ts';
import { balance } from './balance.ts';
import { m3h } from './physics.ts';
import { makeNetworkFor } from './demo-network.ts';
import { SUBSTANCES, pdkOf, mnCategory } from './substances.ts';
import { processById, emissionOf, qsetOf, qminOf, type PostConfig } from './processes.ts';
import { ETA_LEV_DEFAULT, T_IN_WINTER, MOSCOW_HEATING } from './norms.ts';
import { makeSchedule } from './scenario.ts';

export interface PlantConfig {
  posts: PostConfig[];
  V?: number;                 // объём цеха, м³ (по умолчанию — цех из диплома)
  frac?: number;              // целевая доля ПДК для ОВ по потребности (по умолчанию 0,5)
  lev?: Mode;                 // режим местных отсосов
  gen?: GenVent['mode'];      // режим общеобменной
  gasSensors?: string[];      // газоанализаторы в цехе (например ['no2','co'])
  duration?: number; seed?: number;
  schedule?: (id: string, t: number) => boolean;
}

export interface PlantReport {
  posts: Array<{ id: string; process: string; material: string; emission: Record<string, number>; qset: number; qmin: number; qminSource: string; hood: string; eta: number }>;
  substances: Array<{ id: string; name: string; pdk: number; cls: number; status: string; group?: string; Lneed: number; note?: string }>;
  Ldesign: number;            // м³/ч — общеобменная сверх местных отсосов, все посты работают, C = ПДК (СП 60)
  Ltotal: number; Llev: number;   // м³/ч — весь потребный удаляемый воздух и воздух местных отсосов
  limiting: string;           // вещество (группа), требующее наибольшего воздухообмена
  mnCategory?: string; mnShare?: number; postMnCategory?: Array<string | undefined>;
  fanScale: number; fanFeasible: boolean; commissioning: { n: number; angles: Record<string, number>; pSet: number };
}

/** Сводка «вещества и потребный воздухообмен» без моделирования (блок 1 для смеси процессов) */
export function designReport(posts: PostConfig[]) {
  const em = posts.map(p => emissionOf(p));
  const ids = new Set<string>(['aerosol']); em.forEach(e => Object.keys(e).forEach(k => ids.add(k)));
  // категория ПДК Mn — по доле Mn в сварочном аэрозоле, поступающем в воздух цеха (смесь от всех постов, СанПиН 1.2.3685-21, табл. 2.1)
  const etaK = (p: PostConfig) => p.eta ?? ETA_LEV_DEFAULT;
  const mnEsc = em.reduce((a, e, k) => a + (1 - etaK(posts[k])) * (e.mn ?? 0), 0), aerEsc = em.reduce((a, e, k) => a + (1 - etaK(posts[k])) * (e.aerosol ?? 0), 0);
  const mnCat = mnEsc > 0 ? mnCategory(mnEsc / Math.max(aerEsc, 1e-12)) : undefined;
  const postMnCats = em.map(e => (e.mn ?? 0) > 0 ? mnCategory((e.mn ?? 0) / Math.max(e.aerosol ?? e.mn, 1e-12)).label : undefined);
  const subs: Substance[] = [...ids].filter(id => SUBSTANCES[id]).map(id => {
    const info = SUBSTANCES[id];
    const pdk = id === 'mn' && mnCat ? mnCat.pdkSs : pdkOf(info);
    return { name: id, g: 0, pdk, qIn: info.qIn, settles: info.aerosol, group: info.group };
  });
  const etaOf = (p: PostConfig) => p.eta ?? ETA_LEV_DEFAULT;
  const esc: Record<string, number> = {};
  // мг/с в цех: не уловленное отсосом (1 − η)·G; у агрегата с возвратом воздуха — ещё проскок фильтра η·(1 − η_ф)·G (газы: η_ф = 0)
  const slip = (p: PostConfig, s: Substance) => p.recircEta === undefined ? 0 : etaOf(p) * (1 - (s.settles !== false ? p.recircEta : 0));
  for (const s of subs) esc[s.name] = posts.reduce((a, p, k) => a + (1 - etaOf(p) + slip(p, s)) * (em[k][s.name] ?? 0), 0);
  const groups = new Map<string, Substance[]>();
  for (const s of subs) if (Number.isFinite(s.pdk)) { const k = s.group ?? s.name; if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(s); }
  let Ld = 0, limiting = '';
  const need: Record<string, number> = {};
  for (const [k, mem] of groups) {
    const L = mem.reduce((a, s) => a + esc[s.name] / (s.pdk - s.qIn), 0);   // м³/с: весь удаляемый воздух; СП 60 — расходы по веществам группы суммируются
    for (const s of mem) need[s.name] = L;
    if (L > Ld) { Ld = L; limiting = k; }
  }
  // СП 60: L = L_wz + (m − L_wz(q_wz − q_in))/(q_l − q_in) → при q_l = q_wz общеобменная L_оо = L − L_wz, L_wz — местные отсосы
  const Llev = posts.reduce((a, p) => a + (p.recircEta === undefined ? qsetOf(p) : 0), 0) / 3600, Ltotal = Ld;   // агрегат с возвратом воздуха воздух из цеха не удаляет
  Ld = Math.max(0, Ltotal - Llev);
  return { em, subs, esc, need, Ld, Ltotal, Llev, limiting, mnCat, groups, mnShare: aerEsc > 0 ? mnEsc / aerEsc : 0, postMnCats };
}

export function buildPlant(cfg: PlantConfig): { net: Network; params: SimParams; report: PlantReport; makeNet: () => Network } {
  const posts = cfg.posts.map((p, i) => ({ ...p, id: `post${i + 1}` }));
  const ids = posts.map(p => p.id);
  const qsets = posts.map(p => qsetOf(p));
  // ---- подбор вентилятора: увеличиваем запас, пока режим «все посты на уставке» не станет достижимым
  let fanScale = 1, feasible = false, b: ReturnType<typeof balance> | null = null;
  const req = Object.fromEntries(ids.map((id, k) => [id, m3h(qsets[k])]));
  for (let it = 0; it < 15; it++) {
    b = balance(makeNetworkFor(qsets, fanScale), req);
    if (b.feasible && b.fanSpeed < 1450) { feasible = true; break; }   // запас ≥ 3 % по частоте
    fanScale *= 1.08;
  }
  const makeNet = () => makeNetworkFor(qsets, fanScale);
  const net = makeNet();
  const com = { n: b!.fanSpeed, angles: b!.angles, pSet: b!.sol.pFan - b!.sol.segLoss['common'] };
  // ---- упреждение по частоте для набора работающих постов
  const cache = new Map<string, number>();
  const nFF = (active: string[]) => { const k = active.join(','); if (!cache.has(k)) cache.set(k, balance(makeNet(), Object.fromEntries(ids.map((id, j) => [id, active.includes(id) ? m3h(qsets[j]) : 0]))).fanSpeed); return cache.get(k)!; };
  // ---- вещества и расчётная ОВ
  const d = designReport(posts);
  const duration = cfg.duration ?? 8 * 3600;
  const frac = cfg.frac ?? 0.5;
  const limSub = [...d.groups.get(d.limiting) ?? []].sort((a, c) => d.esc[c.name] / c.pdk - d.esc[a.name] / a.pdk)[0]?.name ?? 'mn';
  const Ld = Math.max(d.Ld, m3h(500));
  const gen: GenVent | undefined = cfg.gen ? {
    // L_макс — производительность вентилятора ОВ: не меньше 1,5·L_расч и не меньше нужной для цели регулятора при всех работающих постах [А]
    mode: cfg.gen, Ldesign: Ld, Lmin: 0.2 * Ld, Lmax: Math.max(1.5 * Ld, 1.1 * (d.Ltotal / frac - d.Llev)), limiting: limSub, Cset: frac, multi: { frac, gasSensors: cfg.gasSensors },
    sensor: { of: 'aerosol', ratio: 0, tau: 30, noise: 0.1 }, kP: 0.5, kI: 0.005, ffTau: 600, dpDesign: 600, etaFan: 0.6, ramp: 20,
  } : undefined;
  const params: SimParams = {
    mode: cfg.lev ?? 'adaptive', dt: 1, duration, record: 10,
    schedule: cfg.schedule ?? makeSchedule(ids, duration, cfg.seed ?? 7),
    posts: posts.map((p, k) => ({ id: p.id, B: 0, Qset: m3h(qsets[k]), etaNom: p.eta ?? ETA_LEV_DEFAULT, emis: () => emissionOf(cfg.posts[k]) })),   // читает настройку поста «вживую» (интерфейс)
    substances: d.subs, limiting: limSub,
    room: { V: cfg.V ?? 48 * 24 * 14.4, Lgen: Ld, dT: T_IN_WINTER - MOSCOW_HEATING.tAvg },
    damperStroke: 8, fanRamp: 10, nMax: 1500, nMin: 300, pSet: com.pSet, kI: 4,
    nFF: (cfg.lev ?? 'adaptive') === 'adaptive' ? nFF : undefined, openAngles: com.angles, nConst: com.n, gen,
  };
  const report: PlantReport = {
    posts: posts.map((p, k) => { const q = qminOf(p); return { id: p.id, process: processById(p.process).name, material: (processById(p.process).materials.find(m => m.id === p.material) ?? processById(p.process).materials[0]).name,
      emission: d.em[k], qset: qsets[k], qmin: q.q, qminSource: q.source, hood: q.label, eta: p.eta ?? ETA_LEV_DEFAULT }; }),
    substances: d.subs.filter(s => Number.isFinite(s.pdk)).map(s => ({ id: s.name, name: SUBSTANCES[s.name].name, pdk: s.pdk, cls: SUBSTANCES[s.name].cls, status: SUBSTANCES[s.name].status, group: s.group, Lneed: (d.need[s.name] ?? 0) * 3600, note: SUBSTANCES[s.name].note }))
      .sort((a, c) => c.Lneed - a.Lneed),
    Ldesign: Ld * 3600, Ltotal: d.Ltotal * 3600, Llev: d.Llev * 3600, limiting: d.limiting, mnCategory: d.mnCat?.label, mnShare: d.mnShare, postMnCategory: d.postMnCats, fanScale, fanFeasible: feasible, commissioning: com,
  };
  return { net, params, report, makeNet };
}

/** Пример цеха с разными видами сварки (4 поста) */
export const MIXED_EXAMPLE: PostConfig[] = [
  { id: 'post1', process: 'mag_co2', material: 'sv08g2s', params: { I: 225 } },
  { id: 'post2', process: 'mma', material: 'uoni1345', params: { B: 1.5 } },
  { id: 'post3', process: 'saw', material: 'an348a', params: { B: 6 }, hood: 'table' },   // флюс АН-348-А (ГОСТ Р 52222-2004: широкого применения); B — расход флюса, кг/ч
  { id: 'post4', process: 'contact', material: 'butt', params: { N: 75 } },
];
