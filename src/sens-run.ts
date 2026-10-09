import { simulate } from './engine/sim.ts';
import { shiftParams } from './engine/scenario.ts';
import { demoNetwork } from './engine/demo-network.ts';
const pSet = 351;
console.log('| Привод, с | kI | Вент, кВт·ч | Тепло, кВт·ч | Расход <95 %, доля времени | >110 % | Mn ср, мг/м³ |');
console.log('|---|---|---|---|---|---|---|');
for (const stroke of [8, 15, 30]) for (const kI of [1.5, 4]) {
  const p = shiftParams('adaptive', pSet); p.damperStroke = stroke; p.kI = kI; p.record = undefined;
  const r = simulate(demoNetwork(), p);
  console.log(`| ${stroke} | ${kI} | ${r.fanKWh.toFixed(2)} | ${r.heatKWh.toFixed(0)} | ${(r.underFlowShare*100).toFixed(1)} % | ${(r.overFlowShare*100).toFixed(1)} % | ${r.avgC.Mn.toFixed(3)} |`);
}
