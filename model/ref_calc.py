# Эталонный расчёт блока «вещества -> воздухообмен» (для сверки с Excel)
def calc(B, n, g, eta, pdk, qin, groups):
    G = {s: g[s]*1000*B*n for s in g}                 # мг/ч
    Gr = {s: (1-eta)*G[s] for s in g}                 # в помещение
    L = {s: Gr[s]/(pdk[s]-qin[s]) for s in g}         # м3/ч
    sums = {}
    for s, gr in groups.items(): sums[gr] = sums.get(gr, 0)+L[s]
    return G, Gr, L, max(sums.values())

# Диплом: 4 поста, флюс ФЦ-12, B=6,808 кг/ч, eta=0,75
g={'Fe':0.06,'Mn':0.03,'HF':0.02}; pdk={'Fe':6,'Mn':0.2,'HF':0.1}; qin={'Fe':0.04,'Mn':0.001,'HF':0.01}
print('ДИПЛОМ без захвата Mn:', round(817/0.199,1), '(в дипломе 4300)')
for name,gr in [('max (каждое отдельно)',{'Fe':1,'Mn':2,'HF':3}),('Fe+HF однонаправл. (как в дипломе)',{'Fe':1,'Mn':2,'HF':1})]:
    G,Gr,L,Lt=calc(6.808,4,g,0.75,pdk,qin,gr)
    print(name, {k:round(v,1) for k,v in G.items()}, {k:round(v,1) for k,v in L.items()}, 'итог', round(Lt,1))
# MIG/MAG CO2, Св-08Г2С, 1 пост, B=3 кг/ч (условно)
g2={'Fe':7.67,'Mn':1.90}; pdk2={'Fe':6,'Mn':0.2}; qin2={'Fe':0.04,'Mn':0.001}
for eta in (0.6,0.75,0.9):
    G,Gr,L,Lt=calc(3.0,1,g2,eta,pdk2,qin2,{'Fe':1,'Mn':2})
    print('MAG eta',eta,{k:round(v,1) for k,v in L.items()},'общеобм',round(Lt,1),'+ местный 1500 =',round(Lt+1500,1))
print('Доля Mn в аэрозоле: флюс ФЦ-12', round(0.03/0.09*100,1),'%, Св-08Г2С', round(1.9/10*100,1),'%')
