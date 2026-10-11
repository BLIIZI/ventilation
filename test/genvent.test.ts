import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate, interp } from '../src/engine/sim.ts';
import { shift4, WIRE_12, MN } from '../src/engine/scenario4.ts';
import { wireRate, alphaMelt } from '../src/engine/norms.ts';
import { demoNetwork } from '../src/engine/demo-network.ts';

test('Расход проволоки по коэффициенту расплавления α_р = 9,05 + 3,1·10⁻⁴·I·l/d² (Ø1,2, l = 15 мм): ручной расчёт и таблица модели', () => {
  // 225 А: α_р = 9,05 + 3,1e-4·225·15/1,44 = 9,7766 г/(А·ч) → B = 2,1997 кг/ч
  assert.ok(Math.abs(alphaMelt(225) - (9.05 + 3.1e-4 * 225 * 15 / 1.44)) < 1e-12);
  assert.ok(Math.abs(wireRate(225) - 2.1997) < 1e-4);
  assert.ok(Math.abs(wireRate(175) - 1.6826) < 1e-4 && Math.abs(wireRate(270) - 2.6790) < 1e-4);
  for (const I of [100, 175, 200, 225, 270, 310]) assert.ok(Math.abs(interp(WIRE_12, I) - wireRate(I)) / wireRate(I) < 2e-4, `I=${I}`);
  assert.equal(wireRate(0), 0);
});

test('Упреждение: при постоянном токе расход ОВ = формуле СП 60 для C_уст (весь воздух минус местные отсосы)', () => {
  const p = shift4('ff'); p.duration = 300; p.schedule = () => true; p.gen!.ffTau = undefined;
  p.posts.forEach(ps => (ps.current = () => 175)); p.record = 1;   // 175 А: расход ниже L_max
  const r = simulate(demoNetwork(), p); const last = r.series[r.series.length - 1];
  // СП 60: весь удаляемый воздух L = G/(C_уст − q_пр); общеобменная = L − расход местных отсосов (L_wz)
  const expected = 3 * (1 - p.posts[0].etaNom) * MN.g * 1000 * wireRate(175) / 3600 / (p.gen!.Cset - MN.qIn) * 3600 - last.Qtot; // м³/ч
  assert.ok(Math.abs(last.Lgen - expected) / expected < 0.01, `${last.Lgen.toFixed(0)} vs ${expected.toFixed(0)}`);
});

test('Датчик компенсирует ошибку модели: при захвате 70 % вместо расчётных 80 % средняя концентрация ближе к уставке', () => {
  const ff = simulate(demoNetwork(), shift4('ff', { etaReal: 0.7 }));
  const fb = simulate(demoNetwork(), shift4('fffb', { etaReal: 0.7 }));
  const Cset = 0.1;
  // при недооценке выделения одно упреждение превышает уставку; датчик удерживает среднее не выше уставки и снижает пик
  assert.ok(ff.avgC.Mn > Cset * 1.03, `ff ${ff.avgC.Mn.toFixed(3)}`);
  assert.ok(fb.avgC.Mn <= Cset * 1.03, `fb ${fb.avgC.Mn.toFixed(3)}`);
  assert.ok(fb.maxC.Mn < ff.maxC.Mn, `пик fb ${fb.maxC.Mn.toFixed(3)} против ff ${ff.maxC.Mn.toFixed(3)}`);
  assert.ok(fb.avgLgen > ff.avgLgen);   // для этого датчик увеличил расход
});

test('Ни в одном режиме марганец не превышает ПДК', () => {
  for (const m of ['const', 'posts', 'ff', 'fffb'] as const) {
    const r = simulate(demoNetwork(), shift4(m));
    assert.equal(r.overPdkShare, 0, m);
  }
});
