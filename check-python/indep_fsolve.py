# Независимая проверка ядра с поэлементными местными сопротивлениями (другой язык, другой решатель — scipy.optimize.fsolve,
# формулы записаны заново по Идельчику). Сравнение с ядром TS на случайных режимах.
import json, math, sys
import numpy as np
from scipy.optimize import fsolve
rho, nu = 1.2, 15.06e-6
A = lambda d: math.pi*d*d/4
pd = lambda q, d: rho*(q/A(d))**2/2
def lam(w, d, ke=1e-4):
    Re = max(abs(w)*d/nu, 1); T = lambda r: 0.11*(ke/d+68/r)**0.25
    if Re <= 2000: return 64/Re
    if Re >= 4000: return T(Re)
    t = (Re-2000)/2000; return (1-t)*64/2000 + t*T(4000)
ZT = [(0,.2),(10,.52),(20,1.54),(30,4.5),(40,11.0),(50,29.0),(60,105),(70,625),(90,1e4)]  # Идельчик, диагр. 9-17, кривая 2
def zeta(a):
    a = min(max(a, 0), 90)
    for (a0,z0),(a1,z1) in zip(ZT, ZT[1:]):
        if a <= a1: t=(a-a0)/(a1-a0); return math.exp(math.log(z0)+t*(math.log(z1)-math.log(z0)))
TA = [3,4,6,8,10,12,14,16,20,30,45,60,90,120,180]; TR = [.5e5,1e5,2e5,4e5]
TZ = [[.148,.135,.121,.112,.107,.109,.120,.141,.191,.315,.331,.326,.315,.308,.298],[.120,.106,.090,.083,.080,.088,.102,.122,.196,.298,.297,.286,.283,.279,.276],
      [.093,.082,.070,.068,.062,.062,.063,.073,.120,.229,.279,.268,.268,.265,.263],[.079,.068,.056,.048,.048,.048,.051,.051,.068,.120,.271,.272,.272,.268,.268]]
def eloss(e, q, qp, f):
    k = e['kind']
    if k == 'duct': w = q/A(e['d']); return (lam(w, e['d'])*e['l']/e['d'] + e['zeta'])*pd(q, e['d'])
    if k == 'damper': return zeta(e['alpha'])*pd(q, e['d'])
    if k == 'filter': s = e['spec']; return s['dpNom']*(q/s['qNom'])**s['m']*s['fouling']
    if k == 'local': return e['zeta']*pd(q, e['d'])
    if k == 'diffuser':  # Идельчик, диагр. 5-2 (n = 2) + (5-6), (5-7)
        w = q/A(e['d1']); Re = w*e['d1']/nu; n = (e['d2']/e['d1'])**2; a = e.get('alpha', 15); lm = lam(w, e['d1'])
        fr = lambda nn: lm/(8*math.sin(math.radians(a/2)))*(1-1/nn**2)
        z2 = np.interp(math.log(min(max(Re,.5e5),4e5)), np.log(TR), [np.interp(a, TA, row) for row in TZ])
        return (max(0, z2-fr(2))*((1-1/n)/0.5)**1.92 + fr(n))*pd(q, e['d1'])
    if k == 'bend':  # Идельчик, диагр. 6-1: k_Δ·k_Re·A₁·B₁
        w = q/A(e['d']); Re = w*e['d']/nu; lr = lam(w, e['d']); rel = 1e-4/e['d']; rd = e['rd']
        A1 = np.interp(e['delta'], [0,20,30,45,60,75,90,110,130,150,180], [0,.31,.45,.60,.78,.90,1.0,1.13,1.20,1.28,1.40])
        B1 = 0.21*rd**-2.5 if rd <= 1 else 0.21*rd**-0.5
        R = max(Re, 1e4); kRe = 1.3-0.29*math.log(R*1e-5) if rd > .7 else (5.45*R**-0.131 if rd > .55 else 1+4400/R)
        mid = lr*(1.8*math.log10(max(Re,4000))-1.64)**2; hi = 1+min(rel,1e-3)*1e3
        bl = lambda x0,x1,y0,y1: y0+min(1,max(0,math.log(Re/x0)/math.log(x1/x0)))*(y1-y0)
        kD = 1 if Re <= 3.2e4 else bl(3.2e4,5e4,1,mid) if Re < 5e4 else mid if Re <= 1.6e5 else bl(1.6e5,2.5e5,mid,hi) if Re < 2.5e5 else hi
        return kD*kRe*A1*B1*pd(q, e['d'])
    if k == 'teeSide':
        r = q/qp; fb = (e['db']/e['dc'])**2; Ak = 1 if fb <= 0.35 else max(0.9*(1-r), 0.55)  # Идельчик, диагр. 7-1
        return Ak*(1+(r*(e['dc']/e['db'])**2)**2-2*(1-r)**2)*pd(qp, e['dc'])
    if k == 'teeStraight': r = f[e['side']]/qp; return (1.55*r-r*r)*pd(qp, e['dc'])
    raise ValueError(k)
def fanp(fan, Q, n):
    k = n/fan['n0']; q = Q*3600/k; P = fan['points']
    if q <= P[0][0]: p0 = P[0][1]
    elif q >= P[-1][0]: (qa,pa),(qb,pb) = P[-2], P[-1]; p0 = pb+(q-qb)*(pb-pa)/(qb-qa)
    else:
        for (qa,pa),(qb,pb) in zip(P, P[1:]):
            if q <= qb: p0 = pa+(q-qa)*(pb-pa)/(qb-qa); break
    return p0*k*k
def solve(net, guess):
    segs = {s['id']: s for s in net['segments']}; hoods = net['hoods']
    paths = []
    for h in hoods:
        p, s = [], segs[h]
        while s: p.append(s); s = segs.get(s['parent']) if s['parent'] else None
        paths.append(p)
    def flows(q):
        f = {k: 0.0 for k in segs}
        for qi, p in zip(q, paths):
            for s in p: f[s['id']] += qi
        return f
    def res(q):
        f = flows(q); Qt = sum(q)
        pf = fanp(net['fan'], Qt, net['fanSpeed']) - sum(eloss(e, Qt, Qt, f) for e in net['common'])
        return [sum(sum(eloss(e, f[s['id']], f[s['parent']] if s['parent'] else f[s['id']], f) for e in s['elements']) for s in p) - pf for p in paths]
    q = fsolve(res, guess, xtol=1e-12, full_output=False)
    return sum(q), q
cases = json.load(open(sys.argv[1])); worst = 0; wq = 0
for c in cases:
    Qt, q = solve(c['net'], [0.7*c['Q'][h] + 0.01 for h in c['net']['hoods']])   # старт не из решения TS
    worst = max(worst, abs(Qt-c['Qtotal'])*3600); wq = max(wq, max(abs(qi - c['Q'][h])*3600 for qi, h in zip(q, c['net']['hoods'])))
print(f'случаев: {len(cases)}; макс. расхождение: общий расход {worst:.5f} м³/ч, расход поста {wq:.5f} м³/ч')
