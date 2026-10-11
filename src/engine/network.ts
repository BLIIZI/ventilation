// Модель разветвлённой вытяжной сети с одним вентилятором.
// Метод: для каждого местного отсоса записывается баланс давления по пути
// «вход отсоса → ... → вентилятор → выброс»: Σ Δp(участков пути) = p_вент(Q_общ).
// Неизвестные — расходы отсосов Q_1..Q_N; решается методом Ньютона (якобиан численный).
// Расход на любом участке = сумма расходов отсосов, проходящих через него (закон сохранения массы).
import { ductLoss, damperZeta, fanPressure, filterLoss, m3h, fanPower, electricPower, area, dynPressure, lambdaAltshul, AIR } from './physics.ts';
import { KE_STEEL } from './norms.ts';
import { diffuserZeta, teeSideZeta, teeStraightZeta, bendZetaRough } from './fittings.ts';
import type { FanCurve, FilterSpec } from './physics.ts';

export type Element =
  | { kind: 'duct'; id: string; d: number; l: number; zeta: number }   // участок: d, м; l, м; Σζ
  | { kind: 'damper'; id: string; d: number; alpha: number; table?: Array<[number, number]> } // заслонка: угол, ° (0 — открыта); table — фактическая характеристика ζ(α), если отличается от справочной
  | { kind: 'filter'; id: string; spec: FilterSpec }
  | { kind: 'local'; id: string; d: number; zeta: number; label?: string }          // местное сопротивление с постоянным ζ (зонт, отвод, выход), к скорости в d
  | { kind: 'diffuser'; id: string; d1: number; d2: number; alpha?: number }       // переход на больший диаметр, ζ к скорости в d1 (зависит от Re)
  | { kind: 'bend'; id: string; d: number; delta: number; rd: number; label?: string } // отвод: угол δ, °; R₀/D₀; ζ зависит от Re и шероховатости (Идельчик, диагр. 6-1)
  | { kind: 'teeSide'; id: string; db: number; dc: number }                         // тройник на слияние, боковой вход в родительский участок
  | { kind: 'teeStraight'; id: string; dc: number; side: string };                  // тройник на слияние, проход; side — участок бокового входа

export interface Segment { id: string; parent: string | null; elements: Element[]; }
// Дерево: листья — ветви отсосов, корень (parent = null) — участок перед вентилятором.

export interface Network {
  segments: Segment[];
  hoods: string[];              // id листовых сегментов (по одному на пост)
  common: Element[];            // общий тракт: фильтр, участок к вентилятору, выброс
  fan: FanCurve;
  fanSpeed: number;             // об/мин
}

export interface Solution {
  Q: Record<string, number>;    // расход по сегментам и отсосам, м³/с
  Qtotal: number;
  pFan: number;                 // давление вентилятора, Па
  power: number;                // мощность на валу, Вт
  powerEl: number;              // электрическая мощность (с КПД двигателя и ЧП), Вт; без данных двигателя = power
  segLoss: Record<string, number>;
  iterations: number;
  converged: boolean;
}

/** Потери на элементе, Па (знак — по направлению потока). ctx: расход родительского участка (сборного канала) и расходы всех участков. */
export function elemLoss(e: Element, Q: number, ctx?: { Qp: number; f: Record<string, number> }): number {
  switch (e.kind) {
    case 'duct': return ductLoss(Q, e.d, e.l, e.zeta);
    case 'damper': return ductLoss(Q, e.d, 0, damperZeta(e.alpha, e.table));
    case 'filter': return filterLoss(e.spec, Q);
    case 'local': return ductLoss(Q, e.d, 0, e.zeta);
    case 'diffuser': { const w = Math.abs(Q) / area(e.d1), Re = w * e.d1 / AIR.nu; return ductLoss(Q, e.d1, 0, diffuserZeta(e.d1, e.d2, e.alpha ?? 15, Re, lambdaAltshul(w, e.d1))); }
    case 'bend': { const w = Math.abs(Q) / area(e.d), Re = w * e.d / AIR.nu; return ductLoss(Q, e.d, 0, bendZetaRough(e.delta, e.rd, Re, lambdaAltshul(w, e.d), KE_STEEL / e.d)); }
    case 'teeSide': { const qc = ctx?.Qp ?? Q; return teeSideZeta(Q, qc, e.db, e.dc) * dynPressure(qc / area(e.dc)); }
    case 'teeStraight': { const qc = ctx?.Qp ?? Q, qb = ctx?.f[e.side] ?? 0; return teeStraightZeta(qb, qc) * dynPressure(qc / area(e.dc)); }
  }
}
const segLossFn = (s: { elements: Element[]; parent?: string | null }, Q: number, f?: Record<string, number>) =>
  s.elements.reduce((a, e) => a + elemLoss(e, Q, f ? { Qp: s.parent ? f[s.parent] : Q, f } : undefined), 0);

/** Разбивка потерь давления по элементам при найденном решении (для отчёта и проверки энергетического баланса) */
export function lossBreakdown(net: Network, sol: Solution): Array<{ seg: string; id: string; kind: string; dp: number; q: number }> {
  const out: Array<{ seg: string; id: string; kind: string; dp: number; q: number }> = [];
  for (const s of net.segments) for (const e of s.elements) out.push({ seg: s.id, id: e.id, kind: e.kind, q: sol.Q[s.id], dp: elemLoss(e, sol.Q[s.id], { Qp: s.parent ? sol.Q[s.parent] : sol.Q[s.id], f: sol.Q }) });
  for (const e of net.common) out.push({ seg: 'common', id: e.id, kind: e.kind, q: sol.Qtotal, dp: elemLoss(e, sol.Qtotal) });
  return out;
}

export function solve(net: Network, guess?: number[]): Solution {
  const byId = new Map(net.segments.map(s => [s.id, s]));
  // путь от каждого отсоса до корня
  const paths = net.hoods.map(h => { const p: Segment[] = []; let s = byId.get(h); while (s) { p.push(s); s = s.parent ? byId.get(s.parent) : undefined; } return p; });
  // какие отсосы проходят через сегмент
  const users = new Map<string, number[]>();
  paths.forEach((p, i) => p.forEach(s => { if (!users.has(s.id)) users.set(s.id, []); users.get(s.id)!.push(i); }));

  const N = net.hoods.length;
  const segFlows = (q: number[]) => { const m: Record<string, number> = {}; for (const [id, u] of users) m[id] = u.reduce((a, i) => a + q[i], 0); return m; };
  const residual = (q: number[]) => {
    const f = segFlows(q); const Qt = q.reduce((a, b) => a + b, 0);
    const pF = fanPressure(net.fan, Qt, net.fanSpeed) - segLossFn({ elements: net.common }, Qt);
    return paths.map(p => p.reduce((a, s) => a + segLossFn(s, f[s.id], f), 0) - pF);
  };

  // демпфированный метод Ньютона; если из начального приближения сойтись не удалось (застревание на границе q → 0),
  // повтор из приближений, масштабированных по частоте вентилятора
  const newton = (q0: number[]) => {
    let q = [...q0], it = 0, ok = false;
    for (; it < 200; it++) {
      const r = residual(q);
      if (Math.max(...r.map(Math.abs)) < 1e-3) { ok = true; break; }
      const J = Array.from({ length: N }, () => Array(N).fill(0));
      for (let j = 0; j < N; j++) {
        const h = Math.max(1e-6, Math.abs(q[j]) * 1e-5);
        const qp = [...q]; qp[j] += h; const rp = residual(qp);
        for (let i = 0; i < N; i++) J[i][j] = (rp[i] - r[i]) / h;
      }
      const dx = gauss(J, r.map(v => -v));
      const norm = (v: number[]) => Math.sqrt(v.reduce((a, x) => a + x * x, 0)), r0 = norm(r);
      let t = 1; while (t > 1e-4 && q.some((v, i) => v + t * dx[i] <= 0)) t /= 2;
      let qn = q.map((v, i) => Math.max(v + t * dx[i], 1e-9));
      while (t > 1e-6 && norm(residual(qn)) > (1 - 1e-4 * t) * r0) { t /= 2; qn = q.map((v, i) => Math.max(v + t * dx[i], 1e-9)); }
      q = qn;
    }
    return { q, ok, it };
  };
  const k = Math.max(net.fanSpeed / net.fan.n0, 0.01);
  const starts = [guess && guess.length === N ? guess : null, Array(N).fill(m3h(500) * k), Array(N).fill(m3h(500)), Array(N).fill(m3h(50) * k)].filter(Boolean) as number[][];
  let res = newton(starts[0]), tries = 1;
  while (!res.ok && tries < starts.length) { res = newton(starts[tries]); tries++; }
  const q = res.q, ok = res.ok, it = res.it;
  const f = segFlows(q); const Qt = q.reduce((a, b) => a + b, 0);
  const pFan = fanPressure(net.fan, Qt, net.fanSpeed);
  const segLoss: Record<string, number> = {};
  const fq: Record<string, number> = { ...f }; net.hoods.forEach((h, i) => (fq[h] = q[i]));
  for (const s of net.segments) segLoss[s.id] = segLossFn(s, fq[s.id] ?? 0, fq);
  segLoss['common'] = segLossFn({ elements: net.common }, Qt);
  const Q: Record<string, number> = { ...f }; net.hoods.forEach((h, i) => (Q[h] = q[i]));
  const power = fanPower(net.fan, Qt, pFan);
  return { Q, Qtotal: Qt, pFan, power, powerEl: electricPower(net.fan, power), segLoss, iterations: it, converged: ok };
}

function gauss(A: number[][], b: number[]): number[] {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) { const k = M[r][c] / M[c][c]; for (let k2 = c; k2 <= n; k2++) M[r][k2] -= k * M[c][k2]; }
  }
  const x = Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let c = r + 1; c < n; c++) s -= M[r][c] * x[c]; x[r] = s / M[r][r]; }
  return x;
}

/** Установить угол заслонки в сегменте */
export function setDamper(net: Network, segId: string, alpha: number) {
  const s = net.segments.find(x => x.id === segId)!;
  for (const e of s.elements) if (e.kind === 'damper') e.alpha = alpha;
}
