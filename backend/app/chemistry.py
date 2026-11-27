"""Chemistry data: species, reactions and (simplified) pH maths.

Every particle in the simulation carries a species id. Reactions turn two touching
particles into two new species. This is a teaching model, not a quantum-chemistry engine.
"""
import math

# gravity: buoyancy factor (>1 sinks, <1 floats). viscosity: relative thickness.
SPECIES = [
    dict(id=0, key="water", name="Water", formula="H2O", color="#4aa8ff", ph=7.0, gravity=1.0, viscosity=1.0, addable=True,
         note="Neutral solvent."),
    dict(id=1, key="hcl", name="Hydrochloric acid", formula="HCl", color="#c9e86b", ph=1.0, gravity=1.02, viscosity=1.0, addable=True,
         note="Strong acid. Low pH."),
    dict(id=2, key="naoh", name="Sodium hydroxide", formula="NaOH", color="#c7a0ff", ph=13.0, gravity=1.05, viscosity=1.2, addable=True,
         note="Strong base. High pH."),
    dict(id=3, key="nacl", name="Salt water", formula="NaCl(aq)", color="#7fd6e8", ph=7.0, gravity=1.03, viscosity=1.0, addable=False,
         note="Product of neutralisation."),
    dict(id=4, key="cuso4", name="Copper(II) sulfate", formula="CuSO4", color="#1f5fd1", ph=4.5, gravity=1.08, viscosity=1.0, addable=True,
         note="Deep blue, slightly acidic solution."),
    dict(id=5, key="cuoh2", name="Copper(II) hydroxide", formula="Cu(OH)2", color="#8fd0f5", ph=7.0, gravity=2.2, viscosity=2.5, addable=False,
         note="Pale blue precipitate that sinks."),
    dict(id=6, key="na2so4", name="Sodium sulfate", formula="Na2SO4(aq)", color="#a7e0e8", ph=7.0, gravity=1.04, viscosity=1.0, addable=False,
         note="Clear salt solution."),
    dict(id=7, key="oil", name="Vegetable oil", formula="oil", color="#f0a020", ph=7.0, gravity=0.55, viscosity=3.0, addable=True,
         note="Does not mix; floats on top."),
    dict(id=8, key="cucl2", name="Copper(II) chloride", formula="CuCl2", color="#22a98a", ph=4.0, gravity=1.07, viscosity=1.0, addable=False,
         note="Green-blue solution."),
]
S = {s["key"]: s["id"] for s in SPECIES}
AQUEOUS = {s["id"] for s in SPECIES if s["key"] not in ("oil", "cuoh2")}

# a + b -> ra + rb. prob = chance per touching pair per step. heat = degrees C added per event.
REACTIONS = [
    dict(a=S["hcl"], b=S["naoh"], ra=S["nacl"], rb=S["water"], prob=0.35, heat=0.012,
         equation="HCl + NaOH -> NaCl + H2O", name="Neutralisation (releases heat)"),
    dict(a=S["cuso4"], b=S["naoh"], ra=S["cuoh2"], rb=S["na2so4"], prob=0.30, heat=0.004,
         equation="CuSO4 + 2 NaOH -> Cu(OH)2 + Na2SO4", name="Precipitation (blue solid forms)"),
    dict(a=S["cuoh2"], b=S["hcl"], ra=S["cucl2"], rb=S["water"], prob=0.20, heat=0.003,
         equation="Cu(OH)2 + 2 HCl -> CuCl2 + 2 H2O", name="Precipitate dissolves in acid"),
]


def solution_ph(counts: dict) -> float | None:
    """Mean-field pH of the aqueous particles (concentration-weighted)."""
    by_id = {s["id"]: s for s in SPECIES}
    total = sum(c for sid, c in counts.items() if sid in AQUEOUS)
    if total == 0:
        return None
    h = oh = 0.0
    for sid, c in counts.items():
        if sid not in AQUEOUS:
            continue
        ph = by_id[sid]["ph"]
        h += c * 10 ** (-ph)
        oh += c * 10 ** (ph - 14)
    net = (h - oh) / total
    if abs(net) < 1e-7:
        return 7.0
    return -math.log10(net) if net > 0 else 14 + math.log10(-net)
