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

test('ОВ по потребности (все вещества): держит Σ C/ПДК у цели 0,5 и адаптируется к реальному захвату (0,7 → больше воздуха, 0,9 → меньше)', () => {
  const run = (er: number) => { const { net, params } = buildPlant({ posts: MIXED_EXAMPLE, gen: 'fffb', gasSensors: ['no2', 'co'] }); params.posts.forEach(p => (p.etaReal = er)); return simulate(net, params); };
  const a = run(0.7), b = run(0.8), c = run(0.9);
  assert.ok(a.avgLgen > b.avgLgen && b.avgLgen > c.avgLgen, `${a.avgLgen.toFixed(0)} > ${b.avgLgen.toFixed(0)} > ${c.avgLgen.toFixed(0)}`);
  assert.ok(b.ratioMax < 0.6 && a.ratioMax < 0.65, `max ${b.ratioMax.toFixed(3)} / ${a.ratioMax.toFixed(3)}`);
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
