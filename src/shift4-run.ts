import { simulate } from './engine/sim.ts';
import { shift4, designLgen } from './engine/scenario4.ts';
import { demoNetwork } from './engine/demo-network.ts';
import { writeFileSync } from 'node:fs';
console.log('Расчётный расход ОВ (3 поста × 270 А, C = ПДК):', (designLgen() * 3600).toFixed(0), 'м³/ч');
const names: any = { const: 'Постоянный (проектный)', posts: 'По числу работающих постов', ff: 'Упреждение по току', fffb: 'Упреждение по току + датчик' };
const rows: string[] = []; const out: any = {};
const run = (label: string, mode: any, o: any = {}) => {
  const r = simulate(demoNetwork(), shift4(mode, o)); out[label] = r;
  rows.push(`| ${label} | ${r.avgLgen.toFixed(0)} | ${r.heatKWh.toFixed(0)} | ${(r.fanKWh + r.genKWh).toFixed(2)} | ${r.avgC.Mn.toFixed(3)} | ${r.maxC.Mn.toFixed(3)} | ${(r.overPdkShare * 100).toFixed(1)} % |`);
};
for (const m of ['const', 'posts', 'ff', 'fffb']) run(names[m], m);
rows.push('| **Проверка на ошибку модели: реальный захват 70 % вместо принятых 80 %** | | | | | | |');
for (const m of ['const', 'ff', 'fffb']) run(names[m] + ' (ошибка модели)', m, { etaReal: 0.7 });
rows.push('| **Целевая концентрация 0,7 ПДК вместо 0,5** | | | | | | |');
run(names.fffb + ', C_уст = 0,14', 'fffb', { Cset: 0.14 });
console.log('| Режим ОВ | Ср. расход ОВ, м³/ч | Тепло, кВт·ч | Электроэнергия МВВ+ОВ, кВт·ч | Mn ср., мг/м³ | Mn макс., мг/м³ | Время Mn > ПДК |');
console.log('|---|---|---|---|---|---|---|'); rows.forEach(r => console.log(r));
writeFileSync('shift4-results.json', JSON.stringify(Object.fromEntries(Object.entries(out).map(([k, v]: any) => [k, { ...v, series: v.series.filter((_: any, i: number) => i % 3 === 0) }]))));
