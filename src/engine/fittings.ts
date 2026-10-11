// МЕСТНЫЕ СОПРОТИВЛЕНИЯ (фасонные части) — по Идельчику И.Е. Справочник по гидравлическим сопротивлениям. 3-е изд. — М.: Машиностроение, 1992.
// Каждый коэффициент ζ отнесён к динамическому давлению в указанном сечении. Потери Δp = ζ·ρw²/2.
// [П] — формула приведена по справочнику, номер диаграммы и коэффициенты сверить по книге (Саша пришлёт фото страниц).

/** Отвод круглого сечения с плавным поворотом, R₀/D₀ < 3 — Идельчик И.Е., 1992, разд. 6, диагр. 6-1, с. 277–278 [С] (сверено по книге 11.10.2026).
 *  ζ_м = A₁·B₁·C₁ (C₁ = 1 для круглого сечения), отнесено к скорости в отводе.
 *  A₁(δ) — таблица на с. 278: 0°—0; 20°—0,31; 30°—0,45; 45°—0,60; 60°—0,78; 75°—0,90; 90°—1,00; 110°—1,13; 130°—1,20; 150°—1,28; 180°—1,40.
 *  B₁ = 0,21·(R₀/D₀)^−2,5 при R₀/D₀ = 0,5…1,0; 0,21·(R₀/D₀)^−0,5 при R₀/D₀ > 1,0.
 *  Шероховатые стенки (воздуховоды из стали, Δ > 0), Re ≥ 10⁴: ζ = k_Δ·k_Re·ζ_м + ζ_тр (п. 2 диаграммы); ζ_тр — трение по длине дуги, считается в длине участка.
 *  k_Re (с. 277): R₀/D₀ > 0,70 → 1,3 − 0,29·ln(Re·10⁻⁵); 0,55…0,70 → 5,45/Re^0,131; 0,50…0,55 → 1 + 4400/Re.
 *  k_Δ (с. 278, R₀/D₀ > 0,55, Δ̄ ≤ 0,001): Re 3·10³…4·10⁴ → 1,0; 4·10⁴…2·10⁵ → λ_Δ/λ_гл; > 2·10⁵ → 1 + Δ̄·10³.
 *  [М] На границах диапазонов Re таблица k_Δ даёт скачки (при Δ̄ = 0,0005 на Re = 2·10⁵: 1,16 → 1,5). Чтобы у сети было решение при любом расходе,
 *  k_Δ сглажен линейно по ln Re в пределах ×/÷ 1,25 от границ (3,2·10⁴…5·10⁴ и 1,6·10⁵…2,5·10⁵); Re < 10⁴ (только утечки через закрытые заслонки) — k_Re по Re = 10⁴. */
const A1_TAB: Array<[number, number]> = [[0, 0], [20, 0.31], [30, 0.45], [45, 0.60], [60, 0.78], [75, 0.90], [90, 1.00], [110, 1.13], [130, 1.20], [150, 1.28], [180, 1.40]];
const lin = (t: Array<[number, number]>, x: number) => {
  if (x <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) if (x <= t[i][0]) { const [x0, y0] = t[i - 1], [x1, y1] = t[i]; return y0 + (x - x0) * (y1 - y0) / (x1 - x0); }
  return t[t.length - 1][1];
};
export const bendA1 = (deltaDeg: number) => lin(A1_TAB, deltaDeg);
export const bendB1 = (rOverD: number) => rOverD <= 1 ? 0.21 / rOverD ** 2.5 : 0.21 / rOverD ** 0.5;
/** ζ_м = A₁·B₁ — местное сопротивление отвода с гладкими стенками при Re > 2·10⁵ */
export function bendZeta(deltaDeg: number, rOverD: number): number { return bendA1(deltaDeg) * bendB1(rOverD); }
/** λ технически гладких труб (Идельчик, диагр. 2-1; формула Филоненко–Альтшуля): λ = 1/(1,8·lg Re − 1,64)², Re ≥ 4000 */
export const lambdaSmooth = (Re: number) => 1 / (1.8 * Math.log10(Math.max(Re, 4000)) - 1.64) ** 2;
export function bendKRe(Re: number, rOverD: number): number {
  const R = Math.max(Re, 1e4);
  if (rOverD > 0.70) return 1.3 - 0.29 * Math.log(R * 1e-5);
  if (rOverD > 0.55) return 5.45 / R ** 0.131;
  return 1 + 4400 / R;
}
/** k_Δ; lamRough — λ шероховатой трубы при этом Re (Альтшуль), relRough = Δ/D */
export function bendKDelta(Re: number, lamRough: number, relRough: number): number {
  const mid = lamRough / lambdaSmooth(Re), hi = 1 + Math.min(relRough, 0.001) * 1e3;
  const blend = (x: number, x0: number, x1: number, y0: number, y1: number) => { const t = (Math.log(x) - Math.log(x0)) / (Math.log(x1) - Math.log(x0)); return y0 + Math.min(1, Math.max(0, t)) * (y1 - y0); };
  if (Re <= 3.2e4) return 1;
  if (Re < 5e4) return blend(Re, 3.2e4, 5e4, 1, mid);  // от 1,0 к λ_Δ/λ_гл (непрерывно)
  if (Re <= 1.6e5) return mid;
  if (Re < 2.5e5) return blend(Re, 1.6e5, 2.5e5, mid, hi);
  return hi;
}
/** Полный местный коэффициент отвода в стальном воздуховоде при данном Re */
export function bendZetaRough(deltaDeg: number, rOverD: number, Re: number, lamRough: number, relRough: number): number {
  return bendKDelta(Re, lamRough, relRough) * bendKRe(Re, rOverD) * bendZeta(deltaDeg, rOverD);
}

/** Внезапное расширение (формула Борда–Карно): ζ = (1 − F₁/F₂)², отнесено к скорости в узком сечении F₁ (разд. 4-1, диагр. 4-1) */
export const suddenExpansionZeta = (d1: number, d2: number) => (1 - (d1 / d2) ** 2) ** 2;

/** Конический диффузор в сети, угол раскрытия α, F₁/F₀ = n — Идельчик, 1992, разд. 5, диагр. 5-2, с. 211 (табл. ζ_д при n = 2, l₀/D₀ = 0) и
 *  формулы (5-6), (5-7), с. 192–193 (сверено по книге 11.10.2026). ζ к скорости в узком сечении, включает трение.
 *  Таблица дана для n ≥ 2; у переходов в сети n ≈ 1,5–2, поэтому [М]: ζ(n) = [ζ_табл(α, Re; n = 2) − ζ_тр(2)]·((1 − 1/n)/0,5)^1,92 + ζ_тр(n),
 *  где 1,92 — показатель m для конических диффузоров в (5-7), ζ_тр = λ/(8·sin(α/2))·(1 − 1/n²) — формула (5-6).
 *  Re < 0,5·10⁵ и > 4·10⁵ — значения на границе таблицы. При α > 40° — не меньше Борда–Карно (1 − 1/n)². */
const DIFF_A = [3, 4, 6, 8, 10, 12, 14, 16, 20, 30, 45, 60, 90, 120, 180];
const DIFF_RE = [0.5e5, 1e5, 2e5, 4e5];
const DIFF_N2 = [
  [0.148, 0.135, 0.121, 0.112, 0.107, 0.109, 0.120, 0.141, 0.191, 0.315, 0.331, 0.326, 0.315, 0.308, 0.298],
  [0.120, 0.106, 0.090, 0.083, 0.080, 0.088, 0.102, 0.122, 0.196, 0.298, 0.297, 0.286, 0.283, 0.279, 0.276],
  [0.093, 0.082, 0.070, 0.068, 0.062, 0.062, 0.063, 0.073, 0.120, 0.229, 0.279, 0.268, 0.268, 0.265, 0.263],
  [0.079, 0.068, 0.056, 0.048, 0.048, 0.048, 0.051, 0.051, 0.068, 0.120, 0.271, 0.272, 0.272, 0.268, 0.268],
];
export function diffuserZetaN2(alphaDeg: number, Re: number): number {
  const a = Math.min(Math.max(alphaDeg, 3), 180), r = Math.min(Math.max(Re, DIFF_RE[0]), DIFF_RE[3]);
  let j = 1; while (j < DIFF_A.length - 1 && a > DIFF_A[j]) j++;
  let i = 1; while (i < DIFF_RE.length - 1 && r > DIFF_RE[i]) i++;
  const ta = (a - DIFF_A[j - 1]) / (DIFF_A[j] - DIFF_A[j - 1]), tr = (Math.log(r) - Math.log(DIFF_RE[i - 1])) / (Math.log(DIFF_RE[i]) - Math.log(DIFF_RE[i - 1]));
  const v = (ii: number) => DIFF_N2[ii][j - 1] + ta * (DIFF_N2[ii][j] - DIFF_N2[ii][j - 1]);
  return v(i - 1) + tr * (v(i) - v(i - 1));
}
export function diffuserZeta(d1: number, d2: number, alphaDeg = 15, Re = 2e5, lam = 0.018): number {
  const n = (d2 / d1) ** 2;
  if (n <= 1) return 0;
  const bc = (1 - 1 / n) ** 2;
  const fr = (nn: number) => lam / (8 * Math.sin(alphaDeg / 2 * Math.PI / 180)) * (1 - 1 / nn ** 2);
  const z = Math.max(0, diffuserZetaN2(alphaDeg, Re) - fr(2)) * ((1 - 1 / n) / 0.5) ** 1.92 + fr(n);
  return alphaDeg > 40 ? Math.max(z, bc) : z;
}

/** Внезапное сужение: ζ = 0,5·(1 − F₂/F₁)^0,75, к скорости в узком сечении F₂ (разд. 4, диагр. 4-9) [П] */
export const suddenContractionZeta = (d1: number, d2: number) => 0.5 * (1 - (d2 / d1) ** 2) ** 0.75;

/** Вход в трубу через конический коллектор (раструб без торцевой стенки) — Идельчик, 1992, диагр. 3-6, с. 127 (сверено): при α = 60°
 *  ζ = 0,25 (l/D = 0,15), 0,17 (l/D = 0,25); принято 0,2 [Д: геометрия зонта l/D ≈ 0,2];
 *  острая кромка без коллектора — 0,5. Выход в атмосферу (потеря динамического давления) — ζ = 1,0. */
export const HOOD_CONE_ZETA = 0.2;
export const SHARP_ENTRY_ZETA = 0.5;
export const EXIT_ZETA = 1.0;

/** Тройник вытяжной (слияние потоков) 90°, F_п + F_б > F_с, F_п = F_с — Идельчик, 1992, разд. 7, **диагр. 7-4, с. 346**; A — **табл. 7-1, с. 335** [С] (сверено по книге 11.10.2026).
 *  Коэффициенты отнесены к скорости в ОБЩЕМ (сборном) канале w_с:
 *   боковое ответвление: ζ_с.б = A·[1 + (Q_б/Q_с · F_с/F_б)² − 2·(1 − Q_б/Q_с)²],  A — по teeA() [П];
 *   проход:              ζ_с.п = 1,55·(Q_б/Q_с) − (Q_б/Q_с)².
 *  Коэффициенты могут быть отрицательными (эжекция) — это физический эффект. */
export function teeSideZeta(qb: number, qc: number, db: number, dc: number, A?: number): number {
  if (qc <= 0) return 0;
  const r = Math.min(1, Math.max(0, qb / qc)), fcfb = (dc / db) ** 2;
  return (A ?? teeA(1 / fcfb, r)) * (1 + (r * fcfb) ** 2 - 2 * (1 - r) ** 2);
}
/** Поправочный коэффициент A к боковому ответвлению тройника на слияние (F_п = F_с):
 *  F_б/F_с ≤ 0,35 → A = 1; F_б/F_с > 0,35: Q_б/Q_с ≤ 0,4 → A = 0,9·(1 − Q_б/Q_с); Q_б/Q_с > 0,4 → A = 0,55.
 *  Идельчик И.Е., 1992, табл. 7-1, с. 335 (сверено). До 11.10.2026 в модели было A = 1 — завышало потери бокового входа до 1,8 раза при F_б/F_с > 0,35. */
export function teeA(fbfc: number, r: number): number {
  if (fbfc <= 0.35) return 1;
  // по таблице на границе r = 0,4 скачок 0,54 → 0,55; берётся max(…), чтобы характеристика была непрерывной (иначе у сети нет точного решения
  // при r ≈ 0,4 — найдено автотестом на 4 постах). Отличие от таблицы — только при 0,389 < r ≤ 0,4 и не более 0,01 (1,8 %) [М]
  return Math.max(0.9 * (1 - r), 0.55);
}
export function teeStraightZeta(qb: number, qc: number): number {
  if (qc <= 0) return 0;
  const r = Math.min(1, Math.max(0, qb / qc));
  return 1.55 * r - r * r;
}
