// Расчётное ядро vent-sim (собрано из src/engine/*.ts). Не редактировать вручную.
(function(){
"use strict";

// ---- physics.ts
// Физические зависимости. Внутри — СИ: м, м³/с, Па, кг/м³.
// Каждая функция помечена источником и статусом: [Н] норматив, [М] инженерная модель, [Д] допущение, [П] требует проверки.

const AIR = { rho: 1.2, nu: 15.06e-6 }; // [М] воздух при +20 °C (плотность и кинематическая вязкость)

const m3h = (q        ) => q / 3600;      // м³/ч -> м³/с
const toM3h = (q        ) => q * 3600;    // м³/с -> м³/ч
const area = (d        ) => Math.PI * d * d / 4;

/** Скорость, м/с */
const velocity = (Q        , d        ) => Q / area(d);

/** Динамическое давление pд = ρw²/2, Па [М] */
const dynPressure = (w        , rho = AIR.rho) => rho * w * w / 2;

/** Коэффициент трения по формуле А.Д. Альтшуля λ = 0,11·(kэ/d + 68/Re)^0,25 [М]
 *  Альтшуль А.Д. Гидравлические сопротивления. — М.: Недра, 1982.
 *  Проверено: воспроизводит λ·l/d из таблицы 4.1 диплома (kэ = 0,1 мм). */
function lambdaAltshul(w        , d        , ke = 0.1e-3, nu = AIR.nu)         {
  const Re = Math.max(Math.abs(w) * d / nu, 1);
  if (Re < 2300) return 64 / Re; // ламинарный режим (Пуазейль) — на практике в вентиляции не встречается
  return 0.11 * Math.pow(ke / d + 68 / Re, 0.25);
}

/** Потери давления на участке воздуховода Δp = (λ·l/d + Σζ)·pд, Па [М]
 *  Формула Дарси–Вейсбаха + местные сопротивления (Идельчик И.Е., 1992; Посохин В.Н., 2008). */
function ductLoss(Q        , d        , l        , sumZeta        , ke = 0.1e-3)         {
  const w = velocity(Math.abs(Q), d);
  const lam = lambdaAltshul(w, d, ke);
  return (lam * l / d + sumZeta) * dynPressure(w) * Math.sign(Q);
}

// ---------- Заслонка
/** Характеристика дроссель-клапана в круглом воздуховоде: угол α (0° — открыта, 90° — закрыта) → ζ.
 *  [П] Значения по справочнику Идельчика (дроссель-клапан, круглая труба) — ТРЕБУЮТ СВЕРКИ по первоисточнику.
 *  Участок 70–90° — [Д]: закрытая заслонка моделируется утечкой (ζ = 1e4 при 90°). */
const BUTTERFLY_ROUND                          = [
  [0, 0.2], [5, 0.24], [10, 0.52], [15, 0.9], [20, 1.54], [25, 2.51], [30, 3.91], [35, 6.22],
  [40, 10.8], [45, 18.7], [50, 32.6], [55, 58.8], [60, 118], [65, 256], [70, 751], [90, 1e4],
];

/** ζ(α) — интерполяция ln ζ по углу (ζ растёт почти экспоненциально) [М] */
function damperZeta(alphaDeg        , table = BUTTERFLY_ROUND)         {
  const a = Math.min(Math.max(alphaDeg, table[0][0]), table[table.length - 1][0]);
  for (let i = 1; i < table.length; i++) {
    const [a0, z0] = table[i - 1], [a1, z1] = table[i];
    if (a <= a1) {
      const t = (a - a0) / (a1 - a0);
      return Math.exp(Math.log(z0) + t * (Math.log(z1) - Math.log(z0)));
    }
  }
  return table[table.length - 1][1];
}

/** Обратная функция: какой угол даёт заданное ζ (для линеаризации регулятора) */
function damperAngleForZeta(zeta        , table = BUTTERFLY_ROUND)         {
  let lo = table[0][0], hi = table[table.length - 1][0];
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (damperZeta(m, table) < zeta) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

// ---------- Вентилятор
/** Характеристика вентилятора по точкам каталога (Q м³/ч, p Па) при n0 об/мин.
 *  Пересчёт на другую частоту — законы подобия: Q~n, p~n², N~n³ [М]
 *  (U.S. DOE. Improving Fan System Performance: A Sourcebook for Industry, 2003). */
                           
                                                                                                
                                                                                                                                    
 

/** КПД частотного преобразователя от нагрузки (доля номинальной мощности ЧП).
 *  US DOE, Motor Systems Tip Sheet #11 «Adjustable Speed Drive Part-Load Efficiency», табл. 1, строка 5 hp (типовой ШИМ-ЧП). [Н/справ.] */
const VFD_EFF                          = [[0.016, 0.35], [0.125, 0.80], [0.25, 0.88], [0.42, 0.91], [0.5, 0.92], [0.75, 0.94], [1.0, 0.95]];
/** Относительный КПД асинхронного двигателя при частичной нагрузке (к номинальному). [Д][П]
 *  50–100 %: по каталогам IE3 КПД практически постоянен; ниже 50 % падает (DOE, «Determining Electric Motor Load and Efficiency»).
 *  Точки ниже 50 % — оценка, уточнить по каталогу конкретного двигателя. */
const MOTOR_REL                          = [[0.05, 0.55], [0.1, 0.75], [0.25, 0.93], [0.5, 1.0], [1.0, 1.0]];
function tab(t                         , x        ) {
  if (x <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) if (x <= t[i][0]) { const [x0, y0] = t[i - 1], [x1, y1] = t[i]; return y0 + (x - x0) * (y1 - y0) / (x1 - x0); }
  return t[t.length - 1][1];
}
/** Электрическая мощность из сети: P_эл = P_вал / (η_дв(β)·η_ЧП(β)), β = P_вал / P_ном */
function electricPower(fan          , shaftW        )         {
  if (shaftW <= 0) return 0;
  if (!fan.motorW || !fan.motorEta) return shaftW;
  const beta = shaftW / fan.motorW;
  return shaftW / (fan.motorEta * tab(MOTOR_REL, beta) * tab(VFD_EFF, beta));
}

function fanPressure(fan          , Q        , n        )         {
  const k = n / fan.n0;
  if (k <= 0) return 0;
  const Q0 = toM3h(Q) / k; // приводим к номинальной частоте
  const p = fan.points;
  let p0        ;
  if (Q0 <= p[0][0]) p0 = p[0][1];
  else if (Q0 >= p[p.length - 1][0]) {
    const [qa, pa] = p[p.length - 2], [qb, pb] = p[p.length - 1];
    p0 = pb + (Q0 - qb) * (pb - pa) / (qb - qa); // экстраполяция за последнюю точку
  } else {
    let i = 1; while (Q0 > p[i][0]) i++;
    const [qa, pa] = p[i - 1], [qb, pb] = p[i];
    p0 = pa + (Q0 - qa) * (pb - pa) / (qb - qa);
  }
  return p0 * k * k;
}

/** Потребляемая мощность N = Q·p/η, Вт [М]; η — постоянная [Д] (уточнить по каталогу) */
const fanPower = (fan          , Q        , p        ) => Math.max(0, Q * p) / fan.eta; // < 0 физически невозможно для вентилятора: за пределами характеристики мощность 0 [М]

// ---------- Фильтр
/** Сопротивление фильтра Δp = Δp_ном·(Q/Q_ном)^m·k_загр [М/Д]
 *  m = 1…2 (1 — ламинарная фильтрация через слой, 2 — квадратичный закон); k_загр ≥ 1 — коэффициент загрязнения. */
                                                                                        
const filterLoss = (f            , Q        ) =>
  f.dpNom * Math.pow(Math.abs(Q) / f.qNom, f.m) * f.fouling * Math.sign(Q);


// ---- network.ts
// Модель разветвлённой вытяжной сети с одним вентилятором.
// Метод: для каждого местного отсоса записывается баланс давления по пути
// «вход отсоса → ... → вентилятор → выброс»: Σ Δp(участков пути) = p_вент(Q_общ).
// Неизвестные — расходы отсосов Q_1..Q_N; решается методом Ньютона (якобиан численный).
// Расход на любом участке = сумма расходов отсосов, проходящих через него (закон сохранения массы).

// Дерево: листья — ветви отсосов, корень (parent = null) — участок перед вентилятором.

                          
                      
                                                                            
                                                                                     
                
                                         
 

                           
                                                                      
                 
                                                           
                                                       
                                                                                                                  
                                  
                     
                     
 

const elemLoss = (e         , Q        ) => {
  switch (e.kind) {
    case 'duct': return ductLoss(Q, e.d, e.l, e.zeta);
    case 'damper': return ductLoss(Q, e.d, 0, damperZeta(e.alpha, e.table));
    case 'filter': return filterLoss(e.spec, Q);
  }
};
const segLossFn = (s                         , Q        ) => s.elements.reduce((a, e) => a + elemLoss(e, Q), 0);

function solve(net         , guess           )           {
  const byId = new Map(net.segments.map(s => [s.id, s]));
  // путь от каждого отсоса до корня
  const paths = net.hoods.map(h => { const p            = []; let s = byId.get(h); while (s) { p.push(s); s = s.parent ? byId.get(s.parent) : undefined; } return p; });
  // какие отсосы проходят через сегмент
  const users = new Map                  ();
  paths.forEach((p, i) => p.forEach(s => { if (!users.has(s.id)) users.set(s.id, []); users.get(s.id) .push(i); }));

  const N = net.hoods.length;
  const segFlows = (q          ) => { const m                         = {}; for (const [id, u] of users) m[id] = u.reduce((a, i) => a + q[i], 0); return m; };
  const residual = (q          ) => {
    const f = segFlows(q); const Qt = q.reduce((a, b) => a + b, 0);
    const pF = fanPressure(net.fan, Qt, net.fanSpeed) - segLossFn({ elements: net.common }, Qt);
    return paths.map(p => p.reduce((a, s) => a + segLossFn(s, f[s.id]), 0) - pF);
  };

  let q = guess && guess.length === N ? [...guess] : Array(N).fill(m3h(500));
  let it = 0, ok = false;
  for (; it < 100; it++) {
    const r = residual(q);
    if (Math.max(...r.map(Math.abs)) < 1e-3) { ok = true; break; }
    // численный якобиан
    const J = Array.from({ length: N }, () => Array(N).fill(0));
    for (let j = 0; j < N; j++) {
      const h = Math.max(1e-6, Math.abs(q[j]) * 1e-5);
      const qp = [...q]; qp[j] += h; const rp = residual(qp);
      for (let i = 0; i < N; i++) J[i][j] = (rp[i] - r[i]) / h;
    }
    const dx = gauss(J, r.map(v => -v));
    // демпфирование шага: расходы не уходят в отрицательную область
    let t = 1; while (t > 1e-4 && q.some((v, i) => v + t * dx[i] <= 0)) t /= 2;
    q = q.map((v, i) => Math.max(v + t * dx[i], 1e-9));
  }
  const f = segFlows(q); const Qt = q.reduce((a, b) => a + b, 0);
  const pFan = fanPressure(net.fan, Qt, net.fanSpeed);
  const segLoss                         = {};
  for (const s of net.segments) segLoss[s.id] = segLossFn(s, f[s.id] ?? 0);
  segLoss['common'] = segLossFn({ elements: net.common }, Qt);
  const Q                         = { ...f }; net.hoods.forEach((h, i) => (Q[h] = q[i]));
  const power = fanPower(net.fan, Qt, pFan);
  return { Q, Qtotal: Qt, pFan, power, powerEl: electricPower(net.fan, power), segLoss, iterations: it, converged: ok };
}

function gauss(A            , b          )           {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) { const k = M[r][c] / M[c][c]; for (let k2 = c; k2 <= n; k2++) M[r][k2] -= k * M[c][k2]; }
  }
  const x = Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let c = r + 1; c < n; c++) s -= M[r][c] * x[c]; x[r] = s / M[r][r]; }
  return x;
}

/** Установить угол заслонки в сегменте */
function setDamper(net         , segId        , alpha        ) {
  const s = net.segments.find(x => x.id === segId) ;
  for (const e of s.elements) if (e.kind === 'damper') e.alpha = alpha;
}


// ---- balance.ts
// Установившийся режим регулирования: подобрать углы заслонок и частоту вентилятора так, чтобы
// 1) расход каждого работающего поста = требуемому; 2) неработающие посты закрыты;
// 3) давление минимально: заслонка «критической» (самой нагруженной) ветви открыта полностью.
// Принцип 3 — аналог «сброса уставки давления» в VAV-системах (Liu et al., ASHRAE Trans., 2010) [М].


const ALPHA_OPEN = 0, ALPHA_CLOSED = 90;

function anglesForSpeed(net         , req                        , n        ) {
  net.fanSpeed = n;
  const dampers = net.hoods.map(h => net.segments.find(s => s.id === h) .elements.find(e => e.kind === 'damper')       );
  net.hoods.forEach((h, i) => { dampers[i].alpha = req[h] > 0 ? 20 : ALPHA_CLOSED; });
  let sol = solve(net);
  for (let it = 0; it < 200; it++) {
    let maxErr = 0;
    net.hoods.forEach((h, i) => {
      if (!(req[h] > 0)) return;
      const d = dampers[i];
      const z = damperZeta(d.alpha, d.table);
      const ratio = sol.Q[h] / req[h];
      maxErr = Math.max(maxErr, Math.abs(ratio - 1));
      // Δp заслонки ~ ζ·Q²: чтобы уменьшить расход в ratio раз, увеличиваем сопротивление ветви
      const tb = d.table ?? BUTTERFLY_ROUND;
      const zNew = Math.min(Math.max(z * Math.pow(ratio, 2 * 0.7) + (ratio - 1) * 0.5, damperZeta(0, tb)), damperZeta(70, tb));
      d.alpha = damperAngleForZeta(zNew, tb);
    });
    sol = solve(net, net.hoods.map(h => sol.Q[h]));
    if (maxErr < 0.0005) break;
  }
  const active = net.hoods.filter(h => req[h] > 0);
  const short = active.filter(h => sol.Q[h] < req[h] * 0.999);  // не добирают даже при открытой заслонке
  const minAlpha = Math.min(...active.map(h => dampers[net.hoods.indexOf(h)].alpha));
  return { sol, short, minAlpha, angles: Object.fromEntries(net.hoods.map((h, i) => [h, dampers[i].alpha])) };
}

function balance(net         , req                        , nMin = 300, nMax = 1500)                {
  const top = anglesForSpeed(net, req, nMax);
  if (top.short.length) {
    return { feasible: false, fanSpeed: nMax, angles: top.angles, sol: top.sol,
      message: `Требуемый расход недостижим при максимальной частоте: посты ${top.short.join(', ')}. Факт.: ${top.short.map(h => (top.sol.Q[h] * 3600).toFixed(0)).join(', ')} м³/ч` };
  }
  // бисекция по частоте: минимальная частота, при которой все посты получают требуемый расход
  let lo = nMin, hi = nMax, best = top;
  for (let i = 0; i < 25; i++) {
    const mid = (lo + hi) / 2, r = anglesForSpeed(net, req, mid);
    if (r.short.length === 0) { hi = mid; best = r; } else lo = mid;
  }
  anglesForSpeed(net, req, hi); // привести сеть в найденное состояние
  return { feasible: true, fanSpeed: hi, angles: best.angles, sol: best.sol,
    message: `Критическая ветвь открыта на ${(100 - best.minAlpha / 0.9).toFixed(0)} %` };
}


// ---- sim.ts
// Динамическая модель (блок 3). Шаг по времени dt, на каждом шаге:
// 1) состояние постов по расписанию → выделение (блок 1);
// 2) регуляторы задают целевые углы заслонок и частоту вентилятора (по режиму управления);
// 3) приводы отрабатывают с ограниченной скоростью (время полного хода);
// 4) сеть решается квазистационарно (блок 2): время прохода воздуха по сети — секунды [Д];
// 5) концентрация в цехе — уравнение баланса массы при полном перемешивании [М];
// 6) интегрируются энергия вентилятора и тепло на подогрев приточного воздуха.


// constant  — без регулирования: заслонки открыты, вентилятор 100 % всю смену
// onoff     — промышленный стандарт: заслонка открыта/закрыта по датчику тока, ЧП держит постоянное разрежение
// adaptive  — предлагаемая система: ПИ-регулятор расхода в каждой ветви + сброс давления (критическая ветвь открыта)

                                                                                  // g, г/кг; ПДК, q_пр — мг/м³
                                                                                                                                     
// etaReal — фактическая эффективность захвата (если отличается от принятой в расчёте η_ном): проверка устойчивости к ошибке модели
// B кг/ч (если current не задан), Qset м³/с; current(t) — сварочный ток, А → B по таблице проволоки

/** Общеобменная вентиляция (блок 4) */
                          
                                          
                                                                             
                                                                                                             
                                                        
                                                                 
                                                                                  
                                                                                                                             
                                                                                                          
                                                                                                    
                                                                                                                            
                                                                                                                             
 
                            
             
                                  
                                           
                                                                       
                    
                          
                                                                                        
                                                                                                                         
                                                               
                                                      
                             
                                                                                
                                                         
              
                                     
                                                                                                                        
                                                                               
                
                                       
                                                                                                        
                                                                                                          
                                                                                                     
                                                                                                                                                                                                                                                                               
 
                                                                                                                                                                                                                                                                                   
                            
                                                                              
                                                                                      
                                                                                       
                                                             
                                                                                                                                                              
                   
                                                                                                                                
                                                                                                             
                                                                                                                                           
                                                                                                                                
                                      
                                                                                               
 

const HEAT_COEF = 1.2; // кВт на 1 м³/с на 1 °C (Kulmala, VTT, 2015) [М]

function interp(tab                         , x        ) {
  if (x <= tab[0][0]) return tab[0][1] * x / tab[0][0];           // ниже первой точки — пропорционально [Д]
  for (let i = 1; i < tab.length; i++) if (x <= tab[i][0]) {
    const [x0, y0] = tab[i - 1], [x1, y1] = tab[i]; return y0 + (x - x0) * (y1 - y0) / (x1 - x0);
  }
  const [x0, y0] = tab[tab.length - 2], [x1, y1] = tab[tab.length - 1]; return y1 + (x - x1) * (y1 - y0) / (x1 - x0);
}

/** Пошаговый симулятор: step() продвигает модель на dt и возвращает текущее состояние.
 *  Используется и для расчёта смены (simulate), и в интерактивном интерфейсе. */
function createSimulator(net         , p           ) {
  const ids = p.posts.map(x => x.id);
  const damper = (id        ) => net.segments.find(s => s.id === id) .elements.find(e => e.kind === 'damper')                     ;
  const alpha                         = {}; ids.forEach(id => (alpha[id] = 90));
  const lnZ                         = {}; ids.forEach(id => (lnZ[id] = Math.log(damperZeta(30))));
  const memZ                         = { ...lnZ }; // упреждение: при включении поста заслонка сразу идёт в последнее рабочее положение
  let n = 0, nTarget = 0, sol                  = null, lastKey = '';
  // какие посты обслуживает каждый участок (для контроля транспортной скорости)
  const segHoods = new Map                  ();
  for (const h of ids) { let sg = net.segments.find(x => x.id === h); while (sg) { if (!segHoods.has(sg.id)) segHoods.set(sg.id, []); segHoods.get(sg.id) .push(h); sg = sg.parent ? net.segments.find(x => x.id === sg .parent) : undefined; } }
  const segD = (els       ) => els.filter(e => e.kind === 'duct').map(e => e.d          );
  const limName = p.gen?.limiting ?? p.substances[0].name;
  const bzSum                         = {}, bzMax                         = {}; ids.forEach(id => { bzSum[id] = 0; bzMax[id] = 0; });
  // скользящее 15-минутное среднее (максимально разовая ПДК сравнивается со средним за время отбора пробы) [Н: МУ/ГОСТ 12.1.005]
  const W = Math.max(1, Math.round(900 / p.dt));
  const ring                           = {}, ringSum                         = {}, bz15                         = {};
  [...ids, '__room'].forEach(id => { ring[id] = []; ringSum[id] = 0; bz15[id] = 0; });
  const push = (id        , v        ) => { const r = ring[id]; r.push(v); ringSum[id] += v; if (r.length > W) ringSum[id] -= r.shift() ; if (r.length === W) bz15[id] = Math.max(bz15[id], ringSum[id] / W); };
  const lowSeg                         = {}; let lowAny = 0, fanOnTime = 0, nonConv = 0;
  const C                         = {}; p.substances.forEach(s => (C[s.name] = s.qIn));
  const maxC                         = { ...C }, sumC                         = {}; p.substances.forEach(s => (sumC[s.name] = 0));
  let fanJ = 0, heatJ = 0, flowInt = 0, onTime = 0, under = 0, over = 0, genJ = 0, overPdk = 0, genInt = 0;
  let LgenNow = p.gen ? p.gen.Ldesign : p.room.Lgen, fbInt = 0, sensorC = 0, seed = 12345, ffF = 0;
  const noise = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648 - 0.5) * 2; // [-1;1]
  const Bof = (ps          , t        ) => (ps.current && p.wire ? interp(p.wire, ps.current(t)) : ps.B);
  const series           = [];
  const dAlphaMax = 90 / p.damperStroke * p.dt, dnMax = p.nMax / p.fanRamp * p.dt;

  let t = 0;
  function step()         {
    const on                          = {}; ids.forEach(id => (on[id] = p.schedule(id, t)));
    const anyOn = ids.some(id => on[id]);
    const Q = (id        ) => (sol ? sol.Q[id] : 0);

    // ---- регуляторы: целевые углы и частота
    const target                         = {};
    if (p.mode === 'constant') { ids.forEach(id => (target[id] = p.openAngles?.[id] ?? 0)); nTarget = p.nConst ?? p.nMax; }
    if (p.mode === 'onoff') {
      ids.forEach(id => (target[id] = on[id] ? (p.openAngles?.[id] ?? 0) : 90));
      // ЧП: ПИ по разрежению в коллекторе (давление перед общим трактом)
      const pColl = sol && n > 0 ? sol.pFan - sol.segLoss['common'] : 0;
      nTarget = anyOn ? Math.min(p.nMax, Math.max(p.nMin, nTarget + 0.5 * ((p.pSet ?? 600) - pColl) * p.dt)) : 0;
    }
    if (p.mode === 'adaptive') {
      for (const ps of p.posts) {
        if (!on[ps.id]) { target[ps.id] = 90; lnZ[ps.id] = memZ[ps.id]; continue; }
        // ПИ в пространстве ln ζ: линеаризует нелинейную характеристику заслонки
        const e = sol ? (Q(ps.id) - ps.Qset) / ps.Qset : 0;
        lnZ[ps.id] = Math.min(Math.log(damperZeta(70)), Math.max(Math.log(damperZeta(0)), lnZ[ps.id] + (p.kI ?? 1.5) * e * p.dt));
        target[ps.id] = damperAngleForZeta(Math.exp(lnZ[ps.id]));
        memZ[ps.id] = lnZ[ps.id];
      }
      const act = p.posts.filter(ps => on[ps.id]);
      if (!act.length) nTarget = 0;
      else {
        if (nTarget < p.nMin) nTarget = p.nMin;
        const key = act.map(ps => ps.id).join(',');
        if (p.nFF && key !== lastKey) nTarget = Math.max(nTarget, p.nFF(act.map(ps => ps.id))); // упреждение при включении поста
        const aMin = Math.min(...act.map(ps => alpha[ps.id]));
        const deficit = Math.max(...act.map(ps => (ps.Qset - Q(ps.id)) / ps.Qset));
        // сброс давления: если самая открытая заслонка прикрыта > 5° — снижаем частоту; если открыта и расхода не хватает — повышаем
        if (aMin < 2 && deficit > 0.002) nTarget += 400 * deficit * p.dt;
        else if (aMin > 5) nTarget -= 1.0 * (aMin - 5) * p.dt;
        nTarget = Math.min(p.nMax, Math.max(p.nMin, nTarget));
      }
      lastKey = act.map(ps => ps.id).join(',');
    }
    // ---- исполнительные механизмы с ограниченной скоростью
    ids.forEach(id => { const d = target[id] - alpha[id]; alpha[id] += Math.max(-dAlphaMax, Math.min(dAlphaMax, d)); damper(id).alpha = alpha[id]; });
    n += Math.max(-dnMax, Math.min(dnMax, nTarget - n));
    net.fanSpeed = n;

    // ---- сеть
    if (n < 30) sol = null;
    else sol = solve(net, sol ? ids.map(id => Math.max(sol .Q[id], 1e-4)) : undefined);
    if (sol && !sol.converged) nonConv++;
    const Qtot = sol ? sol.Qtotal : 0;
    // ---- транспортная скорость на участках с рабочим потоком
    if (sol && p.wMin) {
      fanOnTime += p.dt; let any = false;
      const check = (id        , Qs        , ds          ) => {
        for (const d of ds) if (Qs / area(d) < p.wMin ) { lowSeg[id] = (lowSeg[id] ?? 0) + p.dt; any = true; return; }
      };
      for (const sg of net.segments) if ((segHoods.get(sg.id) ?? []).some(h => on[h])) check(sg.id, sol.Q[sg.id], segD(sg.elements));
      if (anyOn) check('common', Qtot, segD(net.common));
      if (any) lowAny += p.dt;
    }
    const P = sol ? sol.powerEl : 0;   // электрическая мощность (если заданы данные двигателя)

    // ---- помещение: V dC/dt = Σ(1-η)G − (L_мо + L_оо)(C − q_пр)
    // η снижается, если расход поста меньше требуемого: η = η_ном·min(1, Q/Q_тр) [Д]
    const nOn = ids.filter(id => on[id]).length;
    let Lgen = p.room.LgenPerPost !== undefined ? (p.room.LgenMin ?? 0) + p.room.LgenPerPost * nOn : p.room.Lgen;
    if (p.gen) {
      const g = p.gen, lim = p.substances.find(x => x.name === g.limiting) ;
      let Lt = g.Ldesign;
      if (g.mode === 'posts') Lt = g.Lmin + (g.Ldesign - g.Lmin) * nOn / ids.length;
      if (g.mode === 'ff' || g.mode === 'fffb') {
        // упреждение: L = Σ(1−η_ном)·g·B(I) / (C_уст − q_пр) — формула блока 1 для целевой концентрации
        let G = 0; for (const ps of p.posts) if (on[ps.id]) G += (1 - ps.etaNom) * lim.g * 1000 * Bof(ps, t) / 3600;
        const ffRaw = G / (g.Cset - lim.qIn);
        ffF += g.ffTau ? (ffRaw - ffF) * p.dt / g.ffTau : ffRaw - ffF;
        Lt = ffF;
        if (g.mode === 'fffb') {
          const est = sensorC * g.sensor.ratio, e = (est - g.Cset) / g.Cset;   // оценка Mn по датчику общей массы
          // anti-windup (условное интегрирование): интеграл не копится, если выход упёрся в ограничение в ту же сторону
          const uFree = Lt + g.kP * e * g.Ldesign + fbInt;
          const satHi = uFree >= g.Lmax && e > 0, satLo = uFree <= g.Lmin && e < 0;
          if (g.antiWindup === false || (!satHi && !satLo)) fbInt = Math.max(-g.Ldesign, Math.min(g.Ldesign, fbInt + g.kI * e * g.Ldesign * p.dt));
          Lt += g.kP * e * g.Ldesign + fbInt;
        }
      }
      Lt = Math.min(g.Lmax, Math.max(g.Lmin, Lt));
      const dL = g.Lmax / g.ramp * p.dt; LgenNow += Math.max(-dL, Math.min(dL, Lt - LgenNow));
      Lgen = LgenNow;
      const Pg = g.Ldesign * g.dpDesign / g.etaFan * Math.pow(Lgen / g.Ldesign, 3);
      genJ += Pg * p.dt;
    }
    genInt += Lgen * p.dt;
    const Lout = Qtot + Lgen;
    for (const s of p.substances) {
      let Groom = 0; // мг/с
      for (const ps of p.posts) if (on[ps.id]) {
        const eta = (ps.etaReal ?? ps.etaNom) * Math.min(1, Q(ps.id) / ps.Qset);
        Groom += (1 - eta) * s.g * 1000 * Bof(ps, t) / 3600;
      }
      C[s.name] += p.dt * (Groom - Lout * (C[s.name] - s.qIn)) / p.room.V;
      maxC[s.name] = Math.max(maxC[s.name], C[s.name]); sumC[s.name] += C[s.name] * p.dt;
    }
    // ---- зона дыхания сварщика (ближняя зона)
    const lim = p.substances.find(x => x.name === limName) ;
    const Cbz                         = {};
    for (const ps of p.posts) {
      let c = C[lim.name];
      if (p.nearField && on[ps.id]) {
        const eta = (ps.etaReal ?? ps.etaNom) * Math.min(1, Q(ps.id) / ps.Qset);
        const Gesc = (1 - eta) * lim.g * 1000 * Bof(ps, t) / 3600;           // мг/с, ушло мимо отсоса
        const beta = 0.5 * 2 * Math.PI * p.nearField.r ** 2 * p.nearField.s; // м³/с
        c += Gesc / beta;
      }
      Cbz[ps.id] = c; bzSum[ps.id] += c * p.dt; bzMax[ps.id] = Math.max(bzMax[ps.id], c); push(ps.id, c);
    }
    push('__room', C[lim.name]);
    if (p.gen) {
      const g = p.gen, lim = p.substances.find(x => x.name === g.limiting) ;
      if (C[lim.name] > lim.pdk) overPdk += p.dt;
      // датчик: инерционное звено 1-го порядка + шум (доля от показания) [Д]
      const meas = C[g.sensor.of] * (1 + g.sensor.noise * noise());
      sensorC += (meas - sensorC) * p.dt / g.sensor.tau;
    }
    // ---- энергия и качество регулирования
    const heat = HEAT_COEF * Lout * p.room.dT; // кВт
    fanJ += P * p.dt; heatJ += heat * 1000 * p.dt; flowInt += Qtot * p.dt;
    for (const ps of p.posts) if (on[ps.id]) {
      onTime += p.dt; const r = Q(ps.id) / ps.Qset;
      if (r < 0.95) under += p.dt; if (r > 1.10) over += p.dt;
    }
    const sample         = { Cbz, t, n, Q: Object.fromEntries(ids.map(id => [id, Q(id) * 3600])), alpha: { ...alpha }, on, C: { ...C }, P, heat, Lgen: Lgen * 3600, sensor: sensorC, pFan: sol ? sol.pFan : 0, Qtot: Qtot * 3600 };
    if (p.record && Math.abs(t / p.record - Math.round(t / p.record)) < 1e-9) series.push(sample);
    t += p.dt;
    return sample;
  }
  /** Итоги; duration — интервал усреднения, с (по умолчанию длительность сценария) */
  function result(duration = p.duration)            {
    const d = Math.max(duration, 1e-9);
    const avgC                         = {}; for (const k in sumC) avgC[k] = sumC[k] / d;
    return { fanKWh: fanJ / 3.6e6, heatKWh: heatJ / 3.6e6, avgFlow: flowInt / d * 3600,
      underFlowShare: onTime ? under / onTime : 0, overFlowShare: onTime ? over / onTime : 0, maxC, avgC, series,
      genKWh: genJ / 3.6e6, overPdkShare: overPdk / d, avgLgen: genInt / d * 3600,
      bzTWA: Object.fromEntries(ids.map(id => [id, bzSum[id] / d])), bzMax: { ...bzMax }, bz15max: { ...bz15 },
      lowVelShare: fanOnTime ? lowAny / fanOnTime : 0,
      lowVelBySeg: Object.fromEntries(Object.entries(lowSeg).map(([k, v]) => [k, fanOnTime ? v / fanOnTime : 0])),
      nonConverged: nonConv };
  }
  return { step, result, net, params: p, time: () => t };
}

function simulate(net         , p           )            {
  const sim = createSimulator(net, p);
  for (let t = 0; t <= p.duration; t += p.dt) sim.step();
  return sim.result();
}


// ---- demo-network.ts
// Демонстрационная сеть: 3 поста на общем коллекторе, фильтр, вентилятор.
// ВНИМАНИЕ: геометрия и характеристика вентилятора — [Д] условные, для проверки ядра.
                                            

function demoNetwork()          {
  const post = (i        , parent        ) => ({
    id: `post${i}`, parent,
    elements: [
      { kind: 'duct'         , id: `hood${i}`, d: 0.2, l: 6, zeta: 1.5 },   // отсос + отвод + вход в тройник
      { kind: 'damper'         , id: `damper${i}`, d: 0.2, alpha: 0 },
    ],
  });
  return {
    segments: [
      post(1, 'c1'), post(2, 'c2'), post(3, 'c3'),
      { id: 'c1', parent: 'c2', elements: [{ kind: 'duct', id: 'c1', d: 0.25, l: 5, zeta: 0.2 }] },
      { id: 'c2', parent: 'c3', elements: [{ kind: 'duct', id: 'c2', d: 0.315, l: 5, zeta: 0.2 }] },
      { id: 'c3', parent: null, elements: [{ kind: 'duct', id: 'main', d: 0.4, l: 10, zeta: 0.5 }] },
    ],
    hoods: ['post1', 'post2', 'post3'],
    common: [
      { kind: 'filter', id: 'filter', spec: { dpNom: 400, qNom: 4500 / 3600, m: 1, fouling: 1 } },
      // m = 1: фильтрующий материал + слой пыли — закон Дарси, Δp = S·V при неизменной пылевой нагрузке (US EPA, Air Pollution Control Cost Manual, разд. 6, гл. 1, ур. 1.1, 1.3)
      { kind: 'duct', id: 'discharge', d: 0.4, l: 5, zeta: 1.0 },
    ],
    fan: { n0: 1500, eta: 0.65, points: [[0, 1400], [2000, 1300], [4000, 1050], [5000, 850], [6000, 550], [7000, 150]], motorW: 2200, motorEta: 0.867 },
    // двигатель 2,2 кВт, 4 полюса, класс IE3: КПД ≥ 86,7 % (ГОСТ Р МЭК 60034-30-1 / IEC 60034-30-1, табл. 3); макс. мощность на валу ≈ 1,9 кВт
    fanSpeed: 1500,
  };
}

/** Генератор сети на N постов: посты вдоль коллектора, диаметры подбираются на скорость ≈ 12 м/с при расчётном расходе.
 *  [Д] Геометрия условная; вентилятор масштабируется по расходу (характеристика демо-вентилятора × N/3). */
function makeNetwork(N        , Qpost = 1500, wDesign = 12)          {
  const dFor = (Qm3h        ) => Math.max(0.1, Math.round(Math.sqrt(4 * (Qm3h / 3600) / (Math.PI * wDesign)) * 1000 / 5) * 5 / 1000);
  const segs                      = [];
  for (let i = 1; i <= N; i++) {
    segs.push({ id: `post${i}`, parent: `c${i}`, elements: [
      { kind: 'duct', id: `hood${i}`, d: dFor(Qpost), l: 6, zeta: 1.5 },
      { kind: 'damper', id: `damper${i}`, d: dFor(Qpost), alpha: 0 },
    ] });
    segs.push({ id: `c${i}`, parent: i < N ? `c${i + 1}` : null, elements: [
      { kind: 'duct', id: `c${i}`, d: dFor(Qpost * i), l: i < N ? 5 : 10, zeta: i < N ? 0.2 : 0.5 },
    ] });
  }
  const s = N / 3;
  return {
    segments: segs, hoods: Array.from({ length: N }, (_, i) => `post${i + 1}`),
    common: [
      { kind: 'filter', id: 'filter', spec: { dpNom: 400, qNom: N * Qpost / 3600, m: 1, fouling: 1 } },
      { kind: 'duct', id: 'discharge', d: dFor(Qpost * N), l: 5, zeta: 1.0 },
    ],
    fan: { n0: 1500, eta: 0.65, points: ([[0, 1400], [2000, 1300], [4000, 1050], [5000, 850], [6000, 550], [7000, 150]]                           ).map(([q, p]) => [q * s, p]                    ), ...pickMotor(1900 * s) },
    fanSpeed: 1500,
  };
}

/** Двигатели IE3, 4 полюса, 50 Гц: номинальная мощность, Вт → минимальный КПД (IEC 60034-30-1, табл. 3) */
const IE3_4P                          = [[750, 0.825], [1100, 0.841], [1500, 0.853], [2200, 0.867], [3000, 0.877], [4000, 0.886], [5500, 0.896], [7500, 0.904], [11000, 0.914], [15000, 0.921], [18500, 0.926], [22000, 0.930], [30000, 0.936], [37000, 0.939], [45000, 0.942], [55000, 0.946], [75000, 0.950]];
/** Подбор двигателя: ближайший стандартный ≥ максимальной мощности на валу */
function pickMotor(maxShaftW        ) {
  const m = IE3_4P.find(([w]) => w >= maxShaftW) ?? IE3_4P[IE3_4P.length - 1];
  return { motorW: m[0], motorEta: m[1] };
}


// ---- scenario.ts
// Сценарий смены: 3 поста MAG-сварки, 8 ч с обедом. Все численные параметры — [Д] условные, кроме помеченных.



/** Таблица упреждения: расчётная частота вентилятора для каждого набора работающих постов (по установившемуся режиму блока 2) */
function feedforwardTable(ids          , Qset        ) {
  const cache = new Map                ();
  return (active          ) => {
    const key = active.join(',');
    if (!cache.has(key)) {
      const req = Object.fromEntries(ids.map(id => [id, active.includes(id) ? Qset : 0]));
      cache.set(key, balance(demoNetwork(), req).fanSpeed);
    }
    return cache.get(key) ;
  };
}

/** Детерминированное псевдослучайное расписание: дуга горит отрезками 1–5 мин, паузы 1–7 мин;
 *  обед 4:00–5:00 — все посты выключены. Доля горения ~40–45 % — порядок значений для MIG/MAG по данным TWI. */
function makeSchedule(ids          , duration        , seed = 7) {
  let x = seed; const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  const iv                                          = {};
  for (const id of ids) {
    iv[id] = []; let t = rnd() * 300;
    while (t < duration) { const on = 60 + rnd() * 240; iv[id].push([t, t + on]); t += on + 60 + rnd() * 360; }
  }
  return (id        , t        ) => !(t >= 4 * 3600 && t < 5 * 3600) && iv[id].some(([a, b]) => t >= a && t < b);
}

/** Пусконаладка: балансировка ветвей при расчётном режиме (все посты по 1500 м³/ч) — фиксированные углы и частота */
function commissioning() {
  const b = balance(demoNetwork(), { post1: m3h(1500), post2: m3h(1500), post3: m3h(1500) });
  return { angles: b.angles, n: b.fanSpeed, pSet: b.sol.pFan - b.sol.segLoss['common'] };
}

function shiftParams(mode      , pSet         , balanced = true)            {
  const c0 = commissioning(), com = balanced ? c0 : null;
  const ids = ['post1', 'post2', 'post3'];
  const duration = 8 * 3600;
  return {
    mode, dt: 1, duration, schedule: makeSchedule(ids, duration), record: 10,
    posts: ids.map(id => ({ id, B: 3, Qset: m3h(1500), etaNom: 0.9 })),       // 1500 м³/ч — ГОСТ 12.3.003-86 п. 2.11.1
    substances: [
      { name: 'Mn', g: 1.90, pdk: 0.2, qIn: 0.001 },   // Св-08Г2С, блок 1
      { name: 'Fe2O3', g: 7.67, pdk: 6, qIn: 0.04 },
    ],
    room: { V: 48 * 24 * 14.4, Lgen: m3h(8600), dT: 19.7 },  // Δt = 18 − (−1,7): t_в = 18 °C [Д]; −1,7 °C — средняя за отопительный период (≤ 8 °C, 202 сут), Москва, СП 131.13330.2025, табл. 3.1
    // объём цеха из диплома; общеобменная — по блоку 1 (η = 0,9, 3 поста)
    damperStroke: 8,  // 8 с — время хода заслонки Plymovent AD (паспорт); одинаково для сравнения режимов
    fanRamp: 10, nMax: 1500, nMin: 300, pSet: pSet ?? c0.pSet, kI: 4,   // уставка разрежения — из пусконаладки, если не задана
    nFF: mode === 'adaptive' ? feedforwardTable(ids, m3h(1500)) : undefined,
    openAngles: com ? com.angles : undefined, nConst: com ? com.n : undefined,
  };
}


// ---- scenario4.ts
// Блок 4: смена с переменным током сварки, общеобменная вентиляция по потребности.


/** Расход проволоки ER70S-6 Ø1,2 мм (аналог Св-08Г2С [Д]) от тока: 175 А — 1,68; 225 А — 2,36; 270 А — 3,73 кг/ч.
 *  Источник: materialwelding.com (ориентировочные значения, без ссылки на испытания) — [П] уточнить по данным производителя. */
const WIRE_12                          = [[175, 1.68], [225, 2.36], [270, 3.73]];

/** Те же интервалы горения дуги, что в блоке 3; каждому интервалу — свой режим (175/225/270 А) */
function makeShift(ids          , duration        , seed = 7) {
  let x = seed; const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  const iv                                                  = {};
  for (const id of ids) {
    iv[id] = []; let t = rnd() * 300;
    while (t < duration) { const on = 60 + rnd() * 240; const I = [175, 225, 270][Math.floor(rnd() * 3)]; iv[id].push([t, t + on, I]); t += on + 60 + rnd() * 360; }
  }
  const lunch = (t        ) => t >= 4 * 3600 && t < 5 * 3600;
  return {
    schedule: (id        , t        ) => !lunch(t) && iv[id].some(([a, b]) => t >= a && t < b),
    current: (id        ) => (t        ) => { const r = iv[id].find(([a, b]) => t >= a && t < b); return r && !lunch(t) ? r[2] : 0; },
  };
}

const MN = { name: 'Mn', g: 1.90, pdk: 0.2, qIn: 0.001 };   // СанПиН 1.2.3685-21, табл. 2.1, стр. 1222 (Mn ≤ 20 %)
const AER = { name: 'aerosol', g: 10.0, pdk: 1e9, qIn: 0 };   // сварочный аэрозоль, общая масса (для датчика)

/** Расчётный (проектный) расход ОВ: все 3 поста одновременно на максимальном режиме 270 А, C = ПДК (блок 1) */
function designLgen(eta = 0.9, n = 3) {
  const G = n * (1 - eta) * MN.g * 1000 * 3.73 / 3600; // мг/с
  return G / (MN.pdk - MN.qIn);
}

function shift4(mode                 , opts                                      = {})            {
  const ids = ['post1', 'post2', 'post3'];
  const base = shiftParams('adaptive');
  const sh = makeShift(ids, base.duration);
  const Ld = designLgen();
  return {
    ...base, schedule: sh.schedule, wire: WIRE_12,
    posts: ids.map(id => ({ id, B: 0, Qset: m3h(1500), etaNom: 0.9, etaReal: opts.etaReal, current: sh.current(id) })),
    substances: [MN, AER],
    gen: {
      mode, Ldesign: Ld, Lmin: 0.2 * Ld, Lmax: 1.5 * Ld, limiting: 'Mn', Cset: opts.Cset ?? 0.5 * MN.pdk,
      sensor: { of: 'aerosol', ratio: MN.g / AER.g, tau: 30, noise: 0.1 },   // [Д] датчик: τ = 30 с, шум ±10 %
      kP: 0.5, kI: 0.005, ffTau: 600, dpDesign: 600, etaFan: 0.6, ramp: 20,  // [Д]; ffTau, kI подобраны на модели (таблица настройки в блоке 4)
    },
  };
}


window.Engine = { AIR, m3h, toM3h, area, velocity, dynPressure, lambdaAltshul, ductLoss, BUTTERFLY_ROUND, damperZeta, damperAngleForZeta, VFD_EFF, MOTOR_REL, electricPower, fanPressure, fanPower, filterLoss, solve, setDamper, balance, interp, createSimulator, simulate, demoNetwork, makeNetwork, IE3_4P, pickMotor, feedforwardTable, makeSchedule, commissioning, shiftParams, WIRE_12, makeShift, MN, AER, designLgen, shift4 };
})();
