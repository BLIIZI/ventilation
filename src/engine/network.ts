// Модель разветвлённой вытяжной сети с одним вентилятором.
// Метод: для каждого местного отсоса записывается баланс давления по пути
// «вход отсоса → ... → вентилятор → выброс»: Σ Δp(участков пути) = p_вент(Q_общ).
// Неизвестные — расходы отсосов Q_1..Q_N; решается методом Ньютона (якобиан численный).
// Расход на любом участке = сумма расходов отсосов, проходящих через него (закон сохранения массы).
import { ductLoss, damperZeta, fanPressure, filterLoss, m3h, fanPower, electricPower } from './physics.ts';
import type { FanCurve, FilterSpec } from './physics.ts';

export type Element =
  | { kind: 'duct'; id: string; d: number; l: number; zeta: number }   // участок: d, м; l, м; Σζ
  | { kind: 'damper'; id: string; d: number; alpha: number }           // заслонка: угол, ° (0 — открыта)
  | { kind: 'filter'; id: string; spec: FilterSpec };

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

const elemLoss = (e: Element, Q: number) => {
  switch (e.kind) {
    case 'duct': return ductLoss(Q, e.d, e.l, e.zeta);
    case 'damper': return ductLoss(Q, e.d, 0, damperZeta(e.alpha));
    case 'filter': return filterLoss(e.spec, Q);
  }
};
const segLossFn = (s: { elements: Element[] }, Q: number) => s.elements.reduce((a, e) => a + elemLoss(e, Q), 0);

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
    return paths.map(p => p.reduce((a, s) => a + segLossFn(s, f[s.id]), 0) - pF);
  };

  let q = guess && guess.length === N ? [...guess] : Array(N).fill(m3h(500));
  let it = 0, ok = false;
  for (; it < 100; it++) {
    const r = residual(q);
    if (Math.max(...r.map(Math.abs)) < 1e-3) { ok = true; break; }
    // численный якобиан
    const J = Array.from({ length: N }, () => Array(N).fill(0));
    for (let j = 0; j < N; j++) {
      const h = Math.max(1e-6, Math.abs(q[j]) * 1e-5);
      const qp = [...q]; qp[j] += h; const rp = residual(qp);
      for (let i = 0; i < N; i++) J[i][j] = (rp[i] - r[i]) / h;
    }
    const dx = gauss(J, r.map(v => -v));
    // демпфирование шага: расходы не уходят в отрицательную область
    let t = 1; while (t > 1e-4 && q.some((v, i) => v + t * dx[i] <= 0)) t /= 2;
    q = q.map((v, i) => Math.max(v + t * dx[i], 1e-9));
  }
  const f = segFlows(q); const Qt = q.reduce((a, b) => a + b, 0);
  const pFan = fanPressure(net.fan, Qt, net.fanSpeed);
  const segLoss: Record<string, number> = {};
  for (const s of net.segments) segLoss[s.id] = segLossFn(s, f[s.id] ?? 0);
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
