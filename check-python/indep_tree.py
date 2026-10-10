# Независимая проверка ядра (аудит 3): другой метод — рекурсивный поиск разрежений в узлах дерева (brentq),
# своя реализация всех формул: Альтшуль, Дарси–Вейсбах, ζ заслонки (лог-интерполяция), фильтр Δp·(Q/Qн)^m·k,
# законы подобия вентилятора, КПД двигателя (IE3) и ЧП (DOE Tip Sheet 11).
import json, math, sys
from scipy.optimize import brentq
rho, nu = 1.2, 15.06e-6
A = lambda d: math.pi*d*d/4
def lam(w, d, ke=1e-4):
    Re = max(abs(w)*d/nu, 1)
    return 64/Re if Re < 2300 else 0.11*(ke/d + 68/Re)**0.25
def dloss(Q, d, l, z):
    w = Q/A(d); return (lam(w, d)*l/d + z)*rho*w*w/2
ZT = [(0,.2),(5,.24),(10,.52),(15,.9),(20,1.54),(25,2.51),(30,3.91),(35,6.22),(40,10.8),(45,18.7),(50,32.6),(55,58.8),(60,118),(65,256),(70,751),(90,1e4)]
def zeta(a, tb=ZT):
    a = min(max(a, tb[0][0]), tb[-1][0])
    for (a0,z0),(a1,z1) in zip(tb, tb[1:]):
        if a <= a1:
            t = (a-a0)/(a1-a0); return math.exp(math.log(z0)+t*(math.log(z1)-math.log(z0)))
def eloss(e, Q):
    k = e['kind']
    if k == 'duct': return dloss(Q, e['d'], e['l'], e['zeta'])
    if k == 'damper': return dloss(Q, e['d'], 0, zeta(e['alpha'], e.get('table') or ZT))
    s = e['spec']; return s['dpNom']*(Q/s['qNom'])**s['m']*s['fouling']
def fanp(fan, Q, n):
    k = n/fan['n0']; q = Q*3600/k; P = fan['points']
    if q <= P[0][0]: p0 = P[0][1]
    elif q >= P[-1][0]: (qa,pa),(qb,pb) = P[-2], P[-1]; p0 = pb+(q-qb)*(pb-pa)/(qb-qa)
    else:
        for (qa,pa),(qb,pb) in zip(P, P[1:]):
            if q <= qb: p0 = pa+(q-qa)*(pb-pa)/(qb-qa); break
    return p0*k*k
VFD = [(0.016,.35),(0.125,.80),(0.25,.88),(0.42,.91),(0.5,.92),(0.75,.94),(1.0,.95)]
def motor(beta, en, k=0.5):  # разделение потерь: ΣP = P_пост + P_пер·β², P_пост/P_пер = k
    ln = 1/en - 1; return beta/(beta + ln*(k+beta*beta)/(1+k))
def tab(t, x):
    if x <= t[0][0]: return t[0][1]
    for (x0,y0),(x1,y1) in zip(t, t[1:]):
        if x <= x1: return y0+(x-x0)*(y1-y0)/(x1-x0)
    return t[-1][1]
import numpy as np
PG = np.concatenate([[0.0], np.logspace(-4, math.log10(6000), 4000)])   # сетка разрежений, Па
def solve(net):
    # метод сложения характеристик: для каждого поддерева строится кривая Q(p_вых) снизу вверх;
    # параллельные ветви складываются по расходу при общем давлении, последовательные участки — по давлению
    segs = {s['id']: s for s in net['segments']}
    kids = {i: [s['id'] for s in net['segments'] if s['parent'] == i] for i in segs}
    root = [s['id'] for s in net['segments'] if s['parent'] is None][0]
    def L(sid, Q): return sum(eloss(e, Q) for e in segs[sid]['elements'])
    memo = {}
    def char(sid):                   # возвращает функцию Q(p_end)
        if sid in memo: return memo[sid]
        if not kids[sid]:
            Qg = np.concatenate([[0.0], np.logspace(-6, 1.3, 4000)])
            pg = np.array([L(sid, q) for q in Qg])
        else:
            cs = [char(c) for c in kids[sid]]
            Qg = np.array([sum(f(p) for f in cs) for p in PG])   # при давлении узла p
            pg = PG + np.array([L(sid, q) for q in Qg])
        f = lambda p, pg=pg, Qg=Qg: float(np.interp(p, pg, Qg))
        memo[sid] = f; return f
    fr = char(root)
    resid = lambda pr: fanp(net['fan'], fr(pr), net['fanSpeed']) - sum(eloss(e, fr(pr)) for e in net['common']) - pr
    pr = brentq(resid, 1e-6, 5000, xtol=1e-10)
    Qt = fr(pr); pf = fanp(net['fan'], Qt, net['fanSpeed'])
    P = max(0, Qt*pf)/net['fan']['eta']; f = net['fan']
    Pel = P/(motor(P/f['motorW'], f['motorEta'])*tab(VFD, P/f['motorW'])) if P > 0 else 0
    return Qt, pf, P, Pel
cases = json.load(open(sys.argv[1])); worst = [0, 0, 0, 0]
for c in cases:
    Qt, pf, P, Pel = solve(c['net'])
    d = [abs(Qt-c['Qtotal'])*3600, abs(pf-c['pFan']), abs(P-c['power']), abs(Pel-c['powerEl'])]
    worst = [max(a, b) for a, b in zip(worst, d)]
rels=[]
print(f'случаев: {len(cases)}; макс. расхождение: Q {worst[0]:.4f} м³/ч, p {worst[1]:.4f} Па, N_вал {worst[2]:.4f} Вт, N_эл {worst[3]:.4f} Вт')
