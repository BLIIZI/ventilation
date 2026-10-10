// Аудит 3: все итоговые таблицы блоков 3–4 + зона дыхания + транспортная скорость + чувствительность.
import { simulate } from './engine/sim.ts';
import { shiftParams } from './engine/scenario.ts';
import { shift4 } from './engine/scenario4.ts';
import { demoNetwork } from './engine/demo-network.ts';
import { balance } from './engine/balance.ts';
import { m3h } from './engine/physics.ts';
const f = (x: number, d = 2) => x.toFixed(d), pc = (x: number) => (x * 100).toFixed(1) + ' %';
const NF = { r: 1, s: 0.1 }; const ids3 = ['post1', 'post2', 'post3'];
console.log('## Блок 3: смена (фильтр m = 1, Δt = 19,7, электроэнергия с КПД привода)');
console.log('| Режим | Вент., кВт·ч | Тепло, кВт·ч | Ср. МВВ, м³/ч | <95 % | >110 % | Mn цех ср/макс | Mn дых. ср. (худший пост) | w<10 м/с |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const m of ['constant', 'onoff', 'adaptive'] as const) {
  const p = shiftParams(m); p.nearField = NF; p.wMin = 10; const r = simulate(demoNetwork(), p);
  console.log(`| ${m} | ${f(r.fanKWh)} | ${f(r.heatKWh, 0)} | ${f(r.avgFlow, 0)} | ${pc(r.underFlowShare)} | ${pc(r.overFlowShare)} | ${f(r.avgC.Mn, 3)} / ${f(r.maxC.Mn, 3)} | ${f(Math.max(...Object.values(r.bzTWA)), 3)} | ${pc(r.lowVelShare)} |`);
}
{ const p = shiftParams('adaptive'); p.room.LgenPerPost = m3h(8600 / 3); p.room.LgenMin = m3h(8600 / 3); p.nearField = NF;
  const r = simulate(demoNetwork(), p); console.log(`| adaptive + ОВ по постам | ${f(r.fanKWh)} | ${f(r.heatKWh, 0)} | ${f(r.avgFlow, 0)} | ${pc(r.underFlowShare)} | ${pc(r.overFlowShare)} | ${f(r.avgC.Mn, 3)} / ${f(r.maxC.Mn, 3)} | ${f(Math.max(...Object.values(r.bzTWA)), 3)} | |`); }
console.log('\n## Сегменты ниже 10 м/с (adaptive), доля времени работы вентилятора');
{ const p = shiftParams('adaptive'); p.wMin = 10; const r = simulate(demoNetwork(), p); console.log(r.lowVelBySeg); }
{ const p = shiftParams('onoff'); p.wMin = 10; const r = simulate(demoNetwork(), p); console.log('onoff', r.lowVelBySeg); }
console.log('\n## Блок 4');
console.log('| Режим ОВ | Ср. ОВ, м³/ч | Тепло | Эл. МВВ+ОВ | Mn цех ср/макс | Mn дых. ср. (худший) | Mn дых. 15-мин макс |');
console.log('|---|---|---|---|---|---|');
for (const er of [undefined, 0.8]) for (const g of ['const', 'posts', 'ff', 'fffb'] as const) {
  const p = shift4(g, { etaReal: er }); p.nearField = NF; const r = simulate(demoNetwork(), p);
  console.log(`| ${g}${er ? ' (η=0,8)' : ''} | ${f(r.avgLgen, 0)} | ${f(r.heatKWh, 0)} | ${f(r.fanKWh + r.genKWh)} | ${f(r.avgC.Mn, 3)} / ${f(r.maxC.Mn, 3)} | ${f(Math.max(...Object.values(r.bzTWA)), 3)} | ${f(Math.max(...ids3.map(i => r.bz15max[i])), 3)} |`);
}
console.log('\n## Зона дыхания: чувствительность к скорости воздуха s и захвату η (adaptive, ОВ 8600 пост.)');
for (const s of [0.05, 0.1, 0.2, 0.3]) for (const eta of [0.9, 0.8]) {
  const p = shiftParams('adaptive'); p.nearField = { r: 1, s }; p.posts.forEach(x => (x.etaReal = eta));
  const r = simulate(demoNetwork(), p);
  console.log(`s=${s} η=${eta}: цех ${f(r.avgC.Mn, 3)}, дыхание ср. ${f(Math.max(...Object.values(r.bzTWA)), 3)}, макс мгнов. ${f(Math.max(...Object.values(r.bzMax)), 3)}, макс 15-мин ${f(Math.max(...ids3.map(i => r.bz15max[i])), 3)}`);
}
console.log('\n## Предел загрязнения фильтра (3 × 1500)');
for (const fo of [1, 1.25, 1.5, 1.75, 2, 2.5, 3]) { const n = demoNetwork(); (n.common[0] as any).spec.fouling = fo;
  const b = balance(n, { post1: m3h(1500), post2: m3h(1500), post3: m3h(1500) }); console.log(fo, b.feasible ? `ок, n=${f(b.fanSpeed, 0)}` : b.message); }
console.log('\n## Mn в пересчёте на MnO₂ (если удельный показатель методики — по MnO₂): g_Mn × 0,632');
{ const p = shift4('fffb'); p.substances[0] = { ...p.substances[0], g: 1.9 * 0.632 }; p.gen!.sensor.ratio = 1.9 * 0.632 / 10;
  const r = simulate(demoNetwork(), p); console.log(`fffb: тепло ${f(r.heatKWh, 0)}, ОВ ${f(r.avgLgen, 0)}, Mn ${f(r.avgC.Mn, 3)}/${f(r.maxC.Mn, 3)}`); }
