// Динамическая модель (блок 3). Шаг по времени dt, на каждом шаге:
// 1) состояние постов по расписанию → выделение (блок 1);
// 2) регуляторы задают целевые углы заслонок и частоту вентилятора (по режиму управления);
// 3) приводы отрабатывают с ограниченной скоростью (время полного хода);
// 4) сеть решается квазистационарно (блок 2): время прохода воздуха по сети — секунды [Д];
// 5) концентрация в цехе — нестационарное уравнение баланса вредных веществ при полном перемешивании V·dC/dτ = G − L(C − C_пр);
//    стационарное решение — формула СП 60.13330.2020 (прил. И) [Н]; нестационарная форма — Эльтерман В.М. Вентиляция химических производств. — М.: Химия, 1980 [С][П: стр.];
// 6) интегрируются энергия вентилятора и тепло на подогрев приточного воздуха.
import { solve } from './network.ts';
import type { Network, Solution } from './network.ts';
import { damperZeta, damperAngleForZeta, area } from './physics.ts';
import { RHO_AIR, C_AIR } from './norms.ts';

export type Mode = 'constant' | 'onoff' | 'adaptive';
// constant  — без регулирования: заслонки открыты, вентилятор 100 % всю смену
// onoff     — промышленный стандарт: заслонка открыта/закрыта по датчику тока, ЧП держит постоянное разрежение
// adaptive  — предлагаемая система: ПИ-регулятор расхода в каждой ветви + сброс давления (критическая ветвь открыта)

export interface Substance { name: string; g: number; pdk: number; qIn: number; settles?: boolean; } // g, г/кг; ПДК, q_пр — мг/м³; settles=false — газ (не оседает)
export interface PostSpec { id: string; B: number; Qset: number; etaNom: number; current?: (t: number) => number; etaReal?: number; }
// etaReal — фактическая эффективность захвата (если отличается от принятой в расчёте η_ном): проверка устойчивости к ошибке модели
// B кг/ч (если current не задан), Qset м³/с; current(t) — сварочный ток, А → B по таблице проволоки

/** Общеобменная вентиляция (блок 4) */
export interface GenVent {
  mode: 'const' | 'posts' | 'ff' | 'fffb';
  // const — постоянный расчётный расход; posts — по числу работающих постов;
  // ff — упреждение по току сварки (расчёт выделения); fffb — упреждение + коррекция по датчику концентрации
  Ldesign: number; Lmin: number; Lmax: number;   // м³/с
  limiting: string;          // лимитирующее вещество (обычно Mn)
  Cset: number;              // целевая концентрация лимитирующего вещества, мг/м³
  sensor: { of: string; ratio: number; tau: number; noise: number }; // датчик общей массы аэрозоля → оценка Mn = ratio·C_аэр
  kP: number; kI: number;    // коэффициенты коррекции (доля Ldesign на единицу относительной ошибки; 1/с)
  ffTau?: number;            // сглаживание упреждающего сигнала, с (инерционное звено 1-го порядка)
  antiWindup?: boolean;      // условное интегрирование (по умолчанию включено); false — только для сравнения в исследовании
  dpDesign: number; etaFan: number; ramp: number; // для энергии вентилятора ОВ: P = P_расч·(L/L_расч)^3; время разгона ЧП, с
}
export interface SimParams {
  mode: Mode;
  dt: number;            // шаг, с
  duration: number;      // длительность, с
  schedule: (post: string, t: number) => boolean;   // работает ли пост
  posts: PostSpec[];
  substances: Substance[];
  room: { V: number; Lgen: number; dT: number; LgenPerPost?: number; LgenMin?: number; kSettle?: number };
  // kSettle — доля аэрозоля, остающаяся во взвешенном состоянии (оседание). По умолчанию 1 (оседание не учитывается — запас).
  // Вариант: 0,4 — коэффициент гравитационного оседания по Методике 1997, разд. 2.3 [Н]
  // объём м³; общеобменная м³/с (постоянная) или по потребности: LgenMin + LgenPerPost·(число работающих постов); Δt, °C
  damperStroke: number;  // время полного хода привода 0→90°, с
  fanRamp: number;       // время разгона ЧП 0→nMax, с
  nMax: number; nMin: number;
  pSet?: number;         // уставка разрежения в коллекторе для режима onoff, Па
  record?: number;       // шаг записи временного ряда, с
  kI?: number;
  nFF?: (active: string[]) => number;
  openAngles?: Record<string, number>; // положение «открыто» после пусконаладочной балансировки (режимы constant/onoff)
  wire?: Array<[number, number]>;  // таблица «ток, А → расход проволоки, кг/ч»
  gen?: GenVent;
  nearField?: { r: number; s: number };
  // ОЦЕНКА концентрации в зоне дыхания. Российского нормативного метода расчёта нет: по нормам РФ концентрацию в зоне дыхания ИЗМЕРЯЮТ
  // (ГОСТ 12.1.005-88; СанПиН 1.2.3685-21). Для оценки — модель «ближняя/дальняя зона» (Nicas, 1996; AIHA, 2009 — зарубежный метод):
  // C_дых = C_цеха + G_ут/β, β = ½·S·s. Проверка порядка величины по российскому источнику: в зоне дыхания сварщика содержание вредных
  // веществ выше фона цеха в 7–10 раз (Гримитлин А.М. Вентиляция сварочного производства // АВОК Северо-Запад, 2006, с. 36).
  // S = 2πr² — поверхность полусферы радиуса r над столом, s — случайная скорость воздуха в цехе, м/с [Д]
  wMin?: number;   // минимальная транспортная скорость в воздуховодах, м/с (контроль осаждения пыли)
  nConst?: number;                     // частота для режима constant (расчётный режим после наладки)   // упреждение: расчётная частота для данного набора работающих постов (из balance)           // коэффициент интегрального регулятора расхода (в пространстве ln ζ), 1/с
}
export interface Sample { Cbz: Record<string, number>; t: number; n: number; Q: Record<string, number>; alpha: Record<string, number>; on: Record<string, boolean>; C: Record<string, number>; P: number; heat: number; Lgen: number; sensor: number; pFan: number; Qtot: number; }
export interface SimResult {
  fanKWh: number; heatKWh: number; avgFlow: number;      // кВт·ч, кВт·ч, м³/ч
  underFlowShare: number;   // доля времени работы постов с расходом < 95 % требуемого
  overFlowShare: number;    // доля времени работы постов с расходом > 110 % требуемого
  maxC: Record<string, number>; avgC: Record<string, number>;
  genKWh: number; overPdkShare: number; avgLgen: number;   // энергия вентилятора ОВ; доля времени, когда лимитирующее вещество > ПДК; средний расход ОВ, м³/ч
  series: Sample[];
  bzTWA: Record<string, number>;   // среднесменная концентрация лимитирующего вещества в зоне дыхания сварщика по постам, мг/м³
  bzMax: Record<string, number>;   // максимальная мгновенная в зоне дыхания (для сравнения с ПДК не годится)
  bz15max: Record<string, number>; // максимум 15-минутного скользящего среднего в зоне дыхания (сравнивать с ПДК м.р.); '__room' — по цеху
  lowVelShare: number;             // доля времени работы вентилятора, когда хотя бы на одном участке с рабочим потоком w < wMin
  lowVelBySeg: Record<string, number>;
  nonConverged: number;            // число шагов, где решатель сети не сошёлся (должно быть 0)
}

// Теплота на нагрев приточного воздуха Q = ρ·c·L·(t_в − t_н), кВт — уравнение теплового баланса (Богословский В.Н. и др. Отопление и вентиляция. Ч. 2.
// — М.: Стройиздат, 1976 [С]); ρ = 1,2 кг/м³ (ГОСТ 10921-2017), c = 1,005 кДж/(кг·°C) (Варгафтик, 1972)
const HEAT_COEF = RHO_AIR * C_AIR; // 1,206 кВт на 1 м³/с на 1 °C

export function interp(tab: Array<[number, number]>, x: number) {
  if (x <= tab[0][0]) return tab[0][1] * x / tab[0][0];           // ниже первой точки — пропорционально [Д]
  for (let i = 1; i < tab.length; i++) if (x <= tab[i][0]) {
    const [x0, y0] = tab[i - 1], [x1, y1] = tab[i]; return y0 + (x - x0) * (y1 - y0) / (x1 - x0);
  }
  const [x0, y0] = tab[tab.length - 2], [x1, y1] = tab[tab.length - 1]; return y1 + (x - x1) * (y1 - y0) / (x1 - x0);
}

/** Пошаговый симулятор: step() продвигает модель на dt и возвращает текущее состояние.
 *  Используется и для расчёта смены (simulate), и в интерактивном интерфейсе. */
export function createSimulator(net: Network, p: SimParams) {
  const ids = p.posts.map(x => x.id);
  const damper = (id: string) => net.segments.find(s => s.id === id)!.elements.find(e => e.kind === 'damper') as { alpha: number };
  const alpha: Record<string, number> = {}; ids.forEach(id => (alpha[id] = 90));
  const lnZ: Record<string, number> = {}; ids.forEach(id => (lnZ[id] = Math.log(damperZeta(30))));
  const memZ: Record<string, number> = { ...lnZ }; // упреждение: при включении поста заслонка сразу идёт в последнее рабочее положение
  let n = 0, nTarget = 0, sol: Solution | null = null, lastKey = '';
  // какие посты обслуживает каждый участок (для контроля транспортной скорости)
  const segHoods = new Map<string, string[]>();
  for (const h of ids) { let sg = net.segments.find(x => x.id === h); while (sg) { if (!segHoods.has(sg.id)) segHoods.set(sg.id, []); segHoods.get(sg.id)!.push(h); sg = sg.parent ? net.segments.find(x => x.id === sg!.parent) : undefined; } }
  const segD = (els: any[]) => els.filter(e => e.kind === 'duct').map(e => e.d as number);
  const limName = p.gen?.limiting ?? p.substances[0].name;
  const bzSum: Record<string, number> = {}, bzMax: Record<string, number> = {}; ids.forEach(id => { bzSum[id] = 0; bzMax[id] = 0; });
  // скользящее 15-минутное среднее (максимально разовая ПДК сравнивается со средним за время отбора пробы) [Н: МУ/ГОСТ 12.1.005]
  const W = Math.max(1, Math.round(900 / p.dt));
  const ring: Record<string, number[]> = {}, ringSum: Record<string, number> = {}, bz15: Record<string, number> = {};
  [...ids, '__room'].forEach(id => { ring[id] = []; ringSum[id] = 0; bz15[id] = 0; });
  const push = (id: string, v: number) => { const r = ring[id]; r.push(v); ringSum[id] += v; if (r.length > W) ringSum[id] -= r.shift()!; if (r.length === W) bz15[id] = Math.max(bz15[id], ringSum[id] / W); };
  const lowSeg: Record<string, number> = {}; let lowAny = 0, fanOnTime = 0, nonConv = 0;
  const C: Record<string, number> = {}; p.substances.forEach(s => (C[s.name] = s.qIn));
  const maxC: Record<string, number> = { ...C }, sumC: Record<string, number> = {}; p.substances.forEach(s => (sumC[s.name] = 0));
  let fanJ = 0, heatJ = 0, flowInt = 0, onTime = 0, under = 0, over = 0, genJ = 0, overPdk = 0, genInt = 0;
  let LgenNow = p.gen ? p.gen.Ldesign : p.room.Lgen, fbInt = 0, sensorC = 0, seed = 12345, ffF = 0;
  const noise = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648 - 0.5) * 2; // [-1;1]
  const Bof = (ps: PostSpec, t: number) => (ps.current && p.wire ? interp(p.wire, ps.current(t)) : ps.B);
  const series: Sample[] = [];
  const dAlphaMax = 90 / p.damperStroke * p.dt, dnMax = p.nMax / p.fanRamp * p.dt;

  let t = 0;
  function step(): Sample {
    const on: Record<string, boolean> = {}; ids.forEach(id => (on[id] = p.schedule(id, t)));
    const anyOn = ids.some(id => on[id]);
    const Q = (id: string) => (sol ? sol.Q[id] : 0);

    // ---- регуляторы: целевые углы и частота
    const target: Record<string, number> = {};
    if (p.mode === 'constant') { ids.forEach(id => (target[id] = p.openAngles?.[id] ?? 0)); nTarget = p.nConst ?? p.nMax; }
    if (p.mode === 'onoff') {
      ids.forEach(id => (target[id] = on[id] ? (p.openAngles?.[id] ?? 0) : 90));
      // ЧП: ПИ по разрежению в коллекторе (давление перед общим трактом)
      const pColl = sol && n > 0 ? sol.pFan - sol.segLoss['common'] : 0;
      nTarget = anyOn ? Math.min(p.nMax, Math.max(p.nMin, nTarget + 0.5 * ((p.pSet ?? 600) - pColl) * p.dt)) : 0;
    }
    if (p.mode === 'adaptive') {
      for (const ps of p.posts) {
        if (!on[ps.id]) { target[ps.id] = 90; lnZ[ps.id] = memZ[ps.id]; continue; }
        // ПИ в пространстве ln ζ: линеаризует нелинейную характеристику заслонки
        const e = sol ? (Q(ps.id) - ps.Qset) / ps.Qset : 0;
        lnZ[ps.id] = Math.min(Math.log(damperZeta(70)), Math.max(Math.log(damperZeta(0)), lnZ[ps.id] + (p.kI ?? 1.5) * e * p.dt));
        target[ps.id] = damperAngleForZeta(Math.exp(lnZ[ps.id]));
        memZ[ps.id] = lnZ[ps.id];
      }
      const act = p.posts.filter(ps => on[ps.id]);
      if (!act.length) nTarget = 0;
      else {
        if (nTarget < p.nMin) nTarget = p.nMin;
        const key = act.map(ps => ps.id).join(',');
        if (p.nFF && key !== lastKey) nTarget = Math.max(nTarget, p.nFF(act.map(ps => ps.id))); // упреждение при включении поста
        const aMin = Math.min(...act.map(ps => alpha[ps.id]));
        const deficit = Math.max(...act.map(ps => (ps.Qset - Q(ps.id)) / ps.Qset));
        // сброс давления: если самая открытая заслонка прикрыта > 5° — снижаем частоту; если открыта и расхода не хватает — повышаем
        if (aMin < 2 && deficit > 0.002) nTarget += 400 * deficit * p.dt;
        else if (aMin > 5) nTarget -= 1.0 * (aMin - 5) * p.dt;
        nTarget = Math.min(p.nMax, Math.max(p.nMin, nTarget));
      }
      lastKey = act.map(ps => ps.id).join(',');
    }
    // ---- исполнительные механизмы с ограниченной скоростью
    ids.forEach(id => { const d = target[id] - alpha[id]; alpha[id] += Math.max(-dAlphaMax, Math.min(dAlphaMax, d)); damper(id).alpha = alpha[id]; });
    n += Math.max(-dnMax, Math.min(dnMax, nTarget - n));
    net.fanSpeed = n;

    // ---- сеть
    if (n < 30) sol = null;
    else sol = solve(net, sol ? ids.map(id => Math.max(sol!.Q[id], 1e-4)) : undefined);
    if (sol && !sol.converged) nonConv++;
    const Qtot = sol ? sol.Qtotal : 0;
    // ---- транспортная скорость на участках с рабочим потоком
    if (sol && p.wMin) {
      fanOnTime += p.dt; let any = false;
      const check = (id: string, Qs: number, ds: number[]) => {
        for (const d of ds) if (Qs / area(d) < p.wMin!) { lowSeg[id] = (lowSeg[id] ?? 0) + p.dt; any = true; return; }
      };
      for (const sg of net.segments) if ((segHoods.get(sg.id) ?? []).some(h => on[h])) check(sg.id, sol.Q[sg.id], segD(sg.elements));
      if (anyOn) check('common', Qtot, segD(net.common));
      if (any) lowAny += p.dt;
    }
    const P = sol ? sol.powerEl : 0;   // электрическая мощность (если заданы данные двигателя)

    // ---- помещение: V dC/dt = Σ(1-η)G − (L_мо + L_оо)(C − q_пр)
    // η снижается, если расход поста меньше требуемого: η = η_ном·min(1, Q/Q_тр) [Д]
    const nOn = ids.filter(id => on[id]).length;
    let Lgen = p.room.LgenPerPost !== undefined ? (p.room.LgenMin ?? 0) + p.room.LgenPerPost * nOn : p.room.Lgen;
    if (p.gen) {
      const g = p.gen, lim = p.substances.find(x => x.name === g.limiting)!;
      let Lt = g.Ldesign;
      if (g.mode === 'posts') Lt = g.Lmin + (g.Ldesign - g.Lmin) * nOn / ids.length;
      if (g.mode === 'ff' || g.mode === 'fffb') {
        // упреждение: L = Σ(1−η_ном)·g·B(I) / (C_уст − q_пр) — формула блока 1 для целевой концентрации
        let G = 0; for (const ps of p.posts) if (on[ps.id]) G += (1 - ps.etaNom) * lim.g * 1000 * Bof(ps, t) / 3600;
        const ffRaw = G / (g.Cset - lim.qIn);
        ffF += g.ffTau ? (ffRaw - ffF) * p.dt / g.ffTau : ffRaw - ffF;
        Lt = ffF;
        if (g.mode === 'fffb') {
          const est = sensorC * g.sensor.ratio, e = (est - g.Cset) / g.Cset;   // оценка Mn по датчику общей массы
          // anti-windup (условное интегрирование): интеграл не копится, если выход упёрся в ограничение в ту же сторону
          const uFree = Lt + g.kP * e * g.Ldesign + fbInt;
          const satHi = uFree >= g.Lmax && e > 0, satLo = uFree <= g.Lmin && e < 0;
          if (g.antiWindup === false || (!satHi && !satLo)) fbInt = Math.max(-g.Ldesign, Math.min(g.Ldesign, fbInt + g.kI * e * g.Ldesign * p.dt));
          Lt += g.kP * e * g.Ldesign + fbInt;
        }
      }
      Lt = Math.min(g.Lmax, Math.max(g.Lmin, Lt));
      const dL = g.Lmax / g.ramp * p.dt; LgenNow += Math.max(-dL, Math.min(dL, Lt - LgenNow));
      Lgen = LgenNow;
      const Pg = g.Ldesign * g.dpDesign / g.etaFan * Math.pow(Lgen / g.Ldesign, 3);
      genJ += Pg * p.dt;
    }
    genInt += Lgen * p.dt;
    const Lout = Qtot + Lgen;
    for (const s of p.substances) {
      let Groom = 0; // мг/с
      for (const ps of p.posts) if (on[ps.id]) {
        const eta = (ps.etaReal ?? ps.etaNom) * Math.min(1, Q(ps.id) / ps.Qset);
        Groom += (1 - eta) * s.g * 1000 * Bof(ps, t) / 3600 * (s.settles === false ? 1 : (p.room.kSettle ?? 1));
      }
      C[s.name] += p.dt * (Groom - Lout * (C[s.name] - s.qIn)) / p.room.V;
      maxC[s.name] = Math.max(maxC[s.name], C[s.name]); sumC[s.name] += C[s.name] * p.dt;
    }
    // ---- зона дыхания сварщика (ближняя зона)
    const lim = p.substances.find(x => x.name === limName)!;
    const Cbz: Record<string, number> = {};
    for (const ps of p.posts) {
      let c = C[lim.name];
      if (p.nearField && on[ps.id]) {
        const eta = (ps.etaReal ?? ps.etaNom) * Math.min(1, Q(ps.id) / ps.Qset);
        const Gesc = (1 - eta) * lim.g * 1000 * Bof(ps, t) / 3600;           // мг/с, ушло мимо отсоса
        const beta = 0.5 * 2 * Math.PI * p.nearField.r ** 2 * p.nearField.s; // м³/с
        c += Gesc / beta;
      }
      Cbz[ps.id] = c; bzSum[ps.id] += c * p.dt; bzMax[ps.id] = Math.max(bzMax[ps.id], c); push(ps.id, c);
    }
    push('__room', C[lim.name]);
    if (p.gen) {
      const g = p.gen, lim = p.substances.find(x => x.name === g.limiting)!;
      if (C[lim.name] > lim.pdk) overPdk += p.dt;
      // датчик: инерционное звено 1-го порядка + шум (доля от показания) [Д]
      const meas = C[g.sensor.of] * (1 + g.sensor.noise * noise());
      sensorC += (meas - sensorC) * p.dt / g.sensor.tau;
    }
    // ---- энергия и качество регулирования
    const heat = HEAT_COEF * Lout * p.room.dT; // кВт
    fanJ += P * p.dt; heatJ += heat * 1000 * p.dt; flowInt += Qtot * p.dt;
    for (const ps of p.posts) if (on[ps.id]) {
      onTime += p.dt; const r = Q(ps.id) / ps.Qset;
      if (r < 0.95) under += p.dt; if (r > 1.10) over += p.dt;
    }
    const sample: Sample = { Cbz, t, n, Q: Object.fromEntries(ids.map(id => [id, Q(id) * 3600])), alpha: { ...alpha }, on, C: { ...C }, P, heat, Lgen: Lgen * 3600, sensor: sensorC, pFan: sol ? sol.pFan : 0, Qtot: Qtot * 3600 };
    if (p.record && Math.abs(t / p.record - Math.round(t / p.record)) < 1e-9) series.push(sample);
    t += p.dt;
    return sample;
  }
  /** Итоги; duration — интервал усреднения, с (по умолчанию длительность сценария) */
  function result(duration = p.duration): SimResult {
    const d = Math.max(duration, 1e-9);
    const avgC: Record<string, number> = {}; for (const k in sumC) avgC[k] = sumC[k] / d;
    return { fanKWh: fanJ / 3.6e6, heatKWh: heatJ / 3.6e6, avgFlow: flowInt / d * 3600,
      underFlowShare: onTime ? under / onTime : 0, overFlowShare: onTime ? over / onTime : 0, maxC, avgC, series,
      genKWh: genJ / 3.6e6, overPdkShare: overPdk / d, avgLgen: genInt / d * 3600,
      bzTWA: Object.fromEntries(ids.map(id => [id, bzSum[id] / d])), bzMax: { ...bzMax }, bz15max: { ...bz15 },
      lowVelShare: fanOnTime ? lowAny / fanOnTime : 0,
      lowVelBySeg: Object.fromEntries(Object.entries(lowSeg).map(([k, v]) => [k, fanOnTime ? v / fanOnTime : 0])),
      nonConverged: nonConv };
  }
  return { step, result, net, params: p, time: () => t };
}

export function simulate(net: Network, p: SimParams): SimResult {
  const sim = createSimulator(net, p);
  for (let t = 0; t <= p.duration; t += p.dt) sim.step();
  return sim.result();
}
