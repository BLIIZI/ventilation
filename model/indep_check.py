# Независимая реализация сети (другой метод: scipy.optimize.fsolve по давлению в узлах дерева)
import math
from scipy.optimize import brentq
rho, nu = 1.2, 15.06e-6
A = lambda d: math.pi*d*d/4
def lam(w,d,ke=1e-4):
    Re=max(abs(w)*d/nu,1); return 0.11*(ke/d+68/Re)**0.25
def dloss(Q,d,l,z):
    w=Q/A(d); return (lam(w,d)*l/d+z)*rho*w*w/2
ZT=[(0,.2),(5,.24),(10,.52),(15,.9),(20,1.54),(25,2.51),(30,3.91),(35,6.22),(40,10.8),(45,18.7),(50,32.6),(55,58.8),(60,118),(65,256),(70,751),(90,1e4)]
def zeta(a):
    for (a0,z0),(a1,z1) in zip(ZT,ZT[1:]):
        if a<=a1: t=(a-a0)/(a1-a0); return math.exp(math.log(z0)+t*(math.log(z1)-math.log(z0)))
FP=[(0,1400),(2000,1300),(4000,1050),(5000,850),(6000,550),(7000,150)]
def fanp(Q,n):
    k=n/1500; q=Q*3600/k
    if q>=FP[-1][0]: (qa,pa),(qb,pb)=FP[-2],FP[-1]; return (pb+(q-qb)*(pb-pa)/(qb-qa))*k*k
    for (qa,pa),(qb,pb) in zip(FP,FP[1:]):
        if q<=qb: return (pa+(q-qa)*(pb-pa)/(qb-qa))*k*k
def branchQ(dp, alpha):  # расход ветви поста при заданном разрежении на её конце (в коллекторе)
    f=lambda Q: dloss(Q,0.2,6,1.5)+dloss(Q,0.2,0,zeta(alpha))-dp
    return brentq(f,1e-9,5) if dp>0 else 0
def network(alphas, n):
    # неизвестное — разрежение в корне p3 (перед общим трактом); дерево: post1->c1->c2->c3, post2->c2, post3->c3
    def solve_from_root(p3):
        # узел после c3 (вход в c3) — искомые давления в узлах коллектора находим "сверху вниз" через вложенные brentq
        def flows_given_p2(p2):
            def flows_given_p1(p1):
                q1=branchQ(p1,alphas[0]); return q1
            # c1: p2 - dloss_c1(q1) = p1 → находим p1
            g=lambda p1: p2-dloss(branchQ(p1,alphas[0]),0.25,5,0.2)-p1
            p1=brentq(g,1e-6,p2) if p2>1e-6 else 0
            q1=branchQ(p1,alphas[0]); q2=branchQ(p2,alphas[1]); return q1,q2
        g2=lambda p2: p3-dloss(sum(flows_given_p2(p2)),0.315,5,0.2)-p2
        p2=brentq(g2,1e-6,p3)
        q1,q2=flows_given_p2(p2); q3=branchQ(p3,alphas[2])
        return q1,q2,q3
    def resid(p3):
        q=solve_from_root(p3); Qt=sum(q)
        common=400*(Qt/(4500/3600))**2+dloss(Qt,0.4,5,1.0)+dloss(Qt,0.4,10,0.5)
        return fanp(Qt,n)-common-p3  # p3 здесь — разрежение перед участком main
    # main (c3 seg) входит в common выше, поэтому p3 — давление на входе участка main
    p3=brentq(resid,1,3000); q=solve_from_root(p3); Qt=sum(q)
    pf=fanp(Qt,n); return [x*3600 for x in q], Qt*3600, pf, Qt*pf/0.65
for a,label in [((0,0,0),'всё открыто 1500'),((0,0,90),'пост3 закрыт'),((40,0,0),'пост1 40°')]:
    q,Qt,pf,P=network(a,1500); print(label, [round(x) for x in q], round(Qt), round(pf), round(P/1000,3),'кВт')
q,Qt,pf,P=network((0,9.0,13.0),1429); print('регул. 3 поста (углы из TS)',[round(x) for x in q],round(Qt),round(P/1000,3))
q,Qt,pf,P=network((0,9.0,90),1088); print('регул. 2 поста',[round(x) for x in q],round(Qt),round(P/1000,3))
q,Qt,pf,P=network((0,90,90),798); print('регул. 1 пост',[round(x) for x in q],round(Qt),round(P/1000,3))
# тепло смены без регулирования
print('тепло без регулирования, кВт·ч:', round(1.2*((4778+8600)/3600)*20.2*8,1))
