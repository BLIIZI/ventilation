import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate, interp } from '../src/engine/sim.ts';
import { shift4, WIRE_12, MN } from '../src/engine/scenario4.ts';
import { demoNetwork } from '../src/engine/demo-network.ts';

test('Таблица проволоки: точки источника воспроизводятся, между ними — линейно', () => {
  assert.equal(interp(WIRE_12, 225), 2.36);
  assert.ok(Math.abs(interp(WIRE_12, 200) - (1.68 + 2.36) / 2) < 1e-9);
});

test('Упреждение: при постоянном токе расход ОВ = формуле блока 1 для C_уст', () => {
  const p = shift4('ff'); p.duration = 300; p.schedule = () => true; p.gen!.ffTau = undefined;
  p.posts.forEach(ps => (ps.current = () => 225)); p.record = 1;
  const r = simulate(demoNetwork(), p); const last = r.series[r.series.length - 1];
  const expected = 3 * (1 - 0.9) * MN.g * 1000 * 2.36 / 3600 / (p.gen!.Cset - MN.qIn) * 3600; // м³/ч
  assert.ok(Math.abs(last.Lgen - expected) / expected < 0.01, `${last.Lgen.toFixed(0)} vs ${expected.toFixed(0)}`);
});

test('Датчик компенсирует ошибку модели: при захвате 80 % вместо 90 % средняя концентрация ближе к уставке', () => {
  const ff = simulate(demoNetwork(), shift4('ff', { etaReal: 0.8 }));
  const fb = simulate(demoNetwork(), shift4('fffb', { etaReal: 0.8 }));
  const Cset = 0.1;
  assert.ok(Math.abs(fb.avgC.Mn - Cset) < Math.abs(ff.avgC.Mn - Cset), `ff ${ff.avgC.Mn.toFixed(3)}, fb ${fb.avgC.Mn.toFixed(3)}`);
  assert.ok(fb.avgLgen > ff.avgLgen);   // для этого датчик увеличил расход
});

test('Ни в одном режиме марганец не превышает ПДК', () => {
  for (const m of ['const', 'posts', 'ff', 'fffb'] as const) {
    const r = simulate(demoNetwork(), shift4(m));
    assert.equal(r.overPdkShare, 0, m);
  }
});
