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
ZT = [(0,.2),(5,.24),(10,.52),(15,.9),(20,1.54),(25,2.51),(30,3.91),(35,6.22),(40,10.8),(45,18.7),(50,32.6),(55,58.8),(60,118),(65,256),(70,751),(90,1e4)]
def zeta(a):
    a = min(max(a, 0), 90)
    for (a0,z0),(a1,z1) in zip(ZT, ZT[1:]):
        if a <= a1: t=(a-a0)/(a1-a0); return math.exp(math.log(z0)+t*(math.log(z1)-math.log(z0)))
def eloss(e, q, qp, f):
    k = e['kind']
    if k == 'duct': w = q/A(e['d']); return (lam(w, e['d'])*e['l']/e['d'] + e['zeta'])*pd(q, e['d'])
    if k == 'damper': return zeta(e['alpha'])*pd(q, e['d'])
    if k == 'filter': s = e['spec']; return s['dpNom']*(q/s['qNom'])**s['m']*s['fouling']
    if k == 'local': return e['zeta']*pd(q, e['d'])
    if k == 'diffuser':
        n = (1-(e['d1']/e['d2'])**2)**2; return min(n, 3.2*math.tan(math.radians(7.5))**1.25*n)*pd(q, e['d1'])
    if k == 'teeSide': r = q/qp; return (1+(r*(e['dc']/e['db'])**2)**2-2*(1-r)**2)*pd(qp, e['dc'])
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
