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
import { bendZeta, bendKRe, bendKDelta, bendZetaRough, lambdaSmooth, suddenExpansionZeta, diffuserZeta, diffuserZetaN2, teeSideZeta, teeStraightZeta, teeA } from '../src/engine/fittings.ts';
import { lossBreakdown, solve as solveNet } from '../src/engine/network.ts';
import { lambdaAltshul as lam } from '../src/engine/physics.ts';
test('Отвод по Идельчику (диагр. 6-1): ζ_м = A₁·B₁; A₁ из таблицы (45° → 0,60; 90° → 1,00); B₁ = 0,21/(R/D)^0,5 при R/D > 1', () => {
  assert.ok(Math.abs(bendZeta(90, 1) - 0.21) < 1e-12);
  assert.ok(Math.abs(bendZeta(90, 1.5) - 0.21 / Math.sqrt(1.5)) < 1e-12);
  assert.ok(Math.abs(bendZeta(45, 1) / bendZeta(90, 1) - 0.60) < 1e-12);
  assert.ok(bendZeta(30, 1) < bendZeta(60, 1) && bendZeta(60, 1) < bendZeta(90, 1));
  assert.ok(bendZeta(90, 0.5) > bendZeta(90, 1) && bendZeta(90, 1) > bendZeta(90, 3));
});
test('Отвод в стальном воздуховоде: поправки k_Re и k_Δ (п. 2 диагр. 6-1); ручной пример d 200 мм, w 13,26 м/с; непрерывность по Re', () => {
  // Re = 13,26·0,2/15,06e-6 = 176 100; k_Re = 1,3 − 0,29·ln(1,761) = 1,1359
  const Re = 13.26 * 0.2 / 15.06e-6, kRe = 1.3 - 0.29 * Math.log(Re * 1e-5);
  assert.ok(Math.abs(bendKRe(Re, 1.5) - kRe) < 1e-12 && Math.abs(kRe - 1.136) < 0.001);
  // λ_гл = 1/(1,8 lg Re − 1,64)² = 0,01643; λ_Δ (Альтшуль) = 0,01898 → k_Δ в зоне сглаживания 1,6e5…2,5e5 между 1,155 и 1,5
  const lr = lam(13.26, 0.2), kd = bendKDelta(Re, lr, 0.0005);
  assert.ok(Math.abs(lambdaSmooth(Re) - 0.01643) < 2e-4 && kd > lr / lambdaSmooth(Re) - 1e-9 && kd < 1.5);
  for (const R of [3.2e4, 5e4, 1.6e5, 2.5e5]) for (const k of [0.9999, 1.0001]) assert.ok(Math.abs(bendKDelta(R * k, 0.02, 0.0005) - bendKDelta(R, 0.02, 0.0005)) < 0.01, `Re ${R}`);
  assert.ok(bendZetaRough(90, 1.5, Re, lr, 0.0005) > bendZeta(90, 1.5));
});
test('Диффузор по Идельчику (диагр. 5-2, ф. 5-6, 5-7): при n = 2 — табличное значение; меньше внезапного расширения; одинаковые сечения — 0', () => {
  assert.ok(Math.abs(suddenExpansionZeta(0.2, 0.4) - (1 - 0.25) ** 2) < 1e-12);
  assert.ok(diffuserZeta(0.2, 0.4) < suddenExpansionZeta(0.2, 0.4) && diffuserZeta(0.3, 0.3) === 0);
  // n = 2 (d₂/d₁ = √2), α = 14°, Re = 1e5 → табл. с. 211: 0,102 (и при любом λ, т.к. ζ_тр(2) вычитается и прибавляется)
  assert.ok(Math.abs(diffuserZeta(0.2, 0.2 * Math.SQRT2, 14, 1e5, 0.02) - 0.102) < 1e-9);
  assert.ok(Math.abs(diffuserZetaN2(16, 2e5) - 0.073) < 1e-12 && Math.abs(diffuserZetaN2(15, 1e5) - 0.112) < 1e-12);
});
test('Тройник на слияние: проход ζ = 1,55r − r² (r = Q_б/Q_с); бок при r → 0 отрицателен (эжекция), растёт с r', () => {
  assert.equal(teeStraightZeta(0, 1), 0); assert.ok(Math.abs(teeStraightZeta(0.5, 1) - 0.525) < 1e-12);
  assert.ok(teeSideZeta(1e-9, 1, 0.2, 0.2) < 0);
  let prev = -Infinity; for (let r = 0; r <= 1; r += 0.05) { const z = teeSideZeta(r, 1, 0.2, 0.315); assert.ok(z > prev); prev = z; }
});
test('Тройник: коэффициент A по Идельчику (диагр. 7-4, табл. 7-1): F_б/F_с ≤ 0,35 → 1; иначе max(0,9(1 − r); 0,55) — непрерывно; ручной пример', () => {
  assert.equal(teeA(0.25, 0.5), 1); assert.ok(Math.abs(teeA(0.4, 0.2) - 0.72) < 1e-12); assert.equal(teeA(0.4, 0.5), 0.55);
  // пример: d_б = 0,2, d_с = 0,315 (F_б/F_с = 0,403), r = 0,5 → ζ = 0,55·[1 + (0,5·2,4806)² − 2·0,25] = 0,55·2,0384 = 1,1211
  const fr = (0.315 / 0.2) ** 2; assert.ok(Math.abs(teeSideZeta(0.5, 1, 0.2, 0.315) - 0.55 * (1 + (0.5 * fr) ** 2 - 0.5)) < 1e-12);
  assert.ok(Math.abs(0.55 * (1 + (0.5 * fr) ** 2 - 0.5) - 1.1211) < 1e-3);
  // A непрерывна (табличный скачок 0,54 → 0,55 при r = 0,4 сглажен max(…)) — иначе у сети может не быть точного решения
  for (let r = 0.3; r < 0.5; r += 0.001) assert.ok(Math.abs(teeA(0.4, r) - teeA(0.4, r + 1e-7)) < 1e-6);
  assert.ok(Math.abs(teeA(0.4, 0.4) - 0.55) < 1e-12 && Math.abs(teeA(0.4, 0.38) - 0.558) < 1e-12);
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
