import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate } from '../src/engine/sim.ts';
import type { SimParams } from '../src/engine/sim.ts';
import { demoNetwork } from '../src/engine/demo-network.ts';
import { m3h } from '../src/engine/physics.ts';

const base = (over: Partial<SimParams> = {}): SimParams => ({
  mode: 'adaptive', dt: 1, duration: 600, schedule: () => true, record: 1,
  posts: ['post1', 'post2', 'post3'].map(id => ({ id, B: 3, Qset: m3h(1500), etaNom: 0.9 })),
  substances: [{ name: 'Mn', g: 1.9, pdk: 0.2, qIn: 0.001 }],
  room: { V: 1000, Lgen: m3h(8600), dT: 20 }, damperStroke: 8, fanRamp: 10, nMax: 1500, nMin: 300, kI: 4, ...over,
});

test('Адаптивный режим: все посты выходят на 1500 м³/ч ±2 % за 2 минуты', () => {
  const r = simulate(demoNetwork(), base({ duration: 180 }));
  const last = r.series[r.series.length - 1];
  for (const id of ['post1', 'post2', 'post3']) assert.ok(Math.abs(last.Q[id] - 1500) < 30, `${id}: ${last.Q[id].toFixed(0)}`);
});

test('Выключение постов снижает частоту вентилятора', () => {
  const r = simulate(demoNetwork(), base({ duration: 400, schedule: (id, t) => id === 'post1' || t < 200 }));
  const at = (t: number) => r.series.find(s => s.t === t)!;
  assert.ok(at(399).n < at(199).n - 200, `n: ${at(199).n.toFixed(0)} → ${at(399).n.toFixed(0)}`);
  assert.ok(at(399).alpha.post2 > 85 && at(399).alpha.post3 > 85);
});

test('Связь блоков: установившаяся концентрация = q_пр + Σ(1−η)G / L (формула блока 1)', () => {
  const r = simulate(demoNetwork(), base({ duration: 6 * 3600, record: 3600 }));
  const last = r.series[r.series.length - 1];
  const Lout = (last.Q.post1 + last.Q.post2 + last.Q.post3) / 3600 + m3h(8600);
  const G = 3 * (1 - 0.9) * 1.9 * 1000 * 3 / 3600; // мг/с
  const Cexp = 0.001 + G / Lout;
  assert.ok(Math.abs(last.C.Mn - Cexp) / Cexp < 0.01, `модель ${last.C.Mn.toFixed(4)}, формула ${Cexp.toFixed(4)}`);
});

test('Без регулирования энергия = мощность × время', () => {
  const r = simulate(demoNetwork(), base({ mode: 'constant', duration: 3600 }));
  const P = r.series[r.series.length - 1].P; // Вт, установившийся режим
  assert.ok(Math.abs(r.fanKWh - P / 1000) / (P / 1000) < 0.02);
});

test('Пост выключен — заслонка закрыта, концентрация не растёт', () => {
  const r = simulate(demoNetwork(), base({ duration: 600, schedule: () => false, mode: 'onoff' }));
  assert.ok(r.maxC.Mn <= 0.001 + 1e-9);
  assert.equal(r.fanKWh, 0);
});
