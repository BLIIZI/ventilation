import { simulate } from './engine/sim.ts';
import { shiftParams } from './engine/scenario.ts';
import { demoNetwork } from './engine/demo-network.ts';
import { balance } from './engine/balance.ts';
import { m3h } from './engine/physics.ts';
import { writeFileSync } from 'node:fs';

// уставка разрежения для режима «открыто/закрыто»: давление в коллекторе при расчётном режиме (3 поста по 1500)
const b = balance(demoNetwork(), { post1: m3h(1500), post2: m3h(1500), post3: m3h(1500) });
const pSet = b.sol.pFan - b.sol.segLoss['common'];
console.log('Уставка разрежения в коллекторе, Па:', pSet.toFixed(0));

const names = { constant: 'Без регулирования', onoff: 'Открыто/закрыто + ЧП (пром. стандарт)', adaptive: 'Предлагаемая система' } as const;
const res: any = {};
for (const mode of ['constant', 'onoff', 'adaptive'] as const) {
  const t0 = Date.now(); res[mode] = simulate(demoNetwork(), shiftParams(mode, pSet));
  const r = res[mode];
  console.log(`${names[mode]}: вент ${r.fanKWh.toFixed(2)} кВт·ч, тепло ${r.heatKWh.toFixed(0)} кВт·ч, ср.расход МВВ ${r.avgFlow.toFixed(0)} м³/ч, <95% ${(r.underFlowShare*100).toFixed(1)}%, >110% ${(r.overFlowShare*100).toFixed(1)}%, Mn max ${r.maxC.Mn.toFixed(3)} ср ${r.avgC.Mn.toFixed(3)} (${Date.now()-t0} мс)`);
}
{
  const p = shiftParams('adaptive', pSet); p.room.LgenPerPost = m3h(8600 / 3); p.room.LgenMin = m3h(8600 / 3);
  const r = simulate(demoNetwork(), p); res['adaptive_gen'] = r;
  console.log(`Предлагаемая + общеобменная по потребности: вент ${r.fanKWh.toFixed(2)} кВт·ч, тепло ${r.heatKWh.toFixed(0)} кВт·ч, ср.расход МВВ ${r.avgFlow.toFixed(0)} м³/ч, <95% ${(r.underFlowShare*100).toFixed(1)}%, >110% ${(r.overFlowShare*100).toFixed(1)}%, Mn max ${r.maxC.Mn.toFixed(3)} ср ${r.avgC.Mn.toFixed(3)}`);
}
console.log('--- для сравнения: без пусконаладочной балансировки (как в первой версии) ---');
for (const mode of ['constant', 'onoff'] as const) {
  const r = simulate(demoNetwork(), shiftParams(mode, pSet, false));
  console.log(`${names[mode]} (без балансировки): вент ${r.fanKWh.toFixed(2)}, тепло ${r.heatKWh.toFixed(0)}, >110% ${(r.overFlowShare*100).toFixed(1)}%`);
}
writeFileSync('shift-results.json', JSON.stringify(Object.fromEntries(Object.entries(res).map(([k, v]: any) => [k, { ...v, series: v.series }]))));
