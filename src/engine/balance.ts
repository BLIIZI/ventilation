// Установившийся режим регулирования: подобрать углы заслонок и частоту вентилятора так, чтобы
// 1) расход каждого работающего поста = требуемому; 2) неработающие посты закрыты;
// 3) давление минимально: заслонка «критической» (самой нагруженной) ветви открыта полностью.
// Принцип 3 — аналог «сброса уставки давления» в VAV-системах (Liu et al., ASHRAE Trans., 2010) [М].
import { solve } from './network.ts';
import type { Network, Solution } from './network.ts';
import { damperZeta, damperAngleForZeta, BUTTERFLY_ROUND } from './physics.ts';

export interface BalanceResult {
  feasible: boolean; message: string; fanSpeed: number; angles: Record<string, number>; sol: Solution;
}

const ALPHA_OPEN = 0, ALPHA_CLOSED = 90;

function anglesForSpeed(net: Network, req: Record<string, number>, n: number) {
  net.fanSpeed = n;
  const dampers = net.hoods.map(h => net.segments.find(s => s.id === h)!.elements.find(e => e.kind === 'damper') as any);
  net.hoods.forEach((h, i) => { dampers[i].alpha = req[h] > 0 ? 20 : ALPHA_CLOSED; });
  let sol = solve(net);
  for (let it = 0; it < 200; it++) {
    let maxErr = 0;
    net.hoods.forEach((h, i) => {
      if (!(req[h] > 0)) return;
      const d = dampers[i];
      const z = damperZeta(d.alpha, d.table);
      const ratio = sol.Q[h] / req[h];
      maxErr = Math.max(maxErr, Math.abs(ratio - 1));
      // Δp заслонки ~ ζ·Q²: чтобы уменьшить расход в ratio раз, увеличиваем сопротивление ветви
      const tb = d.table ?? BUTTERFLY_ROUND;
      const zNew = Math.min(Math.max(z * Math.pow(ratio, 2 * 0.7) + (ratio - 1) * 0.5, damperZeta(0, tb)), damperZeta(70, tb));
      d.alpha = damperAngleForZeta(zNew, tb);
    });
    sol = solve(net, net.hoods.map(h => sol.Q[h]));
    if (maxErr < 0.0005) break;
  }
  const active = net.hoods.filter(h => req[h] > 0);
  const short = active.filter(h => sol.Q[h] < req[h] * 0.999);  // не добирают даже при открытой заслонке
  const minAlpha = Math.min(...active.map(h => dampers[net.hoods.indexOf(h)].alpha));
  return { sol, short, minAlpha, angles: Object.fromEntries(net.hoods.map((h, i) => [h, dampers[i].alpha])) };
}

export function balance(net: Network, req: Record<string, number>, nMin = 300, nMax = 1500): BalanceResult {
  const top = anglesForSpeed(net, req, nMax);
  if (top.short.length) {
    return { feasible: false, fanSpeed: nMax, angles: top.angles, sol: top.sol,
      message: `Требуемый расход недостижим при максимальной частоте: посты ${top.short.join(', ')}. Факт.: ${top.short.map(h => (top.sol.Q[h] * 3600).toFixed(0)).join(', ')} м³/ч` };
  }
  // бисекция по частоте: минимальная частота, при которой все посты получают требуемый расход
  let lo = nMin, hi = nMax, best = top;
  for (let i = 0; i < 25; i++) {
    const mid = (lo + hi) / 2, r = anglesForSpeed(net, req, mid);
    if (r.short.length === 0) { hi = mid; best = r; } else lo = mid;
  }
  anglesForSpeed(net, req, hi); // привести сеть в найденное состояние
  return { feasible: true, fanSpeed: hi, angles: best.angles, sol: best.sol,
    message: `Критическая ветвь открыта на ${(100 - best.minAlpha / 0.9).toFixed(0)} %` };
}
