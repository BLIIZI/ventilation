import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ductLoss, m3h, damperZeta, fanPressure } from '../src/engine/physics.ts';
import { solve, setDamper } from '../src/engine/network.ts';
import { balance } from '../src/engine/balance.ts';
import { demoNetwork } from '../src/engine/demo-network.ts';

const near = (a: number, b: number, rel: number) => Math.abs(a - b) <= Math.abs(b) * rel;

test('Контрольный пример: участки сети из диплома (табл. 4.1), отклонение ≤ 3 %', () => {
  const rows: Array<[number, number, number, number, number]> = [ // L м³/ч, l м, d м, Σζ, Δp диплома Па
    [263.67, 5, 0.14, 1.47, 31.814], [527.33, 5, 0.16, 0.07, 23.773], [791, 2.5, 0.2, 0.07, 9.611],
    [1582, 7, 0.25, 1.73, 108.523], // участок 4 приточной сети (табл. 3.2)
    [263.67, 0.1, 0.14, 1.4, 19.248],
  ];
  for (const [L, l, d, z, dp] of rows) {
    const calc = ductLoss(m3h(L), d, l, z);
    assert.ok(near(calc, dp, 0.03), `L=${L}: расчёт ${calc.toFixed(2)} Па, диплом ${dp}`);
  }
});

test('Нестыковка в дипломе: участок 4 вытяжки (табл. 4.1) соответствует l = 12 м, а не 7 м', () => {
  assert.ok(!near(ductLoss(m3h(1582), 0.25, 7, 1.88), 133.827, 0.03));
  assert.ok(near(ductLoss(m3h(1582), 0.25, 12, 1.88), 133.827, 0.01));
});

test('ζ заслонки монотонно растёт с углом', () => {
  for (let a = 0; a < 90; a += 1) assert.ok(damperZeta(a + 1) > damperZeta(a));
});

test('Законы подобия: при половинной частоте давление в 4 раза меньше', () => {
  const fan = demoNetwork().fan;
  assert.ok(near(fanPressure(fan, 0, 750), fanPressure(fan, 0, 1500) / 4, 1e-9));
});

test('Сохранение массы и сходимость', () => {
  const s = solve(demoNetwork());
  assert.ok(s.converged);
  assert.ok(near(s.Q.post1 + s.Q.post2 + s.Q.post3, s.Qtotal, 1e-9));
  assert.ok(near(s.Q.c3, s.Qtotal, 1e-9));
});

test('Прикрытие заслонки: расход ветви падает, в соседних растёт', () => {
  const net = demoNetwork(); const a = solve(net);
  setDamper(net, 'post3', 45); const b = solve(net);
  assert.ok(b.Q.post3 < a.Q.post3);
  assert.ok(b.Q.post1 > a.Q.post1 && b.Q.post2 > a.Q.post2);
  assert.ok(b.Qtotal < a.Qtotal);
});

test('Рост частоты вентилятора увеличивает все расходы', () => {
  const net = demoNetwork(); net.fanSpeed = 1200; const a = solve(net);
  net.fanSpeed = 1500; const b = solve(net);
  for (const h of net.hoods) assert.ok(b.Q[h] > a.Q[h]);
});

test('Загрязнение фильтра снижает общий расход', () => {
  const net = demoNetwork(); const a = solve(net);
  (net.common[0] as any).spec.fouling = 2; const b = solve(net);
  assert.ok(b.Qtotal < a.Qtotal);
});

test('Регулирование: посты получают требуемый расход, критическая заслонка открыта', () => {
  const net = demoNetwork();
  const r = balance(net, { post1: m3h(1500), post2: m3h(1500), post3: m3h(1500) });
  assert.ok(r.feasible, r.message);
  for (const h of net.hoods) assert.ok(near(r.sol.Q[h], m3h(1500), 0.01), `${h}: ${(r.sol.Q[h] * 3600).toFixed(0)}`);
  assert.ok(Math.min(...Object.values(r.angles)) < 3);
});

test('Недостижимый расход — понятное предупреждение', () => {
  const r = balance(demoNetwork(), { post1: m3h(4000), post2: m3h(4000), post3: m3h(4000) });
  assert.equal(r.feasible, false);
  assert.match(r.message, /недостижим/);
});

// ---------- местные сопротивления (Идельчик, 1992) и энергетический баланс сети
import { bendZeta, suddenExpansionZeta, diffuserZeta, teeSideZeta, teeStraightZeta } from '../src/engine/fittings.ts';
import { lossBreakdown, solve as solveNet } from '../src/engine/network.ts';
import { lambdaAltshul as lam } from '../src/engine/physics.ts';
test('Отвод: ζ(90°, R/D = 1) = 0,21; ζ(90°, R/D = 1,5) = 0,21/√1,5 = 0,171; 45° ≈ 0,62·B₁; ζ растёт с углом и падает с R/D', () => {
  assert.ok(Math.abs(bendZeta(90, 1) - 0.21) < 0.001);
  assert.ok(Math.abs(bendZeta(90, 1.5) - 0.21 / Math.sqrt(1.5)) < 0.001);
  assert.ok(Math.abs(bendZeta(45, 1) / bendZeta(90, 1) - 0.62) < 0.01);
  assert.ok(bendZeta(30, 1) < bendZeta(60, 1) && bendZeta(60, 1) < bendZeta(90, 1));
  assert.ok(bendZeta(90, 0.5) > bendZeta(90, 1) && bendZeta(90, 1) > bendZeta(90, 3));
});
test('Расширение: Борда–Карно (1 − F₁/F₂)²; диффузор 15° — меньше внезапного; одинаковые сечения — 0', () => {
  assert.ok(Math.abs(suddenExpansionZeta(0.2, 0.4) - (1 - 0.25) ** 2) < 1e-12);
  assert.ok(diffuserZeta(0.2, 0.4) < suddenExpansionZeta(0.2, 0.4) && diffuserZeta(0.3, 0.3) === 0);
});
test('Тройник на слияние: проход ζ = 1,55r − r² (r = Q_б/Q_с); бок при r → 0 отрицателен (эжекция), растёт с r', () => {
  assert.equal(teeStraightZeta(0, 1), 0); assert.ok(Math.abs(teeStraightZeta(0.5, 1) - 0.525) < 1e-12);
  assert.ok(teeSideZeta(1e-9, 1, 0.2, 0.2) < 0);
  let prev = -Infinity; for (let r = 0; r <= 1; r += 0.05) { const z = teeSideZeta(r, 1, 0.2, 0.315); assert.ok(z > prev); prev = z; }
});
test('Трение: λ непрерывна на границах режимов (Re = 2000 и 4000)', () => {
  const nu = 15.06e-6, d = 0.2, w = (Re: number) => Re * nu / d;
  for (const R of [2000, 4000]) assert.ok(Math.abs(lam(w(R - 1e-6), d) - lam(w(R + 1e-6), d)) < 1e-6, `Re = ${R}`);
});
test('Энергетический баланс: на каждом пути «отсос → выброс» сумма потерь всех элементов = давлению вентилятора (±0,01 Па)', () => {
  const net = demoNetwork(); setDamper(net, 'post2', 35); net.fanSpeed = 1300;
  const s = solveNet(net), br = lossBreakdown(net, s), bySeg = new Map<string, number>();
  for (const r of br) bySeg.set(r.seg, (bySeg.get(r.seg) ?? 0) + r.dp);
  for (const h of net.hoods) {
    let sum = bySeg.get('common')!, sg = net.segments.find(x => x.id === h);
    while (sg) { sum += bySeg.get(sg.id)!; sg = sg.parent ? net.segments.find(x => x.id === sg!.parent) : undefined; }
    assert.ok(Math.abs(sum - s.pFan) < 0.01, `${h}: Σ потерь ${sum.toFixed(3)} против p вент. ${s.pFan.toFixed(3)}`);
  }
  for (const k of ['local', 'diffuser', 'teeSide', 'teeStraight', 'damper', 'duct', 'filter']) assert.ok(br.some(r => r.kind === k), k);
});
