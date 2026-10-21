// Универсальная модель: библиотека процессов, смесь веществ, группы суммации, сборка цеха.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROCESSES, emissionOf, qminOf, qsetOf, processById } from '../src/engine/processes.ts';
import { SUBSTANCES, mnCategory } from '../src/engine/substances.ts';
import { buildPlant, designReport, MIXED_EXAMPLE } from '../src/engine/plant.ts';
import { genVentByFormula } from '../src/engine/scenario.ts';
import { simulate } from '../src/engine/sim.ts';
import { wireRate } from '../src/engine/norms.ts';

const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-12);

test('Библиотека: у сверенных материалов сварки аэрозоль = сумма твёрдых компонентов (проверка переписанных чисел Методики)', () => {
  const solid = ['fe', 'mn', 'sio2', 'fluor', 'cr6'];
  for (const pr of PROCESSES.filter(p => p.group === 'Сварка' && !p.custom)) for (const m of pr.materials) {
    if (m.status !== 'сверено' || m.factors.aerosol === undefined) continue;
    const sum = solid.reduce((a, k) => a + (m.factors[k] ?? 0), 0);
    assert.ok(Math.abs(sum - m.factors.aerosol) < 0.011, `${pr.name} / ${m.name}: сумма ${sum.toFixed(2)} ≠ ${m.factors.aerosol}`);
  }
});

test('Библиотека: каждое вещество процесса есть в справочнике веществ; у каждого процесса указан источник и норма отсоса', () => {
  for (const pr of PROCESSES) {
    assert.ok(pr.source.length > 20 && pr.hoods.length > 0, pr.name);
    for (const m of pr.materials) for (const k of Object.keys(m.factors)) assert.ok(SUBSTANCES[k], `${pr.name}: нет вещества ${k}`);
    const e = emissionOf({ id: 'x', process: pr.id, material: pr.materials[0].id });
    for (const k of Object.keys(e)) { assert.ok(SUBSTANCES[k], `${pr.name}: ${k}`); assert.ok(Number.isFinite(e[k]) && e[k] >= 0); }
  }
});

test('Единицы: CO₂ 225 А → Mn = 1,90 г/кг · 2,1997 кг/ч = 1,1610 мг/с; МР-3 1,5 кг/ч → HF = 0,40·1,5/3,6 = 0,1667 мг/с', () => {
  const a = emissionOf({ id: 'p', process: 'mag_co2', material: 'sv08g2s', params: { I: 225 } });
  assert.ok(Math.abs(a.mn - 1.90 * wireRate(225) / 3.6) < 1e-9 && Math.abs(a.mn - 1.1610) < 1e-4);
  const b = emissionOf({ id: 'p', process: 'mma', material: 'mr3', params: { B: 1.5 } });
  assert.ok(Math.abs(b.hf - 0.40 * 1.5 / 3.6) < 1e-12);
});

test('Газовая резка: в узлах таблицы (5, 10, 20 мм) — точные значения, между ними — линейно; г/ч → мг/с', () => {
  const at = (t: number) => emissionOf({ id: 'p', process: 'gas_cut', material: 'carbon', params: { thick: t } });
  assert.ok(Math.abs(at(10).aerosol - 131.0 / 3.6) < 1e-9 && Math.abs(at(10).no2 - 64.1 / 3.6) < 1e-9);
  assert.ok(Math.abs(at(5).co - 49.5 / 3.6) < 1e-9 && Math.abs(at(20).fe - 197.0 / 3.6) < 1e-9);
  assert.ok(Math.abs(at(15).aerosol - (131 + 200) / 2 / 3.6) < 1e-9);
});

test('Нормы отсоса: стол 1500 (ГОСТ 12.3.003 п. 2.11.1); раскрой 2500·S (газ) / 4000·S (плазма); пайка 0,6 м/с·F; уставка ≥ нормы', () => {
  assert.equal(qminOf({ id: 'p', process: 'mma', material: 'mr3' }).q, 1500);
  assert.equal(qminOf({ id: 'p', process: 'gas_cut', material: 'carbon', params: { area: 2 } }).q, 5000);
  assert.ok(Math.abs(qminOf({ id: 'p', process: 'solder', material: 'pos61', params: { open: 0.05 } }).q - 108) < 1e-9);
  assert.equal(qsetOf({ id: 'p', process: 'mma', material: 'mr3', Qset: 900 }), 1500);   // меньше нормы задать нельзя
  assert.equal(qsetOf({ id: 'p', process: 'mma', material: 'mr3', Qset: 2000 }), 2000);
});

test('Категория ПДК Mn по доле в аэрозоле: 19 % → 0,2; 25 % → 0,1; 33 % → 0,05 (вопрос к руководителю); смесь в цехе — по общей доле', () => {
  assert.equal(mnCategory(0.19).pdkSs, 0.2); assert.equal(mnCategory(0.25).pdkSs, 0.1); assert.equal(mnCategory(0.33).pdkSs, 0.05);
  const alone = designReport([{ id: 'p', process: 'saw', material: 'fc12' }]);
  assert.equal(alone.subs.find(s => s.name === 'mn')!.pdk, 0.05);
  const mix = designReport(MIXED_EXAMPLE);
  assert.ok(mix.mnShare < 0.2 && mix.subs.find(s => s.name === 'mn')!.pdk === 0.2, `доля ${mix.mnShare}`);
});

test('Один пост CO₂ 225 А: расчётная ОВ универсальной модели = формуле блока 1 (СП 60)', () => {
  const d = designReport([{ id: 'p', process: 'mag_co2', material: 'sv08g2s', params: { I: 225 } }]);
  assert.equal(d.limiting, 'mn');
  assert.ok(rel(d.Ld, genVentByFormula(1)) < 1e-9, `${d.Ld * 3600} против ${genVentByFormula(1) * 3600}`);
});

test('Группа суммации: HF + фториды — одна группа, потребный расход = сумма расходов по каждому', () => {
  const d = designReport([{ id: 'p', process: 'mma', material: 'uoni1345' }]);
  const hf = d.subs.find(s => s.name === 'hf')!, fl = d.subs.find(s => s.name === 'fluor')!;
  assert.equal(hf.group, 'F'); assert.equal(fl.group, 'F');
  const sep = d.esc.hf / hf.pdk + d.esc.fluor / fl.pdk;   // q_пр = 0
  assert.ok(rel(d.need.hf, sep) < 1e-12 && d.need.hf === d.need.fluor);
});

test('Сборка смешанного цеха: вентилятор подобран (режим «все посты» достижим), уставки ≥ норм, решатель сходится всю смену', () => {
  const { net, params, report } = buildPlant({ posts: MIXED_EXAMPLE, gen: 'fffb' });
  assert.ok(report.fanFeasible && report.commissioning.n < 1450);
  for (const p of report.posts) assert.ok(p.qset >= p.qmin);
  const r = simulate(net, params);
  assert.equal(r.nonConverged, 0);
  for (const s of r.series) assert.ok(Object.values(s.C).every(c => Number.isFinite(c) && c >= 0));
});

test('ОВ по потребности (все вещества): держит Σ C/ПДК у цели 0,8 и адаптируется к реальному захвату (0,7 → больше воздуха, 0,9 → меньше)', () => {
  const run = (er: number) => { const { net, params } = buildPlant({ posts: MIXED_EXAMPLE, gen: 'fffb', gasSensors: ['no2', 'co'] }); params.posts.forEach(p => (p.etaReal = er)); return simulate(net, params); };
  const a = run(0.7), b = run(0.8), c = run(0.9);
  assert.ok(a.avgLgen > b.avgLgen && b.avgLgen > c.avgLgen, `${a.avgLgen.toFixed(0)} > ${b.avgLgen.toFixed(0)} > ${c.avgLgen.toFixed(0)}`);
  assert.ok(b.ratioMax < 0.9 && a.ratioMax < 1, `max ${b.ratioMax.toFixed(3)} / ${a.ratioMax.toFixed(3)}`);   // цель 0,8; при ошибке захвата (η 0,7 вместо 0,8) — всё равно не выше ПДК
  const pst = (() => { const { net, params } = buildPlant({ posts: MIXED_EXAMPLE, gen: 'posts' }); params.posts.forEach(p => (p.etaReal = 0.7)); return simulate(net, params); })();
  assert.ok(pst.ratioMax > a.ratioMax, 'по числу постов при ошибке захвата превышает цель сильнее');
});

test('Только газы (газовая сварка): ОВ работает без аэрозоля, концентрация NO₂ ниже ПДК', () => {
  const { net, params } = buildPlant({ posts: [{ id: 'p1', process: 'gas_weld', material: 'acetylene' }, { id: 'p2', process: 'gas_weld', material: 'acetylene' }], gen: 'fffb' });
  const r = simulate(net, params);
  assert.equal(r.nonConverged, 0); assert.ok(r.ratioMax < 1 && r.ratioMax > 0, `${r.ratioMax}`);
});

test('Процесс с показателями «ввести» (пайка) с нулевыми значениями не ломает расчёт; после ввода показателя появляется вещество', () => {
  const z = designReport([{ id: 'p', process: 'solder', material: 'pos61' }]);
  assert.ok(z.Ld === 0);
  const d = designReport([{ id: 'p', process: 'solder', material: 'pos61', factorsOverride: { pb: 0.5, sn: 1 } }]);
  assert.ok(d.Ld > 0 && d.limiting === 'pb');
  assert.ok(processById('solder').materials[0].status === 'ввести');
});

test('Отсос «задаётся проектировщиком»: расход по паспорту (по умолчанию 1000 м³/ч, не 0); при выборе нормы — по норме', () => {
  assert.equal(qsetOf({ id: 'p', process: 'contact', material: 'butt' }), 1000);
  assert.equal(qsetOf({ id: 'p', process: 'grind', material: 'sharp100', params: { Q: 600 } }), 600);
  for (const pr of PROCESSES) assert.ok(qsetOf({ id: 'p', process: pr.id, material: pr.materials[0].id }) > 0, pr.name);
});

test('Сейчас в интерфейсе — только сварка; остальные процессы в библиотеке сохранены, но скрыты', async () => {
  const { activeProcesses, ENABLED_GROUPS } = await import('../src/engine/processes.ts');
  assert.deepEqual(ENABLED_GROUPS, ['Сварка']);
  assert.ok(activeProcesses().every(p => p.group === 'Сварка'));
  assert.deepEqual(activeProcesses().map(p => p.id).sort(), ['mag_co2', 'saw']);   // решение 21.10.2026: только CO₂ и под флюсом
  assert.ok(PROCESSES.length > activeProcesses().length);
  assert.ok(MIXED_EXAMPLE.every(p => processById(p.process).group === 'Сварка'));
});

test('СП 60: L = L_wz + (m − L_wz(q_wz − q_in))/(q_l − q_in); при q_l = q_wz общеобменная = m/(q − q_in) − L_wz; если отсосов хватает — 0', async () => {
  const { sp60Supply, sp60General } = await import('../src/engine/norms.ts');
  // пример: m = 1000 мг/ч, ПДК 0,2, q_in 0,001, отсосы 3000 м³/ч → весь воздух 1000/0,199 = 5025 м³/ч, ОВ = 2025 м³/ч
  assert.ok(Math.abs(sp60Supply(1000, 3000, 0.2, 0.001) - 1000 / 0.199) < 1e-9);
  assert.ok(Math.abs(sp60General(1000, 3000, 0.2, 0.001) - (1000 / 0.199 - 3000)) < 1e-9);
  assert.equal(sp60General(100, 3000, 0.2, 0.001), 0);
  // q_l > q_wz (вещество поднимается вверх и удаляется из верхней зоны с большей концентрацией) — воздуха нужно меньше
  assert.ok(sp60Supply(1000, 3000, 0.2, 0.001, 0.3) < sp60Supply(1000, 3000, 0.2, 0.001));
  // общий вид совпадает с прямым балансом массы: m = (L − L_wz)(q_l − q_in) + L_wz(q_wz − q_in)
  const L = sp60Supply(1000, 3000, 0.2, 0.001, 0.3);
  assert.ok(Math.abs((L - 3000) * (0.3 - 0.001) + 3000 * (0.2 - 0.001) - 1000) < 1e-9);
});

test('Сборка цеха: расчётная ОВ = (весь потребный воздух) − (местные отсосы), как в СП 60', () => {
  const d = designReport(MIXED_EXAMPLE);
  assert.ok(Math.abs(d.Ld - Math.max(0, d.Ltotal - d.Llev)) < 1e-12);
  assert.ok(Math.abs(d.Llev * 3600 - (1500 + 1500 + 1500 + 1000)) < 1e-6);
});

test('Схема диплома: переносной агрегат с возвратом воздуха (электрофильтр) — L_wz = 0, вся вентиляция общеобменная; проскок фильтра добавляется; газы возвращаются полностью', () => {
  const base = { id: 'post1', process: 'mag_co2', material: 'sv08g2s', params: { I: 225, d: 1.2 }, hood: 'table', eta: 0.8 };
  const central = designReport([base]), rec1 = designReport([{ ...base, recircEta: 1 }]), rec95 = designReport([{ ...base, recircEta: 0.95 }]);
  // центральная вытяжка с выбросом наружу: L_оо = L − 1500; агрегат с идеальным фильтром: весь тот же воздух — общеобменный
  assert.ok(Math.abs(central.Ltotal - rec1.Ltotal) < 1e-9 && rec1.Llev === 0 && Math.abs(rec1.Ld - rec1.Ltotal) < 1e-12);
  assert.ok(Math.abs(central.Ld - (central.Ltotal - 1500 / 3600)) < 1e-9);
  // проскок 5 %: m = (1 − 0,8 + 0,8·0,05)·G = 0,24·G → в 1,2 раза больше воздуха
  assert.ok(Math.abs(rec95.Ltotal / rec1.Ltotal - 1.2) < 1e-9);
  // газ (электроды УОНИ: HF, CO, NO₂) через электрофильтр проходит: m_газ = G целиком при любом η
  const u = { id: 'post1', process: 'mma', material: 'uoni1345', hood: 'table', eta: 0.8 };
  const uc = designReport([u]), ur = designReport([{ ...u, recircEta: 1 }]);
  assert.ok(Math.abs(ur.esc.co / uc.esc.co - 1 / 0.2) < 1e-9 && Math.abs(ur.esc.mn - uc.esc.mn) < 1e-12);
});
