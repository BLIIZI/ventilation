// БИБЛИОТЕКА ТЕХНОЛОГИЧЕСКИХ ПРОЦЕССОВ.
// Для каждого процесса: какие вещества выделяются (удельные показатели из российской методики перечня Минприроды),
// от какого параметра зависит интенсивность (ток, расход материала, мощность машины, толщина реза, площадь ванны…),
// и какой минимальный расход местного отсоса требует норма.
// Пользователь может задать свой материал/показатели (customMaterial) — модель от этого не меняется.
import { wireRate } from './norms.ts';

export type ParamId = 'I' | 'd' | 'l' | 'B' | 'P' | 'thick' | 'area' | 'open' | 'v' | 'fp' | 'Q';
export interface ParamDef { id: ParamId; label: string; unit: string; def: number; min: number; max: number; step: number }
export interface Material {
  id: string; name: string;
  factors: Record<string, number>;      // удельные показатели в единицах `unit` процесса
  source: string; status: 'сверено' | 'П' | 'ввести';
}
export interface HoodNorm {
  id: string; label: string;
  qmin: (p: Record<string, number>) => number;   // минимальный расход отсоса, м³/ч
  source: string;
}
export interface Process {
  id: string; group: string; name: string;
  unit: string;                     // единица удельных показателей
  /** интенсивность процесса в «единицах активности» в час: кг/ч материала, м² ванны, доля мощности и т.п. */
  activity: (p: Record<string, number>) => number;
  activityLabel: string;
  params: ParamDef[];
  materials: Material[];
  hoods: HoodNorm[];
  source: string;
  /** особый способ расчёта выделения (покраска): возвращает г/ч по веществам */
  custom?: (m: Material, p: Record<string, number>) => Record<string, number>;
}

const MET_WELD = 'Методика расчёта выделений (выбросов) ЗВ в атмосферу при сварочных работах (на основе удельных показателей), утв. приказом Госкомэкологии РФ от 14.04.1997 № 158; перечень Минприроды (распоряжение от 14.12.2020 № 35-р), п. 18';
const MET_MECH = 'Методика расчёта выделений (выбросов) ЗВ в атмосферу при механической обработке металлов (на основе удельных показателей), утв. приказом Госкомэкологии РФ от 14.04.1997 № 158; перечень, п. 17';
const MET_PAINT = 'Методика расчёта выделений (выбросов) ЗВ в атмосферу при нанесении лакокрасочных материалов (на основе удельных показателей), утв. приказом Госкомэкологии РФ от 12.11.1997 № 497; перечень, п. 19';
const MET_GALV = 'Методика расчёта выделений (выбросов) ЗВ в атмосферу при производстве металлопокрытий гальваническим способом, утв. приказом Госкомэкологии РФ от 30.04.1999 № 216; перечень, п. 20';
const MET_REC = 'Расчётная инструкция (методика) «Удельные показатели образования вредных веществ… для предприятий радиоэлектронного комплекса», 2006; перечень, п. 8';

// ---------- нормы расхода местных отсосов
const H_TABLE: HoodNorm = { id: 'table', label: 'Сварочный стол с отсосом', qmin: () => 1500,
  source: 'ГОСТ 12.3.003-86, п. 2.11.1: не менее 1500 м³/ч, скорость в точке сварки ≥ 0,2 м/с' };
const H_TORCH_CO2: HoodNorm = { id: 'torch', label: 'Встроенный в горелку отсос (CO₂, 250–500 А)', qmin: () => 50,
  source: 'ГОСТ 12.3.003-86, п. 2.12.2: не менее 50 м³/ч' };
const H_TORCH_AUTO: HoodNorm = { id: 'torch_auto', label: 'Встроенный отсос автомата / в инертных газах', qmin: () => 150,
  source: 'ГОСТ 12.3.003-86, п. 2.12.2: не менее 150 м³/ч' };
const H_CUT_GAS: HoodNorm = { id: 'cut_gas', label: 'Раскроечный стол, газовая резка', qmin: p => 2500 * (p.area ?? 1),
  source: 'Гримитлин А.М. Вентиляция сварочного производства // АВОК Северо-Запад, 2006, с. 39: 2500 м³/(ч·м²) площади стола [С]' };
const H_CUT_PLASMA: HoodNorm = { id: 'cut_plasma', label: 'Раскроечный стол, плазменная резка', qmin: p => 4000 * (p.area ?? 1),
  source: 'Гримитлин А.М., 2006, с. 39: 4000 м³/(ч·м²) площади стола [С]' };
const H_SOLDER: HoodNorm = { id: 'solder', label: 'Местный отсос у места пайки', qmin: p => 0.6 * (p.open ?? 0.05) * 3600,
  source: 'Санитарные правила организации процессов пайки мелких изделий сплавами, содержащими свинец, № 952-72, п. 3.3: скорость у места пайки не менее 0,6 м/с' };
const H_BOOTH: HoodNorm = { id: 'booth', label: 'Окрасочная камера (по скорости в проёме)', qmin: p => (p.v ?? 0.5) * (p.open ?? 2) * 3600,
  source: 'Скорость в открытом проёме — по Санитарным правилам при окрасочных работах с применением ручных распылителей [П: значение по составу ЛКМ]' };
const H_USER: HoodNorm = { id: 'user', label: 'Задаётся проектировщиком', qmin: p => p.Q ?? 1000, source: 'нормы нет — по паспорту укрытия / расчёту (по умолчанию 1000 м³/ч [Д])' };
/** Параметр «расход отсоса» — показывается, когда выбран отсос «задаётся проектировщиком» */
export const P_Q: ParamDef = { id: 'Q', label: 'Расход отсоса (паспорт укрытия)', unit: 'м³/ч', def: 1000, min: 50, max: 10000, step: 50 };

const P_I: ParamDef = { id: 'I', label: 'Сварочный ток', unit: 'А', def: 225, min: 80, max: 400, step: 5 };
const P_D: ParamDef = { id: 'd', label: 'Диаметр проволоки', unit: 'мм', def: 1.2, min: 0.8, max: 2.0, step: 0.2 };
const P_B = (def: number, label = 'Расход материала'): ParamDef => ({ id: 'B', label, unit: 'кг/ч', def, min: 0.05, max: 20, step: 0.05 });

export const PROCESSES: Process[] = [
  {
    id: 'mag_co2', group: 'Сварка', name: 'Полуавтоматическая сварка в CO₂ проволокой', unit: 'г/кг проволоки',
    activity: p => wireRate(p.I, p.d ?? 1.2, p.l ?? 15), activityLabel: 'расход проволоки B = α_р·I, кг/ч',
    params: [P_I, P_D], source: MET_WELD + ', табл. 1; α_р — Соколов Г.Н. и др., ВолгГТУ, 2016, ф. (3.22)',
    hoods: [H_TABLE, H_TORCH_CO2, H_USER],
    materials: [
      { id: 'sv08g2s', name: 'Св-08Г2С', factors: { aerosol: 10.0, fe: 7.67, mn: 1.90, sio2: 0.43 }, source: 'табл. 1', status: 'сверено' },
    ],
  },
  {
    id: 'mma', group: 'Сварка', name: 'Ручная дуговая сварка штучными электродами', unit: 'г/кг электродов',
    activity: p => p.B, activityLabel: 'расход электродов, кг/ч', params: [P_B(1.5, 'Расход электродов')],
    source: MET_WELD + ', табл. 1', hoods: [H_TABLE, H_USER],
    materials: [
      { id: 'uoni1345', name: 'УОНИ-13/45', factors: { aerosol: 16.31, fe: 10.69, mn: 0.92, sio2: 1.40, fluor: 3.3, hf: 0.75, no2: 1.50, co: 13.3 }, source: 'табл. 1', status: 'сверено' },
      { id: 'uoni1355', name: 'УОНИ-13/55', factors: { aerosol: 16.99, fe: 13.90, mn: 1.09, sio2: 1.0, fluor: 1.0, hf: 0.93, no2: 2.70, co: 13.3 }, source: 'табл. 1', status: 'сверено' },
      { id: 'mr3', name: 'МР-3', factors: { aerosol: 11.5, fe: 9.77, mn: 1.73, hf: 0.40 }, source: 'табл. 1', status: 'сверено' },
      { id: 'ano4', name: 'АНО-4', factors: { aerosol: 17.8, fe: 15.73, mn: 1.66, sio2: 0.41 }, source: 'табл. 1', status: 'сверено' },
      { id: 'ozs4', name: 'ОЗС-4', factors: { aerosol: 10.9, fe: 9.63, mn: 1.27 }, source: 'табл. 1', status: 'сверено' },
    ],
  },
  {
    id: 'saw', group: 'Сварка', name: 'Автоматическая сварка под флюсом', unit: 'г/кг флюса',
    activity: p => p.B, activityLabel: 'расход флюса, кг/ч', params: [P_B(6, 'Расход флюса')],
    source: MET_WELD + ', табл. 1; отсос не дальше 40 мм от дуги — Правила 884н, п. 67', hoods: [H_TORCH_AUTO, H_TABLE, H_USER],
    materials: [
      { id: 'osc45', name: 'ОСЦ-45', factors: { aerosol: 0.28, fe: 0.2, mn: 0.02, sio2: 0.05, fluor: 0.01, hf: 0.15, no2: 0.006, co: 1.285 }, source: 'табл. 1 (порядок газовых столбцов — сверить)', status: 'П' },
      { id: 'an348a', name: 'АН-348-А', factors: { aerosol: 0.20, fe: 0.06, mn: 0.02, sio2: 0.05, fluor: 0.07, hf: 0.06, no2: 0.001, co: 0.71 }, source: 'табл. 1 (порядок газовых столбцов — сверить)', status: 'П' },
      { id: 'fc12', name: 'ФЦ-12', factors: { aerosol: 0.09, fe: 0.06, mn: 0.03, hf: 0.02 }, source: 'табл. 1', status: 'сверено' },
    ],
  },
  {
    id: 'gas_weld', group: 'Сварка', name: 'Газовая сварка стали', unit: 'г/кг горючего газа',
    activity: p => p.B, activityLabel: 'расход горючего газа, кг/ч', params: [P_B(0.4, 'Расход горючего газа')],
    source: MET_WELD + ', табл. 3', hoods: [H_TABLE, H_USER],
    materials: [
      { id: 'acetylene', name: 'Ацетилен–кислород', factors: { no2: 22 }, source: 'табл. 3: оксиды азота 22 г/кг ацетилена', status: 'сверено' },
      { id: 'propane', name: 'Пропан-бутан', factors: { no2: 15 }, source: 'табл. 3: 15 г/кг смеси', status: 'сверено' },
    ],
  },
  {
    id: 'contact', group: 'Сварка', name: 'Контактная электросварка', unit: 'г/ч на эталонную мощность машины',
    activity: p => p.P, activityLabel: 'мощность машины, доля эталонной', params: [{ id: 'P', label: 'Мощность машины (доля эталонной: 75 кВт стыковая, 50 кВт точечная)', unit: '—', def: 1, min: 0.1, max: 4, step: 0.1 }],
    source: MET_WELD + ', табл. 3', hoods: [H_USER],
    materials: [
      { id: 'butt', name: 'Стыковая и линейная (на 75 кВт)', factors: { aerosol: 25.0, fe: 24.25, mn: 0.75 }, source: 'табл. 3: Fe 24,25; Mn 0,75 г/ч на 75 кВт', status: 'сверено' },
      { id: 'spot', name: 'Точечная (на 50 кВт)', factors: { aerosol: 2.5, fe: 2.425, mn: 0.075 }, source: 'табл. 3: Fe 2,425; Mn 0,075 г/ч на 50 кВт', status: 'сверено' },
    ],
  },
  {
    id: 'gas_cut', group: 'Резка', name: 'Газовая резка углеродистой стали', unit: 'г/ч',
    activity: () => 1, activityLabel: '—', params: [{ id: 'thick', label: 'Толщина металла', unit: 'мм', def: 10, min: 5, max: 20, step: 1 },
      { id: 'area', label: 'Площадь раскроечного стола', unit: 'м²', def: 1, min: 0.5, max: 12, step: 0.5 }],
    source: MET_WELD + ', табл. удельных выделений при газовой резке (5, 10, 20 мм) [П: номер таблицы]; значения по: Белокуров В.П., Кораблев Р.А., Штепа А.А. (уч. пособие, табл. 8.16)',
    hoods: [H_CUT_GAS, H_USER],
    materials: [{ id: 'carbon', name: 'Сталь углеродистая, низколегированная', factors: {}, source: 'г/ч по толщине', status: 'П' }],
    custom: (_m, p) => {
      const T: Array<[number, Record<string, number>]> = [
        [5, { aerosol: 74.0, mn: 1.1, fe: 72.9, co: 49.5, no2: 39.0 }],
        [10, { aerosol: 131.0, mn: 1.9, fe: 129.1, co: 63.4, no2: 64.1 }],
        [20, { aerosol: 200.0, mn: 3.0, fe: 197.0, co: 65.0, no2: 53.2 }],
      ];
      const t = Math.min(20, Math.max(5, p.thick ?? 10));
      let i = 1; while (i < T.length - 1 && t > T[i][0]) i++;
      const [t0, a] = T[i - 1], [t1, b] = T[i], w = (t - t0) / (t1 - t0), out: Record<string, number> = {};
      for (const k of Object.keys(a)) out[k] = a[k] + w * (b[k] - a[k]);
      return out;   // г/ч
    },
  },
  {
    id: 'grind', group: 'Механическая обработка', name: 'Шлифование / заточка (без СОЖ)', unit: 'г/с на станок',
    activity: () => 3600, activityLabel: 'с/ч', params: [],
    source: MET_MECH + ', табл. 5.1.1', hoods: [H_USER],
    materials: [
      { id: 'sharp100', name: 'Заточной, круг 100 мм', factors: { dust_abr: 0.004, dust_met: 0.006 }, source: 'табл. 5.1.1', status: 'сверено' },
      { id: 'sharp550', name: 'Заточной, круг 550 мм', factors: { dust_abr: 0.027, dust_met: 0.040 }, source: 'табл. 5.1.1', status: 'сверено' },
      { id: 'flat175', name: 'Плоскошлифовальный, круг 175 мм', factors: { dust_abr: 0.014, dust_met: 0.022 }, source: 'табл. 5.1.1', status: 'сверено' },
      { id: 'round100', name: 'Круглошлифовальный, круг 100 мм', factors: { dust_abr: 0.010, dust_met: 0.018 }, source: 'табл. 5.1.1', status: 'сверено' },
      { id: 'rough100', name: 'Обдирочно-шлифовальный, круг 100 мм', factors: { dust_abr: 0.62, dust_met: 0.96 }, source: 'табл. 5.1.1', status: 'сверено' },
    ],
  },
  {
    id: 'paint', group: 'Покраска', name: 'Окраска пневматическим распылением', unit: 'расчёт по составу ЛКМ',
    activity: p => p.B, activityLabel: 'расход ЛКМ, кг/ч',
    params: [P_B(2, 'Расход ЛКМ'), { id: 'fp', label: 'Доля летучей части ЛКМ', unit: '%', def: 45, min: 10, max: 90, step: 1 },
      { id: 'open', label: 'Площадь проёма камеры', unit: 'м²', def: 2, min: 0.5, max: 10, step: 0.5 },
      { id: 'v', label: 'Скорость в проёме', unit: 'м/с', def: 0.5, min: 0.3, max: 1.5, step: 0.1 }],
    source: MET_PAINT + ' [П: доли δ_a = 30 % (аэрозоль) и δ′_р = 25 % (растворитель при окраске) для пневматического распыления — сверить по табл. Методики]',
    hoods: [H_BOOTH, H_USER],
    materials: [
      { id: 'pf115', name: 'Эмаль ПФ-115 (растворитель: уайт-спирит 50 % + ксилол 50 %)', factors: { whitespirit: 0.5, xylene: 0.5 }, source: 'состав растворителя — [П] по паспорту ЛКМ', status: 'П' },
    ],
    custom: (m, p) => {
      const B = p.B, fp = (p.fp ?? 45) / 100, dA = 0.30, dP = 0.25;   // [П]
      const out: Record<string, number> = { paint_aer: 1000 * B * (1 - fp) * dA };
      for (const [k, share] of Object.entries(m.factors)) out[k] = 1000 * B * fp * dP * share;
      return out;   // г/ч
    },
  },
  {
    id: 'solder', group: 'Пайка', name: 'Пайка свинцовосодержащими припоями', unit: 'г/кг припоя',
    activity: p => p.B, activityLabel: 'расход припоя, кг/ч', params: [P_B(0.05, 'Расход припоя'), { id: 'open', label: 'Площадь всасывающего отверстия', unit: 'м²', def: 0.05, min: 0.01, max: 0.5, step: 0.01 }],
    source: MET_REC + ' — удельные показатели ввести по методике (в открытом доступе не найдены)', hoods: [H_SOLDER, H_USER],
    materials: [{ id: 'pos61', name: 'ПОС-61 (показатели ввести)', factors: { pb: 0, sn: 0 }, source: 'ввести по методике п. 8 перечня', status: 'ввести' }],
  },
  {
    id: 'galv', group: 'Гальваника / химия', name: 'Гальваническая ванна (по площади зеркала)', unit: 'г/(ч·м²)',
    activity: p => p.area, activityLabel: 'площадь зеркала ванны, м²', params: [{ id: 'area', label: 'Площадь зеркала ванны', unit: 'м²', def: 1, min: 0.1, max: 20, step: 0.1 }],
    source: MET_GALV + ' — удельные показатели ввести по таблицам методики', hoods: [H_USER],
    materials: [
      { id: 'chrome', name: 'Хромирование (показатель ввести)', factors: { cr6: 0 }, source: 'ввести по методике п. 20 перечня', status: 'ввести' },
      { id: 'pickle', name: 'Травление в серной кислоте (показатель ввести)', factors: { h2so4: 0 }, source: 'ввести по методике п. 20 перечня', status: 'ввести' },
    ],
  },
];

export const processById = (id: string) => PROCESSES.find(p => p.id === id)!;

/** Какие группы процессов доступны в интерфейсе. Сейчас — только сварка (решение 11.10.2026: остальные процессы —
 *  после согласования с руководителем). Чтобы включить, добавить группы: 'Резка', 'Механическая обработка', 'Покраска', 'Пайка', 'Гальваника / химия'. */
export const ENABLED_GROUPS = ['Сварка'];
export const activeProcesses = () => PROCESSES.filter(p => ENABLED_GROUPS.includes(p.group));

/** Настройка поста: процесс, материал, параметры, тип отсоса; factorsOverride — свои удельные показатели (ввод пользователя) */
export interface PostConfig { id: string; process: string; material: string; params?: Record<string, number>; hood?: string; Qset?: number; factorsOverride?: Record<string, number>; eta?: number }

export function paramsOf(cfg: PostConfig): Record<string, number> {
  const pr = processById(cfg.process), out: Record<string, number> = {};
  for (const d of pr.params) out[d.id] = cfg.params?.[d.id] ?? d.def;
  return { ...out, ...(cfg.params ?? {}) };
}

/** Выделение веществ на посту при работе, мг/с (до местного отсоса) */
export function emissionOf(cfg: PostConfig, paramsOverride?: Record<string, number>): Record<string, number> {
  const pr = processById(cfg.process), m = pr.materials.find(x => x.id === cfg.material) ?? pr.materials[0];
  const mat: Material = cfg.factorsOverride ? { ...m, factors: { ...m.factors, ...cfg.factorsOverride } } : m;
  const p = { ...paramsOf(cfg), ...(paramsOverride ?? {}) };
  let gph: Record<string, number>;
  if (pr.custom) gph = pr.custom(mat, p);
  else { const a = pr.activity(p); gph = {}; for (const [k, f] of Object.entries(mat.factors)) gph[k] = f * a; }
  const out: Record<string, number> = {}; for (const [k, v] of Object.entries(gph)) out[k] = v * 1000 / 3600;   // г/ч → мг/с
  return out;
}

/** Минимальный расход отсоса по норме для выбранного укрытия, м³/ч; итоговая уставка — не меньше нормы */
export function qminOf(cfg: PostConfig): { q: number; source: string; label: string } {
  const pr = processById(cfg.process), h = pr.hoods.find(x => x.id === cfg.hood) ?? pr.hoods[0];
  return { q: h.qmin(paramsOf(cfg)), source: h.source, label: h.label };
}
export function qsetOf(cfg: PostConfig): number { return Math.max(qminOf(cfg).q, cfg.Qset ?? 0); }
