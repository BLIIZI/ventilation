// Аудит: свойства модели на сотнях случайных конфигураций, сохранение массы и энергии, сходимость, крайние режимы.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ductLoss, lambdaAltshul, damperZeta, damperAngleForZeta, fanPressure, m3h, AIR, area, electricPower } from '../src/engine/physics.ts';
import { solve, setDamper } from '../src/engine/network.ts';
import type { Network } from '../src/engine/network.ts';
import { balance } from '../src/engine/balance.ts';
import { demoNetwork, makeNetwork, pickMotor } from '../src/engine/demo-network.ts';
import { simulate, createSimulator } from '../src/engine/sim.ts';
import { shift4 } from '../src/engine/scenario4.ts';
import { shiftParams } from '../src/engine/scenario.ts';

let seed = 42; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-12);

// ---------- физика
test('Альтшуль против Колбрука–Уайта: расхождение ≤ 6 % (Re 10⁴…10⁶, d 0,1…0,63 м)', () => {
  const colebrook = (Re: number, d: number, ke = 1e-4) => { let l = 0.02; for (let i = 0; i < 50; i++) l = Math.pow(-2 * Math.log10(ke / (3.7 * d) + 2.51 / (Re * Math.sqrt(l))), -2); return l; };
  let worst = 0;
  for (const d of [0.1, 0.16, 0.25, 0.4, 0.63]) for (const Re of [1e4, 3e4, 1e5, 3e5, 1e6]) {
    const w = Re * AIR.nu / d; worst = Math.max(worst, rel(lambdaAltshul(w, d), colebrook(Re, d)));
  }
  assert.ok(worst <= 0.06, `макс. расхождение ${(worst * 100).toFixed(1)} %`);
});

test('Потери на участке растут ~ Q² (в квадратичной зоне показатель 1,8…2,0)', () => {
  const a = ductLoss(m3h(1000), 0.25, 10, 1), b = ductLoss(m3h(2000), 0.25, 10, 1);
  const n = Math.log(b / a) / Math.log(2); assert.ok(n > 1.8 && n <= 2.0, `показатель ${n.toFixed(3)}`);
});

test('Нулевой расход — нулевые потери; знак потерь следует за знаком расхода', () => {
  assert.equal(ductLoss(0, 0.2, 5, 1), 0);
  assert.ok(ductLoss(-m3h(500), 0.2, 5, 1) < 0);
});

test('Обратная функция заслонки: α(ζ(α)) = α с точностью 0,01° на всём диапазоне', () => {
  for (let a = 0; a <= 90; a += 0.5) assert.ok(Math.abs(damperAngleForZeta(damperZeta(a)) - a) < 0.01, `α=${a}`);
});

test('Характеристика вентилятора монотонно падает с расходом; при n=0 давление 0', () => {
  const f = demoNetwork().fan; let prev = Infinity;
  for (let q = 0; q <= 7000; q += 100) { const p = fanPressure(f, m3h(q), 1500); assert.ok(p <= prev + 1e-9); prev = p; }
  assert.equal(fanPressure(f, m3h(1000), 0), 0);
});

// ---------- решатель сети: фаззинг
function residuals(net: Network, Q: Record<string, number>) {
  // независимая проверка баланса давлений по каждому пути отсос → вентилятор
  const byId = new Map(net.segments.map(s => [s.id, s]));
  const el = (e: any, q: number) => e.kind === 'duct' ? ductLoss(q, e.d, e.l, e.zeta) : e.kind === 'damper' ? ductLoss(q, e.d, 0, damperZeta(e.alpha)) : e.spec.dpNom * Math.pow(q / e.spec.qNom, e.spec.m) * e.spec.fouling;
  const Qt = net.hoods.reduce((a, h) => a + Q[h], 0);
  const pf = fanPressure(net.fan, Qt, net.fanSpeed) - net.common.reduce((a, e) => a + el(e, Qt), 0);
  return net.hoods.map(h => { let s = byId.get(h), sum = 0; while (s) { sum += s.elements.reduce((a, e) => a + el(e, Q[s!.id]), 0); s = s.parent ? byId.get(s.parent) : undefined; } return sum - pf; });
}

test('Фаззинг: 300 случайных режимов сети 3 постов — сходимость, баланс давлений < 0,01 Па, сохранение массы', () => {
  for (let k = 0; k < 300; k++) {
    const net = demoNetwork();
    for (const h of net.hoods) setDamper(net, h, rnd() * 75);
    net.fanSpeed = 400 + rnd() * 1100; (net.common[0] as any).spec.fouling = 1 + rnd() * 2;
    const s = solve(net);
    assert.ok(s.converged, `режим ${k} не сошёлся`);
    const r = residuals(net, s.Q); assert.ok(Math.max(...r.map(Math.abs)) < 0.01, `режим ${k}: невязка ${Math.max(...r.map(Math.abs))}`);
    assert.ok(rel(s.Q.c3, s.Qtotal) < 1e-12 && rel(s.Q.c2, s.Q.post1 + s.Q.post2) < 1e-12);
    for (const h of net.hoods) assert.ok(s.Q[h] > 0);
  }
});

test('Масштабируемость: сети на 1, 5, 10, 20, 30 постов сходятся, расходы положительны', () => {
  for (const N of [1, 5, 10, 20, 30]) {
    const net = makeNetwork(N); const t0 = Date.now(); const s = solve(net);
    assert.ok(s.converged, `N=${N}`);
    assert.ok(net.hoods.every(h => s.Q[h] > 0));
    const r = residuals(net, s.Q); assert.ok(Math.max(...r.map(Math.abs)) < 0.01, `N=${N}`);
    assert.ok(Date.now() - t0 < 3000, `N=${N}: ${Date.now() - t0} мс`);
  }
});

test('Монотонность: прикрытие любой заслонки уменьшает её расход и увеличивает расходы всех остальных (100 случаев, 5 постов)', () => {
  for (let k = 0; k < 100; k++) {
    const net = makeNetwork(5); for (const h of net.hoods) setDamper(net, h, rnd() * 50);
    const a = solve(net); const j = net.hoods[Math.floor(rnd() * 5)];
    const alpha0 = (net.segments.find(s => s.id === j)!.elements[1] as any).alpha;
    setDamper(net, j, alpha0 + 5 + rnd() * 20); const b = solve(net);
    assert.ok(b.Q[j] < a.Q[j]);
    for (const h of net.hoods) if (h !== j) assert.ok(b.Q[h] > a.Q[h]);
  }
});

test('Законы подобия в сети без статического напора: Q ~ n, p ~ n², N ~ n³ (±0,5 %)', () => {
  // при фиксированных заслонках и квадратичной сети расход пропорционален частоте (Re-зависимость λ даёт малую поправку)
  const a = solve(Object.assign(demoNetwork(), { fanSpeed: 1500 })), b = solve(Object.assign(demoNetwork(), { fanSpeed: 750 }));
  assert.ok(Math.abs(b.Qtotal / a.Qtotal - 0.5) < 0.01, `Q: ${(b.Qtotal / a.Qtotal).toFixed(4)}`);
  assert.ok(Math.abs(b.pFan / a.pFan - 0.25) < 0.01, `p: ${(b.pFan / a.pFan).toFixed(4)}`);
  assert.ok(Math.abs(b.power / a.power - 0.125) < 0.01, `N: ${(b.power / a.power).toFixed(4)}`);
});

test('Все заслонки закрыты: утечка через каждую = истечение через ζ(90°) при перепаде ≈ давлению вентилятора', () => {
  // Независимая проверка: Q_ут = A·√(2Δp/(ρ·Σζ)). Σζ ветви ≈ ζ(90°) = 10⁴ (остальное пренебрежимо). [Д] ζ(90°) — модель утечки неуплотнённой заслонки
  const net = demoNetwork(); for (const h of net.hoods) setDamper(net, h, 90);
  const s = solve(net);
  for (const h of net.hoods) {
    const qTheory = area(0.2) * Math.sqrt(2 * s.pFan / (AIR.rho * damperZeta(90)));
    assert.ok(s.Q[h] <= qTheory * 1.001 && s.Q[h] > qTheory * 0.97, `${h}: ${(s.Q[h] * 3600).toFixed(1)} против ${(qTheory * 3600).toFixed(1)} м³/ч`);
    assert.ok(s.Q[h] * 3600 < 0.05 * 1500, 'утечка > 5 % номинала');
  }
  assert.ok(s.pFan > 0.98 * fanPressure(net.fan, s.Qtotal, net.fanSpeed) && s.pFan > 1350);
});

test('Мощность вентилятора не бывает отрицательной даже за пределами характеристики', () => {
  const net = demoNetwork(); (net.common[0] as any).spec.dpNom = 0; (net.common[1] as any).zeta = 0;
  for (const s of net.segments) for (const e of s.elements as any[]) if (e.kind === 'duct') { e.zeta = 0; e.l = 0.01; e.d = 0.6; }
  const r = solve(net); assert.ok(r.power >= 0, `мощность ${r.power.toFixed(0)} Вт при p = ${r.pFan.toFixed(0)} Па`);
});

// ---------- регулирование (установившееся)
test('balance: 60 случайных наборов требований — либо выполнено ±1 % с открытой критической заслонкой, либо честный отказ', () => {
  for (let k = 0; k < 60; k++) {
    const net = makeNetwork(4); const req: Record<string, number> = {};
    for (const h of net.hoods) req[h] = rnd() < 0.3 ? 0 : m3h(800 + rnd() * 1400);
    if (Object.values(req).every(v => v === 0)) req.post1 = m3h(1000);
    const r = balance(net, req);
    if (r.feasible) {
      for (const h of net.hoods) if (req[h] > 0) assert.ok(rel(r.sol.Q[h], req[h]) < 0.01, `случай ${k}, ${h}: ${(r.sol.Q[h] * 3600).toFixed(0)} из ${(req[h] * 3600).toFixed(0)}`);
      const act = net.hoods.filter(h => req[h] > 0);
      assert.ok(Math.min(...act.map(h => r.angles[h])) < 3, `случай ${k}: критическая заслонка не открыта`);
    } else assert.match(r.message, /недостижим/);
  }
});

test('balance: минимальная частота действительно минимальна (на 3 % ниже — кто-то недополучает)', () => {
  const net = demoNetwork(); const req = { post1: m3h(1500), post2: m3h(1200), post3: m3h(900) };
  const r = balance(net, req); assert.ok(r.feasible);
  const net2 = demoNetwork(); net2.fanSpeed = r.fanSpeed * 0.97;
  for (const h of net2.hoods) setDamper(net2, h, 0);
  const s = solve(net2); assert.ok(net2.hoods.some(h => s.Q[h] < (req as any)[h]));
});

// ---------- динамика
test('Детерминизм: два одинаковых прогона смены дают одинаковый результат', () => {
  const a = simulate(demoNetwork(), shift4('fffb')), b = simulate(demoNetwork(), shift4('fffb'));
  assert.equal(a.heatKWh, b.heatKWh); assert.equal(a.avgC.Mn, b.avgC.Mn);
});

test('Сохранение массы марганца за смену: V·ΔC = Σ(поступление − удаление)·dt (относ. ошибка < 10⁻⁹)', () => {
  const p = shift4('fffb'); p.duration = 3 * 3600; p.record = 1;
  const sim = createSimulator(demoNetwork(), p); let prevC = p.substances[0].qIn, bal = 0;
  const B = (I: number) => (I <= 175 ? 1.68 * I / 175 : I <= 225 ? 1.68 + (I - 175) * (2.36 - 1.68) / 50 : 2.36 + (I - 225) * (3.73 - 2.36) / 45);
  for (let t = 0; t <= p.duration; t += 1) {
    const s = sim.step(); let G = 0;
    for (const ps of p.posts) if (s.on[ps.id]) { const eta = ps.etaNom * Math.min(1, s.Q[ps.id] / 3600 / ps.Qset); G += (1 - eta) * 1.9 * 1000 * B(ps.current!(t)) / 3600; }
    bal += G - (s.Qtot + s.Lgen) / 3600 * (prevC - 0.001); prevC = s.C.Mn;
  }
  const V = p.room.V; const lhs = V * (prevC - 0.001), rhs = bal;
  assert.ok(rel(lhs, rhs) < 1e-9, `V·ΔC = ${lhs.toFixed(3)}, баланс = ${rhs.toFixed(3)} мг`);
});

test('Энергия тепла = 1,2 кВт/(м³/с·К) × ∫L dt × Δt (сверка интеграла)', () => {
  const p = shift4('fffb'); p.duration = 7200; p.record = 1;
  const sim = createSimulator(demoNetwork(), p); let LdT = 0;
  for (let t = 0; t <= p.duration; t++) { const s = sim.step(); LdT += (s.Qtot + s.Lgen) / 3600; }
  const r = sim.result(); const expected = 1.2 * LdT * p.room.dT / 3600;
  assert.ok(rel(r.heatKWh, expected) < 1e-9);
});

test('Сходимость по шагу времени: dt = 0,5 с и 1 с дают одинаковые итоги смены (±2 %)', () => {
  const run = (dt: number) => { const p = shift4('fffb'); p.dt = dt; p.duration = 3 * 3600; return simulate(demoNetwork(), p); };
  const a = run(1), b = run(0.5);
  assert.ok(rel(a.heatKWh, b.heatKWh) < 0.02, `тепло ${a.heatKWh.toFixed(1)} / ${b.heatKWh.toFixed(1)}`);
  assert.ok(rel(a.avgC.Mn, b.avgC.Mn) < 0.02, `Mn ${a.avgC.Mn.toFixed(4)} / ${b.avgC.Mn.toFixed(4)}`);
});

test('Линейность помещения: при постоянной вентиляции удвоение выделения удваивает прирост концентрации', () => {
  const run = (g: number) => { const p = shift4('const'); p.duration = 3600; p.substances[0] = { ...p.substances[0], g, qIn: 0 }; return simulate(demoNetwork(), p).avgC.Mn; };
  assert.ok(rel(run(3.8), 2 * run(1.9)) < 1e-6);
});

test('Пусконаладка: в режиме «без регулирования» все посты получают 1500 ± 1 %', () => {
  const p = shiftParams('constant'); p.duration = 300; p.record = 1; p.schedule = () => true;
  const r = simulate(demoNetwork(), p); const last = r.series[r.series.length - 1];
  for (const id of ['post1', 'post2', 'post3']) assert.ok(Math.abs(last.Q[id] - 1500) < 15, `${id}: ${last.Q[id].toFixed(0)}`);
});

test('Загрязнённый фильтр ×1,25 (режим ещё достижим, предел ×1,3): регулятор поднимает частоту и держит 1500 ±2 %', () => {
  const req = { post1: m3h(1500), post2: m3h(1500), post3: m3h(1500) };
  const nf = demoNetwork(); (nf.common[0] as any).spec.fouling = 1.25;
  assert.ok(balance(nf, req).feasible, 'режим должен быть достижим по статике');
  const p = shiftParams('adaptive'); p.duration = 600; p.record = 1; p.schedule = () => true;
  const net = demoNetwork(); (net.common[0] as any).spec.fouling = 1.25;
  const last = simulate(net, p).series.at(-1)!, clean = simulate(demoNetwork(), { ...p }).series.at(-1)!;
  assert.ok(last.n > clean.n + 20, `частота ${clean.n.toFixed(0)} → ${last.n.toFixed(0)}`);
  for (const id of ['post1', 'post2', 'post3']) assert.ok(Math.abs(last.Q[id] - 1500) < 30, `${id}: ${last.Q[id].toFixed(0)}`);
});

test('Фильтр ×3 (недостижимо): динамика выходит ровно на статический предел — n = n_max, расходы = расчёт balance ±1 %', () => {
  const req = { post1: m3h(1500), post2: m3h(1500), post3: m3h(1500) };
  const nf = demoNetwork(); (nf.common[0] as any).spec.fouling = 3;
  const b = balance(nf, req); assert.equal(b.feasible, false); assert.match(b.message, /недостижим/);
  const p = shiftParams('adaptive'); p.duration = 600; p.record = 1; p.schedule = () => true;
  const net = demoNetwork(); (net.common[0] as any).spec.fouling = 3;
  const last = simulate(net, p).series.at(-1)!;
  assert.ok(last.n > 1499, `n = ${last.n.toFixed(0)}`);
  for (const id of ['post1', 'post2', 'post3']) assert.ok(rel(last.Q[id], b.sol.Q[id] * 3600) < 0.01, `${id}: ${last.Q[id].toFixed(0)} против ${(b.sol.Q[id] * 3600).toFixed(0)}`);
});

// ---------- привод: КПД двигателя и ЧП
test('Электрическая мощность ≥ мощности на валу; при номинале = P_вал/(η_дв·η_ЧП) = P/(0,867·0,95)', () => {
  const f = demoNetwork().fan;
  assert.ok(Math.abs(electricPower(f, 2200) - 2200 / (0.867 * 0.95)) < 1e-6);
  for (let w = 10; w <= 2500; w += 10) assert.ok(electricPower(f, w) >= w / 0.867 / 0.95 - 1e-9);
  assert.equal(electricPower(f, 0), 0); assert.equal(electricPower(f, -50), 0);
});

test('Подбор двигателя IE3: ближайший стандартный ≥ мощности на валу; makeNetwork(N) всегда в пределах двигателя', () => {
  assert.deepEqual(pickMotor(1900), { motorW: 2200, motorEta: 0.867 });
  assert.deepEqual(pickMotor(3001), { motorW: 4000, motorEta: 0.886 });
  for (const N of [1, 2, 3, 5, 10, 20]) {
    const net = makeNetwork(N); for (const h of net.hoods) setDamper(net, h, 0); net.fanSpeed = 1500;
    let maxP = 0; for (const fo of [1, 2, 3]) { (net.common[0] as any).spec.fouling = fo; maxP = Math.max(maxP, solve(net).power); }
    assert.ok(maxP <= net.fan.motorW! * 1.0, `N=${N}: ${maxP.toFixed(0)} Вт > ${net.fan.motorW}`);
  }
});

// ---------- общеобменная: anti-windup
test('Anti-windup ОВ: на смене снижает пик Mn и при верной модели, и при ошибке захвата (η 0,8)', () => {
  for (const etaReal of [undefined, 0.8]) {
    const on = simulate(demoNetwork(), shift4('fffb', { etaReal }));
    const pOff = shift4('fffb', { etaReal }); pOff.gen!.antiWindup = false;
    const off = simulate(demoNetwork(), pOff);
    assert.ok(on.maxC.Mn < off.maxC.Mn * 0.97, `η=${etaReal}: пик ${on.maxC.Mn.toFixed(4)} против ${off.maxC.Mn.toFixed(4)}`);
    assert.ok(Math.abs(on.heatKWh - off.heatKWh) / off.heatKWh < 0.03, 'тепло почти не меняется');
  }
});

test('ОВ на пределе L_max: если вытяжки не хватает физически, концентрация = баланс при L_max (а не уставка)', () => {
  // все посты непрерывно 270 А, реальный захват 0,8: нужно 4·L_расч для 0,5 ПДК, а есть 1,5·L_расч → C → G/(L_max+L_МВВ)
  const p = shift4('fffb', { etaReal: 0.8 }); p.record = 10; p.duration = 8 * 3600;
  p.schedule = () => true; p.posts.forEach(ps => (ps.current = () => 270));
  const r = simulate(demoNetwork(), p), last = r.series.at(-1)!;
  assert.ok(Math.abs(last.Lgen - p.gen!.Lmax * 3600) < 1, `ОВ ${last.Lgen.toFixed(0)}`);
  const G = 3 * 0.2 * 1.9 * 1000 * 3.73 / 3600, Cbal = G / (p.gen!.Lmax + last.Qtot / 3600) + 0.001;
  assert.ok(rel(last.C.Mn, Cbal) < 0.03, `C ${last.C.Mn.toFixed(4)} против баланса ${Cbal.toFixed(4)}`);
});

test('Недостижимый режим в динамике: если вентилятора не хватает, частота упирается в максимум, а не «врёт»', () => {
  const p = shiftParams('adaptive'); p.duration = 300; p.record = 1; p.schedule = () => true;
  p.posts.forEach(ps => (ps.Qset = m3h(2600)));
  const r = simulate(demoNetwork(), p); const last = r.series.at(-1)!;
  assert.ok(last.n > 1490); assert.ok(Object.values(last.Q).some(q => q < 2600 * 0.97));
});

test('Все расходы, частоты, концентрации конечны и неотрицательны во всех режимах (смена 8 ч)', () => {
  for (const mode of ['const', 'posts', 'ff', 'fffb'] as const) {
    const p = shift4(mode); p.record = 30; const r = simulate(demoNetwork(), p);
    for (const s of r.series) {
      assert.ok(Number.isFinite(s.n) && s.n >= 0 && s.n <= 1500 + 1e-9, mode);
      assert.ok(Object.values(s.Q).every(q => Number.isFinite(q) && q >= 0), mode);
      assert.ok(s.C.Mn >= 0 && Number.isFinite(s.C.Mn), mode);
      assert.ok(Object.values(s.alpha).every(a => a >= 0 && a <= 90), mode);
    }
  }
});
