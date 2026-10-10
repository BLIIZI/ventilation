import { simulate } from './engine/sim.ts';
import { shift4 } from './engine/scenario4.ts';
import { demoNetwork } from './engine/demo-network.ts';
console.log('| τ упрежд., с | kI | Ср. ОВ, м³/ч | Тепло, кВт·ч | Mn ср | Mn макс | Размах изменений ОВ (ср. |ΔL| за 10 с), м³/ч | Ошибка модели: Mn ср |');
console.log('|---|---|---|---|---|---|---|---|');
for (const tau of [0, 300, 600, 1200]) for (const kI of [0.002, 0.005]) {
  const mk = (o: any) => { const p = shift4('fffb', o); p.gen!.ffTau = tau || undefined; p.gen!.kI = kI; return simulate(demoNetwork(), p); };
  const r = mk({}), e = mk({ etaReal: 0.8 });
  const s = r.series; let dv = 0; for (let i = 1; i < s.length; i++) dv += Math.abs(s[i].Lgen - s[i - 1].Lgen); dv /= s.length - 1;
  console.log(`| ${tau} | ${kI} | ${r.avgLgen.toFixed(0)} | ${r.heatKWh.toFixed(0)} | ${r.avgC.Mn.toFixed(3)} | ${r.maxC.Mn.toFixed(3)} | ${dv.toFixed(0)} | ${e.avgC.Mn.toFixed(3)} |`);
}
