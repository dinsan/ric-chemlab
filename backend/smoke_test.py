import sys, time
sys.path.insert(0, ".")
import numpy as np
from app.engine import Lab, make_engine
from app import chemistry as chem

def run(force_python):
    lab = Lab(force_python=force_python)
    print("engine:", lab.eng.name, "rest density", getattr(lab.eng, 'rho0', None))
    lab.handle({"type":"add","species":0,"amount":1500})
    t=time.time()
    for k in range(120): lab.tick()
    print(" 120 ticks", round(time.time()-t,2),"s ; n=",lab.eng.count)
    p=lab.eng.positions()
    print(" y range", p[:,1].min().round(3), p[:,1].max().round(3), "mean",p[:,1].mean().round(3), "finite",np.isfinite(p).all(), "ratio", lab.eng.density_ratio())
    # acid + base
    lab.handle({"type":"add","species":1,"amount":150}); lab.handle({"type":"add","species":2,"amount":150})
    lab.handle({"type":"stir","value":0.8})
    for k in range(200): lab.tick()
    st=lab.stats(30); print(" stats", st)
    return lab
run(False)
run(True)
