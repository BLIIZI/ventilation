// Выгрузка расчёта ядра для сверки с Excel: пусконаладочный режим демо-сети (3 поста × 1500 м³/ч)
import { commissioning, genVentByFormula, B_BASE, shiftParams } from '/home/claude/vent-sim/src/engine/scenario.ts';
import { demoNetwork } from '/home/claude/vent-sim/src/engine/demo-network.ts';
import { solve, setDamper, lossBreakdown } from '/home/claude/vent-sim/src/engine/network.ts';
import { damperZeta, damperAngleForZeta, lambdaAltshul, velocity, fanPressure, electricPower } from '/home/claude/vent-sim/src/engine/physics.ts';
import { readFileSync } from 'node:fs';
import { alphaMelt, wireRate, motorEfficiency, sp60Supply } from '/home/claude/vent-sim/src/engine/norms.ts';
import { designLgen } from '/home/claude/vent-sim/src/engine/scenario4.ts';
import { writeFileSync } from 'node:fs';
const c = commissioning();
const net = demoNetwork(); net.fanSpeed = c.n;
for (const [id, a] of Object.entries(c.angles)) setDamper(net, id, a as number);
const sol = solve(net);
const els: any[] = [];
for (const s of net.segments) for (const e of s.elements) els.push({ seg: s.id, parent: s.parent, ...e, Q: sol.Q[s.id], Qp: s.parent ? sol.Q[s.parent] : sol.Q[s.id] });
for (const e of net.common) els.push({ seg: 'common', parent: null, ...e, Q: sol.Qtotal, Qp: sol.Qtotal });
const lb = lossBreakdown(net, sol);
els.forEach((e, i) => (e.dp = lb[i].dp));
const sp = shiftParams('adaptive');
// «стандарт» без регулирования: заслонки на углах наладки при номинальной частоте (запас 10 % по давлению), вентилятор на n_ном
const nstd = demoNetwork(); nstd.fanSpeed = c.nNom;
for (const [id, a] of Object.entries(c.fixedAngles)) setDamper(nstd, id, a as number);
const ssol = solve(nstd);
const std = { nNom: c.nNom, pReq: c.pReq, angles: c.fixedAngles, Q: ssol.Q, Qtotal: ssol.Qtotal, pFan: ssol.pFan, power: ssol.power, powerEl: ssol.powerEl,
  pFanNomAtReq: fanPressure(nstd.fan, sol.Qtotal, c.nNom) };
// пример одного шага ПИ-регулятора заслонки (как в sim.ts, режим adaptive): Q = 1320 при уставке 1500, заслонка на 30°, kI = 4, dt = 1 с
const piZold = damperZeta(30), piLn = Math.min(Math.log(damperZeta(70)), Math.max(Math.log(damperZeta(0)), Math.log(piZold) + 4 * ((1320 - 1500) / 1500) * 1));
const piAngle = damperAngleForZeta(Math.exp(piLn));
// динамика концентрации: то же уравнение и тот же шаг, что в sim.ts (C += dt·(G − L(C − q))/V), чистый цех, 3 поста, L = Ltot3
const Lm3s = sp60Supply(3 * 0.2 * 1.9 * 1000 * B_BASE / 3600, 3 * 1500 / 3600, 0.2, 0.001), Gmgs = 3 * 0.2 * 1.9 * 1000 * B_BASE / 3600;
let Cd = 0.001; const Ct: Record<string, number> = {};
for (let t = 1; t <= 8 * 3600; t++) { Cd += 1 * (Gmgs - Lm3s * (Cd - 0.001)) / sp.room.V; if (t % 1800 === 0) Ct[String(t / 3600)] = Cd; }
const SR = JSON.parse(readFileSync('/home/claude/vent-sim/shift-results.json', 'utf8'));
const shift = Object.fromEntries(Object.entries(SR).map(([k, v]: any) => [k, { fanKWh: v.fanKWh, heatKWh: v.heatKWh, avgFlow: v.avgFlow, avgLgen: v.avgLgen, over: v.overFlowShare, under: v.underFlowShare }]));
writeFileSync('/home/claude/model/v2/engine.json', JSON.stringify({
  angles: c.angles, n: c.n, Q: sol.Q, Qtotal: sol.Qtotal, pFan: sol.pFan, power: sol.power, powerEl: sol.powerEl, fan: net.fan,
  pSet: c.pSet, els, B225: B_BASE, alpha225: alphaMelt(225), B175: wireRate(175), B270: wireRate(270),
  Lgen3: genVentByFormula() * 3600, Lgen270: designLgen() * 3600, Ltot3: sp60Supply(3 * 0.2 * 1.9 * 1000 * B_BASE / 3600, 3 * 1500 / 3600, 0.2, 0.001) * 3600,
  dT: sp.room.dT, V: sp.room.V, piZold, piZnew: Math.exp(piLn), piAngle, Ct, shift, damperStroke: sp.damperStroke, kI: sp.kI,
  std,
  etaMotor: motorEfficiency(sol.power / 2200, 0.867), damperZ: Object.fromEntries(Object.entries(c.angles).map(([k, a]) => [k, damperZeta(a as number)])),
}, null, 1));
console.log('n', c.n, 'pFan', sol.pFan, 'Qt', sol.Qtotal * 3600, 'P', sol.power, 'Pel', sol.powerEl, c.angles);
