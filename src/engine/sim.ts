// Динамическая модель (блок 3). Шаг по времени dt, на каждом шаге:
// 1) состояние постов по расписанию → выделение (блок 1);
// 2) регуляторы задают целевые углы заслонок и частоту вентилятора (по режиму управления);
// 3) приводы отрабатывают с ограниченной скоростью (время полного хода);
// 4) сеть решается квазистационарно (блок 2): время прохода воздуха по сети — секунды [Д];
// 5) концентрация в цехе — уравнение баланса массы при полном перемешивании [М];
// 6) интегрируются энергия вентилятора и тепло на подогрев приточного воздуха.
import { solve } from './network.ts';
import type { Network, Solution } from './network.ts';
import { damperZeta, damperAngleForZeta } from './physics.ts';

export type Mode = 'constant' | 'onoff' | 'adaptive';
// constant  — без регулирования: заслонки открыты, вентилятор 100 % всю смену
// onoff     — промышленный стандарт: заслонка открыта/закрыта по датчику тока, ЧП держит постоянное разрежение
// adaptive  — предлагаемая система: ПИ-регулятор расхода в каждой ветви + сброс давления (критическая ветвь открыта)

export interface Substance { name: string; g: number; pdk: number; qIn: number; } // g, г/кг; ПДК, q_пр — мг/м³
export interface PostSpec { id: string; B: number; Qset: number; etaNom: number; } // B кг/ч, Qset м³/с
export interface SimParams {
  mode: Mode;
  dt: number;            // шаг, с
  duration: number;      // длительность, с
  schedule: (post: string, t: number) => boolean;   // работает ли пост
  posts: PostSpec[];
  substances: Substance[];
  room: { V: number; Lgen: number; dT: number; LgenPerPost?: number; LgenMin?: number };
  // объём м³; общеобменная м³/с (постоянная) или по потребности: LgenMin + LgenPerPost·(число работающих постов); Δt, °C
  damperStroke: number;  // время полного хода привода 0→90°, с
  fanRamp: number;       // время разгона ЧП 0→nMax, с
  nMax: number; nMin: number;
  pSet?: number;         // уставка разрежения в коллекторе для режима onoff, Па
  record?: number;       // шаг записи временного ряда, с
  kI?: number;
  nFF?: (active: string[]) => number;   // упреждение: расчётная частота для данного набора работающих постов (из balance)           // коэффициент интегрального регулятора расхода (в пространстве ln ζ), 1/с
}
export interface Sample { t: number; n: number; Q: Record<string, number>; alpha: Record<string, number>; on: Record<string, boolean>; C: Record<string, number>; P: number; heat: number; }
export interface SimResult {
  fanKWh: number; heatKWh: number; avgFlow: number;      // кВт·ч, кВт·ч, м³/ч
  underFlowShare: number;   // доля времени работы постов с расходом < 95 % требуемого
  overFlowShare: number;    // доля времени работы постов с расходом > 110 % требуемого
  maxC: Record<string, number>; avgC: Record<string, number>;
  series: Sample[];
}

const HEAT_COEF = 1.2; // кВт на 1 м³/с на 1 °C (Kulmala, VTT, 2015) [М]

export function simulate(net: Network, p: SimParams): SimResult {
  const ids = p.posts.map(x => x.id);
  const damper = (id: string) => net.segments.find(s => s.id === id)!.elements.find(e => e.kind === 'damper') as { alpha: number };
  const alpha: Record<string, number> = {}; ids.forEach(id => (alpha[id] = 90));
  const lnZ: Record<string, number> = {}; ids.forEach(id => (lnZ[id] = Math.log(damperZeta(30))));
  const memZ: Record<string, number> = { ...lnZ }; // упреждение: при включении поста заслонка сразу идёт в последнее рабочее положение
  let n = 0, nTarget = 0, sol: Solution | null = null, lastKey = '';
  const C: Record<string, number> = {}; p.substances.forEach(s => (C[s.name] = s.qIn));
  const maxC: Record<string, number> = { ...C }, sumC: Record<string, number> = {}; p.substances.forEach(s => (sumC[s.name] = 0));
  let fanJ = 0, heatJ = 0, flowInt = 0, onTime = 0, under = 0, over = 0;
  const series: Sample[] = [];
  const dAlphaMax = 90 / p.damperStroke * p.dt, dnMax = p.nMax / p.fanRamp * p.dt;

  for (let t = 0; t <= p.duration; t += p.dt) {
    const on: Record<string, boolean> = {}; ids.forEach(id => (on[id] = p.schedule(id, t)));
    const anyOn = ids.some(id => on[id]);
    const Q = (id: string) => (sol ? sol.Q[id] : 0);

    // ---- регуляторы: целевые углы и частота
    const target: Record<string, number> = {};
    if (p.mode === 'constant') { ids.forEach(id => (target[id] = 0)); nTarget = p.nMax; }
    if (p.mode === 'onoff') {
      ids.forEach(id => (target[id] = on[id] ? 0 : 90));
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
    const Qtot = sol ? sol.Qtotal : 0;
    const P = sol ? sol.power : 0;

    // ---- помещение: V dC/dt = Σ(1-η)G − (L_мо + L_оо)(C − q_пр)
    // η снижается, если расход поста меньше требуемого: η = η_ном·min(1, Q/Q_тр) [Д]
    const nOn = ids.filter(id => on[id]).length;
    const Lgen = p.room.LgenPerPost !== undefined ? (p.room.LgenMin ?? 0) + p.room.LgenPerPost * nOn : p.room.Lgen;
    const Lout = Qtot + Lgen;
    for (const s of p.substances) {
      let Groom = 0; // мг/с
      for (const ps of p.posts) if (on[ps.id]) {
        const eta = ps.etaNom * Math.min(1, Q(ps.id) / ps.Qset);
        Groom += (1 - eta) * s.g * 1000 * ps.B / 3600;
      }
      C[s.name] += p.dt * (Groom - Lout * (C[s.name] - s.qIn)) / p.room.V;
      maxC[s.name] = Math.max(maxC[s.name], C[s.name]); sumC[s.name] += C[s.name] * p.dt;
    }
    // ---- энергия и качество регулирования
    const heat = HEAT_COEF * Lout * p.room.dT; // кВт
    fanJ += P * p.dt; heatJ += heat * 1000 * p.dt; flowInt += Qtot * p.dt;
    for (const ps of p.posts) if (on[ps.id]) {
      onTime += p.dt; const r = Q(ps.id) / ps.Qset;
      if (r < 0.95) under += p.dt; if (r > 1.10) over += p.dt;
    }
    if (p.record && Math.abs(t / p.record - Math.round(t / p.record)) < 1e-9)
      series.push({ t, n, Q: Object.fromEntries(ids.map(id => [id, Q(id) * 3600])), alpha: { ...alpha }, on, C: { ...C }, P, heat });
  }
  const avgC: Record<string, number> = {}; for (const k in sumC) avgC[k] = sumC[k] / p.duration;
  return { fanKWh: fanJ / 3.6e6, heatKWh: heatJ / 3.6e6, avgFlow: flowInt / p.duration * 3600,
    underFlowShare: onTime ? under / onTime : 0, overFlowShare: onTime ? over / onTime : 0, maxC, avgC, series };
}
