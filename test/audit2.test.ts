// Аудит 3 (10.10.2026): аналитические решения, зона дыхания, транспортная скорость, неточная характеристика заслонки,
// сходимость решателя за смену, длительность недобора, масштабирование на N постов, актуальные нормативы.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { m3h, area, damperZeta, BUTTERFLY_ROUND, electricPower } from '../src/engine/physics.ts';
import { solve, setDamper } from '../src/engine/network.ts';
import { balance } from '../src/engine/balance.ts';
import { demoNetwork, makeNetwork } from '../src/engine/demo-network.ts';
import { simulate } from '../src/engine/sim.ts';
import type { SimParams } from '../src/engine/sim.ts';
import { shiftParams, makeSchedule } from '../src/engine/scenario.ts';
import { shift4 } from '../src/engine/scenario4.ts';

const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-12);

// ---------- нормативные константы
test('Климат: Δt = 18 − (−1,7) = 19,7 °C (Москва, СП 131.13330.2025, ≤ 8 °C, 202 сут)', () => {
  assert.equal(shiftParams('constant').room.dT, 19.7);
});

test('Минимальный расход поста 1500 м³/ч (ГОСТ 12.3.003-86, п. 2.11.1) — уставка регулятора не ниже нормы', () => {
  for (const ps of shiftParams('adaptive').posts) assert.ok(ps.Qset * 3600 >= 1500 - 1e-9);
  for (const ps of shift4('fffb').posts) assert.ok(ps.Qset * 3600 >= 1500 - 1e-9);
});

// ---------- аналитическое решение помещения
test('Помещение: после пуска переходный процесс совпадает с аналитикой C(t) = C∞ + (C(t0) − C∞)·e^(−L(t−t0)/V) (±0,1 %)', () => {
  // t0 = 600 с — приводы уже отработали; η берётся по фактическому расходу каждого поста
  const p = shiftParams('constant'); p.duration = 6 * 3600; p.record = 60; p.schedule = () => true;
  const r = simulate(demoNetwork(), p), last = r.series.at(-1)!, s = p.substances[0];
  const L = last.Qtot / 3600 + p.room.Lgen, V = p.room.V;
  const G = ['post1', 'post2', 'post3'].reduce((a, id) => a + (1 - 0.9 * Math.min(1, last.Q[id] / 1500)) * s.g * 1000 * 3 / 3600, 0);
  const Cinf = s.qIn + G / L, C0 = r.series.find(x => x.t === 600)!.C[s.name];
  for (const t of [1800, 3600, 7200, 14400, 21600]) {
    const an = Cinf + (C0 - Cinf) * Math.exp(-L * (t - 600) / V);
    const num = r.series.find(x => x.t === t)!.C[s.name];
    assert.ok(rel(num, an) < 0.001, `t=${t}: ${num.toFixed(5)} против ${an.toFixed(5)}`);
  }
});

// ---------- зона дыхания (ближняя зона)
test('Зона дыхания: C_дых = C_цеха + G_ут/β, β = ½·2πr²·s; при η = 1 C_дых = C_цеха; всегда C_дых ≥ C_цеха', () => {
  const p = shiftParams('constant'); p.duration = 600; p.record = 10; p.schedule = () => true;
  p.nearField = { r: 1, s: 0.1 };
  const last = simulate(demoNetwork(), p).series.at(-1)!;
  const Gesc = (1 - 0.9) * 1.9 * 1000 * 3 / 3600, beta = 0.5 * 2 * Math.PI * 1 * 0.1;
  for (const id of ['post1', 'post2', 'post3']) {
    const eta = 0.9 * Math.min(1, last.Q[id] / 1500);
    const exp = last.C.Mn + (1 - eta) * 1.9 * 1000 * 3 / 3600 / beta;
    assert.ok(rel(last.Cbz[id], exp) < 1e-9, id);
    assert.ok(last.Cbz[id] >= last.C.Mn);
  }
  assert.ok(Math.abs(last.Cbz.post2 - last.C.Mn - Gesc / beta) < 1e-6);
  const p1 = { ...p, posts: p.posts.map(x => ({ ...x, etaReal: 1 })) };
  const l1 = simulate(demoNetwork(), p1).series.at(-1)!;
  for (const id of ['post2', 'post3']) assert.ok(Math.abs(l1.Cbz[id] - l1.C.Mn) < 1e-12);
});

test('Зона дыхания: при выключенном посте C_дых = C_цеха; среднесменная ≤ максимальной', () => {
  const p = shiftParams('adaptive'); p.nearField = { r: 1, s: 0.1 }; p.record = 10;
  const r = simulate(demoNetwork(), p);
  for (const smp of r.series) for (const id of ['post1', 'post2', 'post3']) if (!smp.on[id]) assert.ok(Math.abs(smp.Cbz[id] - smp.C.Mn) < 1e-12);
  for (const id of ['post1', 'post2', 'post3']) assert.ok(r.bzTWA[id] <= r.bzMax[id] && r.bzTWA[id] >= r.avgC.Mn - 1e-12);
});

// ---------- транспортная скорость
test('Транспортная скорость: ручной расчёт скоростей демо-сети при расчётном режиме совпадает с ядром', () => {
  const net = demoNetwork(); const b = balance(net, { post1: m3h(1500), post2: m3h(1500), post3: m3h(1500) });
  const w = (Q: number, d: number) => Q / area(d);
  assert.ok(Math.abs(w(b.sol.Q.c1, 0.25) - 1500 / 3600 / area(0.25)) < 0.05);   // ≈ 8,5 м/с
  assert.ok(w(b.sol.Q.c1, 0.25) < 10 && w(b.sol.Q.c2, 0.315) > 10 && w(b.sol.Q.c3, 0.4) < 10.1);
});

test('Транспортная скорость в динамике: один пост на всю смену → магистраль d400 (3,3 м/с) всегда ниже 10 м/с', () => {
  const p = shiftParams('adaptive'); p.duration = 900; p.wMin = 10; p.schedule = (id) => id === 'post1';
  const r = simulate(demoNetwork(), p);
  assert.ok(r.lowVelBySeg.c3 > 0.98, `c3: ${(r.lowVelBySeg.c3 * 100).toFixed(1)} %`);
  assert.ok(r.lowVelBySeg.common > 0.98);
  assert.equal(r.lowVelBySeg.post2 ?? 0, 0);   // неработающая ветвь не учитывается
});

// ---------- неточная характеристика заслонки (реальная ≠ справочной)
test('Реальная заслонка отличается от справочника (ζ ×2 на промежуточных углах): ПИ в ln ζ всё равно выводит расход на 1500 ±2 %', () => {
  const real: Array<[number, number]> = BUTTERFLY_ROUND.map(([a, z]) => [a, a === 0 ? z : a >= 70 ? z : z * 2]);
  const net = demoNetwork(); for (const h of net.hoods) (net.segments.find(s => s.id === h)!.elements[1] as any).table = real;
  const p = shiftParams('adaptive'); p.duration = 900; p.record = 1; p.schedule = () => true;
  const last = simulate(net, p).series.at(-1)!;
  for (const id of ['post1', 'post2', 'post3']) assert.ok(Math.abs(last.Q[id] - 1500) < 30, `${id}: ${last.Q[id].toFixed(0)}`);
});

test('Реальная заслонка со сдвигом характеристики на 5°: регулятор держит расход, но упреждение промахивается — недобор измерим', () => {
  const shifted: Array<[number, number]> = BUTTERFLY_ROUND.map(([a]) => [a, damperZeta(Math.min(90, a + 5))]);
  const net = demoNetwork(); for (const h of net.hoods) (net.segments.find(s => s.id === h)!.elements[1] as any).table = shifted;
  const r = simulate(net, shiftParams('adaptive')), ref = simulate(demoNetwork(), shiftParams('adaptive'));
  assert.ok(Number.isFinite(r.underFlowShare) && r.underFlowShare < 0.25, `недобор ${(r.underFlowShare * 100).toFixed(1)} %`);
  assert.ok(r.avgFlow > 0.9 * ref.avgFlow);
});

// ---------- решатель: сходимость на всей смене во всех режимах
test('Решатель сети сходится на каждом шаге смены во всех режимах МВВ и ОВ (8 ч × 7 режимов)', () => {
  for (const m of ['constant', 'onoff', 'adaptive'] as const) assert.equal(simulate(demoNetwork(), shiftParams(m)).nonConverged, 0, m);
  for (const g of ['const', 'posts', 'ff', 'fffb'] as const) assert.equal(simulate(demoNetwork(), shift4(g)).nonConverged, 0, g);
});

// ---------- недобор только в переходных процессах
test('Недобор расхода (< 95 %) — только кратковременно после включения поста: самый длинный эпизод ≤ 20 с', () => {
  const p = shiftParams('adaptive'); p.record = 1; const r = simulate(demoNetwork(), p);
  for (const id of ['post1', 'post2', 'post3']) {
    let run = 0, worst = 0;
    for (const s of r.series) { if (s.on[id] && s.Q[id] < 0.95 * 1500) run++; else run = 0; worst = Math.max(worst, run); }
    assert.ok(worst <= 20, `${id}: эпизод недобора ${worst} с`);
  }
});

// ---------- масштабирование: N постов, случайные смены
test('Масштабирование: 2…8 постов, случайные смены 2 ч — без NaN, расходы ≥ 0, решатель сходится, работающие посты в норме ≥ 85 % времени', () => {
  for (const N of [2, 4, 6, 8]) {
    const ids = Array.from({ length: N }, (_, i) => `post${i + 1}`);
    const base = shiftParams('adaptive');
    const p: SimParams = { ...base, duration: 2 * 3600, record: 30, schedule: makeSchedule(ids, 2 * 3600, 100 + N), nFF: undefined,
      posts: ids.map(id => ({ id, B: 3, Qset: m3h(1500), etaNom: 0.9 })), openAngles: undefined, nConst: undefined };
    const r = simulate(makeNetwork(N), p);
    assert.equal(r.nonConverged, 0, `N=${N}`);
    for (const s of r.series) { assert.ok(Object.values(s.Q).every(q => Number.isFinite(q) && q >= 0)); assert.ok(Number.isFinite(s.C.Mn)); }
    assert.ok(r.underFlowShare < 0.15, `N=${N}: недобор ${(r.underFlowShare * 100).toFixed(1)} %`);
  }
});

// ---------- энергия
test('Электрическая энергия смены ≥ энергии на валу; КПД цепочки на номинале 0,867·0,95 = 0,824', () => {
  const p = shiftParams('constant'); p.duration = 600; p.record = 1; p.schedule = () => true;
  const r = simulate(demoNetwork(), p); const net = demoNetwork();
  for (const h of net.hoods) setDamper(net, h, p.openAngles![h]); net.fanSpeed = p.nConst!;
  const s = solve(net); assert.ok(electricPower(net.fan, s.power) > s.power);
  assert.ok(rel(r.series.at(-1)!.P, electricPower(net.fan, s.power)) < 0.002, `P = ${r.series.at(-1)!.P.toFixed(1)} против ${electricPower(net.fan, s.power).toFixed(1)}`);
  // интеграл энергии = сумма P·dt по шагам
  const sumE = r.series.reduce((a, x) => a + x.P, 0) / 3.6e6; assert.ok(rel(r.fanKWh, sumE) < 1e-9);
  // КПД цепочки «двигатель + ЧП» на номинальной нагрузке
  assert.ok(Math.abs(2200 / electricPower(net.fan, 2200) - 0.867 * 0.95) < 1e-12);
});

test('Линейный фильтр (m = 1): при снижении расхода вдвое его сопротивление падает вдвое, а не вчетверо', () => {
  const f = (demoNetwork().common[0] as any).spec; assert.equal(f.m, 1);
  const net = demoNetwork(); for (const h of net.hoods) setDamper(net, h, 0);
  net.fanSpeed = 1500; const a = solve(net); net.fanSpeed = 750; const b = solve(net);
  const fl = (Q: number) => f.dpNom * Q / f.qNom;
  assert.ok(rel(fl(b.Qtotal) / fl(a.Qtotal), b.Qtotal / a.Qtotal) < 1e-12);
});

test('15-минутное скользящее среднее: для постоянного сигнала = значению; всегда ≤ мгновенного максимума и ≥ среднесменной', () => {
  const p = shiftParams('adaptive'); p.nearField = { r: 1, s: 0.1 };
  const r = simulate(demoNetwork(), p);
  for (const id of ['post1', 'post2', 'post3']) assert.ok(r.bz15max[id] <= r.bzMax[id] + 1e-12 && r.bz15max[id] >= r.bzTWA[id] - 1e-12, id);
  assert.ok(Math.abs(r.bz15max.__room - r.maxC.Mn) < 0.01 * r.maxC.Mn + 0.002);
  const q = shiftParams('constant'); q.duration = 3000; q.schedule = () => false; q.nearField = { r: 1, s: 0.1 };
  const z = simulate(demoNetwork(), q); assert.ok(Math.abs(z.bz15max.post1 - q.substances[0].qIn) < 1e-12);
});
