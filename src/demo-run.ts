import { solve, setDamper } from './engine/network.ts';
import { balance } from './engine/balance.ts';
import { demoNetwork } from './engine/demo-network.ts';
import { m3h, damperZeta } from './engine/physics.ts';

const r0 = (x: number) => Math.round(x);
const out: string[] = [];
const log = (s = '') => { out.push(s); console.log(s); };

log('## А. Угол заслонки поста 1 → расход (вентилятор 1500 об/мин, остальные заслонки открыты)');
log('| Угол α, ° | Открытие, % | ζ заслонки | Q поста 1, м³/ч | Q поста 2 | Q поста 3 | Q общий |');
log('|---|---|---|---|---|---|---|');
for (const a of [0, 10, 20, 30, 40, 50, 60, 70, 90]) {
  const net = demoNetwork(); setDamper(net, 'post1', a); const s = solve(net);
  log(`| ${a} | ${r0(100 - a / 0.9)} | ${damperZeta(a).toFixed(2)} | ${r0(s.Q.post1 * 3600)} | ${r0(s.Q.post2 * 3600)} | ${r0(s.Q.post3 * 3600)} | ${r0(s.Qtotal * 3600)} |`);
}

log('\n## Б. Взаимное влияние: пост 3 закрыли, вентилятор без регулирования');
{
  const net = demoNetwork(); const a = solve(net); setDamper(net, 'post3', 90); const b = solve(net);
  log('| | Пост 1 | Пост 2 | Пост 3 | Общий | Давление вент., Па | Мощность, кВт |');
  log('|---|---|---|---|---|---|---|');
  for (const [n, s] of [['Все открыты', a], ['Пост 3 закрыт', b]] as const)
    log(`| ${n} | ${r0(s.Q.post1 * 3600)} | ${r0(s.Q.post2 * 3600)} | ${r0(s.Q.post3 * 3600)} | ${r0(s.Qtotal * 3600)} | ${r0(s.pFan)} | ${(s.power / 1000).toFixed(2)} |`);
}

log('\n## В. Регулирование: требуемые 1500 м³/ч на работающий пост, частота — минимально возможная');
log('| Режим | Частота, об/мин | α1 | α2 | α3 | Q1 | Q2 | Q3 | Общий, м³/ч | Мощность, кВт |');
log('|---|---|---|---|---|---|---|---|---|---|');
const fixed = solve(demoNetwork());
log(`| Без регулирования (всё открыто, 1500 об/мин) | 1500 | 0 | 0 | 0 | ${r0(fixed.Q.post1 * 3600)} | ${r0(fixed.Q.post2 * 3600)} | ${r0(fixed.Q.post3 * 3600)} | ${r0(fixed.Qtotal * 3600)} | ${(fixed.power / 1000).toFixed(2)} |`);
const Q = m3h(1500);
for (const [name, req] of [
  ['3 поста работают', { post1: Q, post2: Q, post3: Q }],
  ['2 поста (3-й простаивает)', { post1: Q, post2: Q, post3: 0 }],
  ['1 пост', { post1: Q, post2: 0, post3: 0 }],
] as const) {
  const net = demoNetwork(); const b = balance(net, req as any); const s = b.sol;
  log(`| ${name} | ${r0(b.fanSpeed)} | ${b.angles.post1.toFixed(0)} | ${b.angles.post2.toFixed(0)} | ${b.angles.post3.toFixed(0)} | ${r0(s.Q.post1 * 3600)} | ${r0(s.Q.post2 * 3600)} | ${r0(s.Q.post3 * 3600)} | ${r0(s.Qtotal * 3600)} | ${(s.power / 1000).toFixed(2)} |`);
}
import('node:fs').then(fs => fs.writeFileSync('demo-results.md', out.join('\n')));
