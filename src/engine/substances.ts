// СПРАВОЧНИК ВРЕДНЫХ ВЕЩЕСТВ: ПДК в воздухе рабочей зоны, класс опасности, агрегатное состояние, фон в приточном воздухе.
// Источник ПДК р.з. — СанПиН 1.2.3685-21, табл. 2.1 (действует до 01.03.2027). Фон q_пр — ПДК с.с. атмосферного воздуха (СанПиН, табл. 1.1)
// как верхняя оценка (подход диплома; СП 60.13330.2020, п. 5.11 — q_пр ≤ 0,3 ПДК р.з.).
// status: 'сверено' — значение сверено с первоисточником; 'П' — значение из ГН 2.2.5.3532-18 / СанПиН по памяти, СВЕРИТЬ по табл. 2.1 перед защитой.
// group — группа суммации (однонаправленное действие): при одновременном присутствии Σ C_i/ПДК_i ≤ 1 (ГОСТ 12.1.005-88; СП 60.13330.2020, разд. 7.4).

export interface SubstanceInfo {
  id: string; name: string;
  pdkMr: number;            // максимально разовая, мг/м³
  pdkSs?: number;           // среднесменная, мг/м³ (если не установлена — сравнивается с м.р.)
  cls: 1 | 2 | 3 | 4;       // класс опасности
  aerosol: boolean;         // аэрозоль (оседает, видит оптический датчик) или газ/пар
  qIn: number;              // концентрация в приточном воздухе, мг/м³
  group?: string;           // группа суммации
  status: 'сверено' | 'П';
  note?: string;
}

/** ПДК, с которой сравнивается среднесменная концентрация */
export const pdkOf = (s: SubstanceInfo) => s.pdkSs ?? s.pdkMr;

export const SUBSTANCES: Record<string, SubstanceInfo> = {
  aerosol: { id: 'aerosol', name: 'Сварочный аэрозоль (сумма твёрдых частиц)', pdkMr: Infinity, cls: 4, aerosol: true, qIn: 0, status: 'сверено',
    note: 'Отдельной ПДК нет — нормируется по компонентам; величина нужна для оптического датчика' },
  mn: { id: 'mn', name: 'Марганец в сварочных аэрозолях', pdkMr: 0.6, pdkSs: 0.2, cls: 2, aerosol: true, qIn: 0.001, status: 'сверено',
    note: 'Табл. 2.1, стр. 1221–1223: до 20 % — 0,6/0,2; 20–30 % — 0,3/0,1. Категория выбирается по доле Mn в аэрозоле процесса (mnCategory). Фон — табл. 1.1, поз. 302 (в пересчёте на MnO₂)' },
  fe: { id: 'fe', name: 'Железа оксид (диЖелезо триоксид)', pdkMr: 6, cls: 4, aerosol: true, qIn: 0.04, status: 'П', note: 'ПДК 6 — по диплому (табл. 2.2) и Быстрякову (2020); фон 0,04 — ПДК с.с. атм.' },
  sio2: { id: 'sio2', name: 'Пыль неорганическая с SiO₂ 20–70 %', pdkMr: 2, pdkSs: 1, cls: 3, aerosol: true, qIn: 0, status: 'П' },
  fluor: { id: 'fluor', name: 'Фториды неорганические плохо растворимые (по F)', pdkMr: 2.5, pdkSs: 0.5, cls: 2, aerosol: true, qIn: 0, group: 'F', status: 'П' },
  hf: { id: 'hf', name: 'Гидрофторид (фтористый водород, по F)', pdkMr: 0.5, pdkSs: 0.1, cls: 2, aerosol: false, qIn: 0, group: 'F', status: 'П' },
  no2: { id: 'no2', name: 'Азота диоксид', pdkMr: 2, cls: 3, aerosol: false, qIn: 0, status: 'сверено', note: 'Табл. 2.1, стр. 4: 2 мг/м³ (м.р.), «О»' },
  co: { id: 'co', name: 'Углерод оксид', pdkMr: 20, cls: 4, aerosol: false, qIn: 0, status: 'П' },
  cr6: { id: 'cr6', name: 'Хром (VI) (в пересчёте на CrO₃)', pdkMr: 0.03, pdkSs: 0.01, cls: 1, aerosol: true, qIn: 0, status: 'П' },
  pb: { id: 'pb', name: 'Свинец и его неорганические соединения (по Pb)', pdkMr: 0.05, pdkSs: 0.005, cls: 1, aerosol: true, qIn: 0, status: 'П' },
  sn: { id: 'sn', name: 'Олово и его соединения (оксиды)', pdkMr: 2, cls: 3, aerosol: true, qIn: 0, status: 'П' },
  dust_abr: { id: 'dust_abr', name: 'Пыль абразивная (корунд белый)', pdkMr: 6, cls: 4, aerosol: true, qIn: 0, status: 'П' },
  dust_met: { id: 'dust_met', name: 'Пыль металлическая (по оксидам железа)', pdkMr: 6, cls: 4, aerosol: true, qIn: 0, status: 'П' },
  oil: { id: 'oil', name: 'Масла минеральные нефтяные (аэрозоль СОЖ)', pdkMr: 5, cls: 3, aerosol: true, qIn: 0, status: 'П' },
  xylene: { id: 'xylene', name: 'Диметилбензол (ксилол)', pdkMr: 150, pdkSs: 50, cls: 3, aerosol: false, qIn: 0, status: 'П' },
  toluene: { id: 'toluene', name: 'Метилбензол (толуол)', pdkMr: 150, pdkSs: 50, cls: 3, aerosol: false, qIn: 0, status: 'П' },
  whitespirit: { id: 'whitespirit', name: 'Уайт-спирит', pdkMr: 900, pdkSs: 300, cls: 4, aerosol: false, qIn: 0, status: 'П' },
  paint_aer: { id: 'paint_aer', name: 'Аэрозоль лакокрасочного материала (сухой остаток)', pdkMr: 10, cls: 4, aerosol: true, qIn: 0, status: 'П',
    note: 'ПДК — по пигменту/плёнкообразователю конкретного ЛКМ; 10 — условно для невредного состава, задать по паспорту ЛКМ' },
  h2so4: { id: 'h2so4', name: 'Серная кислота (аэрозоль)', pdkMr: 1, cls: 2, aerosol: true, qIn: 0, status: 'П' },
  naoh: { id: 'naoh', name: 'Натрия гидроксид (аэрозоль)', pdkMr: 0.5, cls: 2, aerosol: true, qIn: 0, status: 'П' },
};

/** Категория ПДК марганца по его доле в сварочном аэрозоле (СанПиН 1.2.3685-21, табл. 2.1, стр. 1221–1223).
 *  Доля > 30 % — категории нет: консервативно принимается ПДК марганца оксидов (аэрозоль конденсации) 0,05 мг/м³ [вопрос к руководителю]. */
export function mnCategory(mnShare: number): { pdkMr: number; pdkSs: number; label: string } {
  if (mnShare <= 0.20) return { pdkMr: 0.6, pdkSs: 0.2, label: 'до 20 %' };
  if (mnShare <= 0.30) return { pdkMr: 0.3, pdkSs: 0.1, label: '20–30 %' };
  return { pdkMr: 0.05, pdkSs: 0.05, label: 'более 30 % (нет в СанПиН — принято по оксидам Mn, аэрозоль конденсации)' };
}
