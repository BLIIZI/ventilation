// Физические зависимости. Внутри — СИ: м, м³/с, Па, кг/м³.
// Каждая функция помечена источником и статусом: [Н] норматив, [М] инженерная модель, [Д] допущение, [П] требует проверки.

export const AIR = { rho: 1.2, nu: 15.06e-6 }; // [М] воздух при +20 °C (плотность и кинематическая вязкость)

export const m3h = (q: number) => q / 3600;      // м³/ч -> м³/с
export const toM3h = (q: number) => q * 3600;    // м³/с -> м³/ч
export const area = (d: number) => Math.PI * d * d / 4;

/** Скорость, м/с */
export const velocity = (Q: number, d: number) => Q / area(d);

/** Динамическое давление pд = ρw²/2, Па [М] */
export const dynPressure = (w: number, rho = AIR.rho) => rho * w * w / 2;

/** Коэффициент трения по формуле А.Д. Альтшуля λ = 0,11·(kэ/d + 68/Re)^0,25 [М]
 *  Альтшуль А.Д. Гидравлические сопротивления. — М.: Недра, 1982.
 *  Проверено: воспроизводит λ·l/d из таблицы 4.1 диплома (kэ = 0,1 мм). */
export function lambdaAltshul(w: number, d: number, ke = 0.1e-3, nu = AIR.nu): number {
  const Re = Math.max(Math.abs(w) * d / nu, 1);
  if (Re < 2300) return 64 / Re; // ламинарный режим (Пуазейль) — на практике в вентиляции не встречается
  return 0.11 * Math.pow(ke / d + 68 / Re, 0.25);
}

/** Потери давления на участке воздуховода Δp = (λ·l/d + Σζ)·pд, Па [М]
 *  Формула Дарси–Вейсбаха + местные сопротивления (Идельчик И.Е., 1992; Посохин В.Н., 2008). */
export function ductLoss(Q: number, d: number, l: number, sumZeta: number, ke = 0.1e-3): number {
  const w = velocity(Math.abs(Q), d);
  const lam = lambdaAltshul(w, d, ke);
  return (lam * l / d + sumZeta) * dynPressure(w) * Math.sign(Q);
}

// ---------- Заслонка
/** Характеристика дроссель-клапана в круглом воздуховоде: угол α (0° — открыта, 90° — закрыта) → ζ.
 *  [П] Значения по справочнику Идельчика (дроссель-клапан, круглая труба) — ТРЕБУЮТ СВЕРКИ по первоисточнику.
 *  Участок 70–90° — [Д]: закрытая заслонка моделируется утечкой (ζ = 1e4 при 90°). */
export const BUTTERFLY_ROUND: Array<[number, number]> = [
  [0, 0.2], [5, 0.24], [10, 0.52], [15, 0.9], [20, 1.54], [25, 2.51], [30, 3.91], [35, 6.22],
  [40, 10.8], [45, 18.7], [50, 32.6], [55, 58.8], [60, 118], [65, 256], [70, 751], [90, 1e4],
];

/** ζ(α) — интерполяция ln ζ по углу (ζ растёт почти экспоненциально) [М] */
export function damperZeta(alphaDeg: number, table = BUTTERFLY_ROUND): number {
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
export function damperAngleForZeta(zeta: number, table = BUTTERFLY_ROUND): number {
  let lo = table[0][0], hi = table[table.length - 1][0];
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (damperZeta(m, table) < zeta) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

// ---------- Вентилятор
/** Характеристика вентилятора по точкам каталога (Q м³/ч, p Па) при n0 об/мин.
 *  Пересчёт на другую частоту — законы подобия: Q~n, p~n², N~n³ [М]
 *  (U.S. DOE. Improving Fan System Performance: A Sourcebook for Industry, 2003). */
export interface FanCurve {
  n0: number; points: Array<[number, number]>; eta: number;   // eta — КПД вентилятора (на валу)
  motorW?: number; motorEta?: number;   // номинальная мощность и КПД двигателя; если заданы — считается электрическая мощность с ЧП
}

/** КПД частотного преобразователя от нагрузки (доля номинальной мощности ЧП).
 *  US DOE, Motor Systems Tip Sheet #11 «Adjustable Speed Drive Part-Load Efficiency», табл. 1, строка 5 hp (типовой ШИМ-ЧП). [Н/справ.] */
export const VFD_EFF: Array<[number, number]> = [[0.016, 0.35], [0.125, 0.80], [0.25, 0.88], [0.42, 0.91], [0.5, 0.92], [0.75, 0.94], [1.0, 0.95]];
/** Относительный КПД асинхронного двигателя при частичной нагрузке (к номинальному). [Д][П]
 *  50–100 %: по каталогам IE3 КПД практически постоянен; ниже 50 % падает (DOE, «Determining Electric Motor Load and Efficiency»).
 *  Точки ниже 50 % — оценка, уточнить по каталогу конкретного двигателя. */
export const MOTOR_REL: Array<[number, number]> = [[0.05, 0.55], [0.1, 0.75], [0.25, 0.93], [0.5, 1.0], [1.0, 1.0]];
function tab(t: Array<[number, number]>, x: number) {
  if (x <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) if (x <= t[i][0]) { const [x0, y0] = t[i - 1], [x1, y1] = t[i]; return y0 + (x - x0) * (y1 - y0) / (x1 - x0); }
  return t[t.length - 1][1];
}
/** Электрическая мощность из сети: P_эл = P_вал / (η_дв(β)·η_ЧП(β)), β = P_вал / P_ном */
export function electricPower(fan: FanCurve, shaftW: number): number {
  if (shaftW <= 0) return 0;
  if (!fan.motorW || !fan.motorEta) return shaftW;
  const beta = shaftW / fan.motorW;
  return shaftW / (fan.motorEta * tab(MOTOR_REL, beta) * tab(VFD_EFF, beta));
}

export function fanPressure(fan: FanCurve, Q: number, n: number): number {
  const k = n / fan.n0;
  if (k <= 0) return 0;
  const Q0 = toM3h(Q) / k; // приводим к номинальной частоте
  const p = fan.points;
  let p0: number;
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
export const fanPower = (fan: FanCurve, Q: number, p: number) => Math.max(0, Q * p) / fan.eta; // < 0 физически невозможно для вентилятора: за пределами характеристики мощность 0 [М]

// ---------- Фильтр
/** Сопротивление фильтра Δp = Δp_ном·(Q/Q_ном)^m·k_загр [М/Д]
 *  m = 1…2 (1 — ламинарная фильтрация через слой, 2 — квадратичный закон); k_загр ≥ 1 — коэффициент загрязнения. */
export interface FilterSpec { dpNom: number; qNom: number; m: number; fouling: number; }
export const filterLoss = (f: FilterSpec, Q: number) =>
  f.dpNom * Math.pow(Math.abs(Q) / f.qNom, f.m) * f.fouling * Math.sign(Q);
