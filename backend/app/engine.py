"""Simulation engine: C++ SPH via ctypes, with a slower NumPy fallback."""
import ctypes
import platform
from pathlib import Path

import numpy as np

from . import chemistry as chem

RADIUS = 0.8       # beaker radius (sim units)
HEIGHT = 1.8       # beaker height
H_SMOOTH = 0.16
SPACING = 0.08
MAX_CPP = 6000
MAX_PY = 1500


def _lib_path() -> Path | None:
    name = {"Windows": "fluid.dll", "Darwin": "libfluid.dylib"}.get(platform.system(), "libfluid.so")
    p = Path(__file__).resolve().parents[2] / "cpp" / "build" / name
    return p if p.exists() else None


class CppEngine:
    name = "C++ SPH"

    def __init__(self, lib_path: Path):
        L = ctypes.CDLL(str(lib_path))
        f, i, p = ctypes.c_float, ctypes.c_int, ctypes.c_void_p
        L.fluid_create.restype = p;            L.fluid_create.argtypes = [i, f, f]
        L.fluid_destroy.argtypes = [p]
        L.fluid_clear.argtypes = [p]
        L.fluid_count.restype = i;             L.fluid_count.argtypes = [p]
        L.fluid_add.restype = i;               L.fluid_add.argtypes = [p, i, i, f, f, f, f, f]
        L.fluid_set_species.argtypes = [p, i, f, f]
        L.fluid_clear_reactions.argtypes = [p]
        L.fluid_add_reaction.argtypes = [p, i, i, i, i, f]
        L.fluid_step.restype = i;              L.fluid_step.argtypes = [p, f, f, f]
        L.fluid_positions.restype = ctypes.POINTER(f); L.fluid_positions.argtypes = [p]
        L.fluid_species.restype = ctypes.POINTER(ctypes.c_ubyte); L.fluid_species.argtypes = [p]
        L.fluid_mean_density.restype = f;      L.fluid_mean_density.argtypes = [p]
        L.fluid_rest_density.restype = f;      L.fluid_rest_density.argtypes = [p]
        self.L = L
        self.max_particles = MAX_CPP
        self.h = L.fluid_create(MAX_CPP, RADIUS, HEIGHT)

    def __del__(self):
        try:
            self.L.fluid_destroy(self.h)
        except Exception:
            pass

    @property
    def count(self): return self.L.fluid_count(self.h)
    def clear(self): self.L.fluid_clear(self.h)
    def add(self, sp, n, cx, cy, cz, radius, vy=-0.5): return self.L.fluid_add(self.h, sp, n, cx, cy, cz, radius, vy)
    def set_species(self, i, g, v): self.L.fluid_set_species(self.h, i, g, v)
    def clear_reactions(self): self.L.fluid_clear_reactions(self.h)
    def add_reaction(self, a, b, ra, rb, p): self.L.fluid_add_reaction(self.h, a, b, ra, rb, p)
    def step(self, dt, stir, temp): return self.L.fluid_step(self.h, dt, stir, temp)
    def density_ratio(self): return self.L.fluid_mean_density(self.h) / self.L.fluid_rest_density(self.h)

    def positions(self) -> np.ndarray:
        n = self.count
        return np.ctypeslib.as_array(self.L.fluid_positions(self.h), shape=(3 * n,)).reshape(n, 3).copy() if n else np.zeros((0, 3), np.float32)

    def species(self) -> np.ndarray:
        n = self.count
        return np.ctypeslib.as_array(self.L.fluid_species(self.h), shape=(n,)).copy() if n else np.zeros(0, np.uint8)


class NumpyEngine:
    """Simplified SPH using scipy's KD-tree. Slow but needs no compiler."""
    name = "NumPy SPH (fallback)"
    max_particles = MAX_PY

    def __init__(self):
        from scipy.spatial import cKDTree  # noqa: F401
        self.pos = np.zeros((0, 3), np.float32); self.vel = np.zeros((0, 3), np.float32)
        self.sp = np.zeros(0, np.uint8)
        self.grav = np.ones(16, np.float32); self.visc = np.ones(16, np.float32)
        self.rx = {}
        self.h, self.s = H_SMOOTH, SPACING
        self.rng = np.random.default_rng(1)
        s, h = self.s, self.h
        g = np.arange(-4, 5) * s
        d2 = (g[:, None, None] ** 2 + g[None, :, None] ** 2 + g[None, None, :] ** 2)
        self.rho0 = float(self._poly6(d2).sum())

    def _poly6(self, r2):
        h = self.h
        return np.where(r2 < h * h, 315 / (64 * np.pi * h ** 9) * (h * h - r2) ** 3, 0.0)

    @property
    def count(self): return len(self.pos)
    def clear(self): self.pos = self.pos[:0]; self.vel = self.vel[:0]; self.sp = self.sp[:0]
    def set_species(self, i, g, v): self.grav[i] = g; self.visc[i] = v
    def clear_reactions(self): self.rx = {}
    def add_reaction(self, a, b, ra, rb, p): self.rx[(a, b)] = (ra, rb, p); self.rx[(b, a)] = (rb, ra, p)
    def density_ratio(self): return 1.0

    def add(self, sp, n, cx, cy, cz, radius, vy=-0.5):
        s, new = self.s, []
        m = int(np.ceil(radius / s))
        for layer in range(200):
            for ix in range(-m, m + 1):
                for iz in range(-m, m + 1):
                    if len(new) >= n or self.count + len(new) >= self.max_particles:
                        break
                    x, z = cx + ix * s, cz + iz * s
                    if (ix * s) ** 2 + (iz * s) ** 2 <= radius ** 2 and x * x + z * z < (RADIUS - s) ** 2:
                        new.append((x, cy + layer * s, z))
            if len(new) >= n or self.count + len(new) >= self.max_particles:
                break
        if not new:
            return 0
        a = np.array(new, np.float32)
        a += self.rng.uniform(-0.004, 0.004, a.shape).astype(np.float32)
        v = np.zeros_like(a); v[:, 1] = vy
        self.pos = np.vstack([self.pos, a]); self.vel = np.vstack([self.vel, v])
        self.sp = np.concatenate([self.sp, np.full(len(a), sp, np.uint8)])
        return len(a)

    def step(self, dt, stir, temp):
        from scipy.spatial import cKDTree
        n = self.count
        if n == 0:
            return 0
        h, s = self.h, self.s
        tree = cKDTree(self.pos)
        pairs = tree.query_pairs(h, output_type="ndarray")
        i, j = pairs[:, 0], pairs[:, 1]
        d = self.pos[i] - self.pos[j]
        r = np.maximum(np.linalg.norm(d, axis=1), 1e-6)
        w = self._poly6(r * r)
        rho = np.full(n, float(self._poly6(np.zeros(1))[0])) + np.bincount(i, w, n) + np.bincount(j, w, n)
        prs = np.maximum(0.0, 110.0 * (rho - self.rho0))
        q = h - r
        spiky = 45 / (np.pi * h ** 6) * q * q
        pf = (prs[i] + prs[j]) / 2 * spiky / r / (rho[i] * rho[j])
        f = (pf[:, None] * d)
        acc = np.zeros((n, 3), np.float32)
        np.add.at(acc, i, f / 1.0 * rho[j][:, None] / rho[j][:, None])
        np.add.at(acc, j, -f)
        vis = 9.0 * 45 / (np.pi * h ** 6) * q * 0.5 * (self.visc[self.sp[i]] + self.visc[self.sp[j]]) / np.sqrt(rho[i] * rho[j])
        dv = (self.vel[j] - self.vel[i]) * vis[:, None] / np.sqrt(rho[i] * rho[j])[:, None] * 1.0
        np.add.at(acc, i, dv * 1.0); np.add.at(acc, j, -dv)
        acc[:, 1] -= 4.0 * self.grav[self.sp]
        if stir > 0:
            rr = np.maximum(np.hypot(self.pos[:, 0], self.pos[:, 2]), 0.05)
            k = stir * 9 * np.minimum(rr / RADIUS, 1) / rr
            acc[:, 0] += -self.pos[:, 2] * k; acc[:, 2] += self.pos[:, 0] * k
        events = 0
        if self.rx:
            close = r < 1.25 * s
            used = np.zeros(n, bool)
            tf = np.exp((temp - 25) / 40)
            for a, b in zip(i[close], j[close]):
                key = (int(self.sp[a]), int(self.sp[b]))
                if key in self.rx and not used[a] and not used[b]:
                    ra, rb, p = self.rx[key]
                    if self.rng.random() < p * tf:
                        self.sp[a], self.sp[b] = ra, rb; used[a] = used[b] = True; events += 1
        self.vel += acc * dt
        self.vel *= 0.985  # extra damping keeps the simple explicit scheme stable
        np.clip(self.vel, -4, 4, out=self.vel)
        self.pos += self.vel * dt
        np.minimum(self.pos[:, 1], 3.5, out=self.pos[:, 1])
        pad = 0.5 * s
        rr = np.hypot(self.pos[:, 0], self.pos[:, 2])
        out = rr > RADIUS - pad
        if out.any():
            nx, nz = self.pos[out, 0] / rr[out], self.pos[out, 2] / rr[out]
            self.pos[out, 0] = nx * (RADIUS - pad); self.pos[out, 2] = nz * (RADIUS - pad)
            vn = np.maximum(self.vel[out, 0] * nx + self.vel[out, 2] * nz, 0)
            self.vel[out, 0] -= 1.25 * vn * nx; self.vel[out, 2] -= 1.25 * vn * nz
        low = self.pos[:, 1] < pad
        self.pos[low, 1] = pad
        self.vel[low, 1] = np.maximum(self.vel[low, 1], 0) * 0.25
        return events

    def positions(self): return self.pos
    def species(self): return self.sp


def make_engine(force_python: bool = False):
    lib = None if force_python else _lib_path()
    if lib:
        try:
            return CppEngine(lib)
        except OSError as e:
            print(f"[chemlab] could not load {lib}: {e}; using NumPy fallback")
    else:
        print("[chemlab] C++ library not built (run cpp/build.sh); using NumPy fallback")
    return NumpyEngine()


class Lab:
    """One beaker on the bench: engine + temperature + stirring + stats."""

    SUBSTEPS = 3
    DT = 0.005

    def __init__(self, force_python=False):
        self.eng = make_engine(force_python)
        for s in chem.SPECIES:
            self.eng.set_species(s["id"], s["gravity"], s["viscosity"])
        self.eng.clear_reactions()
        for r in chem.REACTIONS:
            self.eng.add_reaction(r["a"], r["b"], r["ra"], r["rb"], r["prob"])
        self.temp, self.target = 25.0, 25.0
        self.stir = 0.0
        self.paused = False
        self.total_reactions = 0
        self.recent = 0

    def info(self):
        return dict(type="init", engine=self.eng.name, radius=RADIUS, height=HEIGHT, spacing=SPACING,
                    max_particles=self.eng.max_particles, species=chem.SPECIES, reactions=chem.REACTIONS)

    def surface_y(self):
        pos = self.eng.positions()
        return float(np.percentile(pos[:, 1], 97)) if len(pos) else 0.0

    def add(self, species_id: int, amount: int):
        amount = max(1, min(int(amount), 1500))
        if self.eng.count == 0 or amount >= 400:
            radius, y = 0.62, (0.06 if self.eng.count == 0 else self.surface_y() + 0.12)
        else:
            radius, y = 0.22, self.surface_y() + 0.25
        y = min(y, 2.2)
        return self.eng.add(species_id, amount, 0.0, y, 0.0, radius, -0.8)

    def handle(self, msg: dict):
        t = msg.get("type")
        if t == "add":
            self.add(int(msg["species"]), int(msg.get("amount", 300)))
        elif t == "clear":
            self.eng.clear(); self.total_reactions = 0; self.temp = self.target = 25.0
        elif t == "stir":
            self.stir = float(max(0, min(1, msg["value"])))
        elif t == "heat":
            self.target = float(max(5, min(90, msg["value"])))
        elif t == "pause":
            self.paused = bool(msg["value"])

    def tick(self):
        if self.paused:
            return
        ev = 0
        for _ in range(self.SUBSTEPS):
            ev += self.eng.step(self.DT, self.stir, self.temp)
        self.recent = ev
        self.total_reactions += ev
        heat = sum(r["heat"] for r in chem.REACTIONS) / len(chem.REACTIONS)
        self.temp += (self.target - self.temp) * 0.01 + ev * heat
        self.temp = float(max(5, min(95, self.temp)))

    def frame(self) -> bytes:
        pos = np.ascontiguousarray(self.eng.positions(), dtype="<f4")
        sp = np.ascontiguousarray(self.eng.species(), dtype=np.uint8)
        return np.uint32(len(pos)).tobytes() + pos.tobytes() + sp.tobytes()

    def stats(self, fps: float):
        sp = self.eng.species()
        counts = {int(k): int(v) for k, v in zip(*np.unique(sp, return_counts=True))}
        ph = chem.solution_ph(counts)
        return dict(type="stats", particles=int(self.eng.count), counts=counts, ph=ph, temp=round(self.temp, 1),
                    target=self.target, reactions=self.total_reactions, active=self.recent, fps=round(fps, 1),
                    compression=round(float(self.eng.density_ratio()), 3))
