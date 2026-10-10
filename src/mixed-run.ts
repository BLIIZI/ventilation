// Смешанный цех: 4 разных процесса. Расчёт по всем веществам.
import { buildPlant, MIXED_EXAMPLE } from './engine/plant.ts';
import { simulate } from './engine/sim.ts';
const f = (x: number, d = 2) => x.toFixed(d);
const { report } = buildPlant({ posts: MIXED_EXAMPLE, gen: 'const' });
console.log('## Посты'); for (const p of report.posts) console.log(`${p.id}: ${p.process} / ${p.material}; отсос «${p.hood}» ${f(p.qset, 0)} м³/ч (норма ${f(p.qmin, 0)}: ${p.qminSource}); выделение мг/с:`, Object.fromEntries(Object.entries(p.emission).map(([k, v]) => [k, +v.toFixed(4)])));
console.log('\n## Вещества: потребный воздухообмен ОВ (все посты, C = ПДК), м³/ч');
for (const s of report.substances) console.log(`${s.name} — ПДК ${s.pdk}, кл. ${s.cls}, ${s.status}${s.group ? ', группа ' + s.group : ''}: ${f(s.Lneed, 0)}`);
console.log(`Лимитирующее: ${report.limiting}; доля Mn в аэрозоле цеха ${(report.mnShare! * 100).toFixed(1)} % → категория ${report.mnCategory} (по постам: ${report.postMnCategory!.join(" / ")}); L_расч = ${f(report.Ldesign, 0)} м³/ч; запас вентилятора ×${f(report.fanScale)}, достижимо: ${report.fanFeasible}; n наладки ${f(report.commissioning.n, 0)}`);
console.log('\n## Смена 8 ч');
console.log('| МВВ | ОВ | Вент. эл., кВт·ч | ОВ эл. | Тепло, кВт·ч | Ср. ОВ, м³/ч | <95 % | max Σ C/ПДК | Σ C/ПДК ср. по группам |');
for (const [lev, gen] of [['constant', 'const'], ['onoff', 'const'], ['adaptive', 'const'], ['adaptive', 'posts'], ['adaptive', 'ff'], ['adaptive', 'fffb']] as const) {
  const { net, params } = buildPlant({ posts: MIXED_EXAMPLE, lev, gen });
  const r = simulate(net, params);
  console.log(`| ${lev} | ${gen} | ${f(r.fanKWh)} | ${f(r.genKWh)} | ${f(r.heatKWh, 0)} | ${f(r.avgLgen, 0)} | ${(r.underFlowShare * 100).toFixed(1)} % | ${f(r.ratioMax, 3)} | ${Object.entries(r.groupRatioAvg).map(([k, v]) => k + ' ' + v.toFixed(3)).join(', ')} | nonconv ${r.nonConverged}`);
}
