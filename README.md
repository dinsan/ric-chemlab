# ChemLab 3D

A browser-based chemistry lab. Pour liquids into a glass beaker, stir, heat, and watch them
flow and react in 3D.

```
 React + three.js  <--WebSocket-->  Python (FastAPI)  --ctypes-->  C++ SPH fluid core
   3D beaker, UI        live frames      chemistry, pH, heat           particle physics + reactions
```

| Folder | Language | Job |
|---|---|---|
| `cpp/` | C++17 | Smoothed-particle hydrodynamics (SPH): density, pressure, viscosity, gravity, beaker collisions, and per-particle chemical reactions. Exposed as a C API in `fluid.h`. |
| `backend/` | Python | FastAPI server. Loads the C++ library with `ctypes` (NumPy fallback if not built), holds the species/reaction data, computes pH and temperature, streams frames at 30 fps. |
| `frontend/` | React + three.js | Controls panel and the 3D scene (glass beaker, stirring rod, liquid drawn as shaded spheres). |

## Run it

Needs Python 3.10+, Node 18+, and (recommended) `g++`.

```bash
# terminal 1
./run_backend.sh        # builds C++ core, creates venv, starts http://localhost:8000

# terminal 2
./run_frontend.sh       # starts http://localhost:5173
```

Open http://localhost:5173. Pour **Water**, then add **HCl** and **NaOH** and turn on **Show pH indicator**.

Windows: run the commands inside the scripts by hand (`g++ ... -o cpp/build/fluid.dll`, or `cmake` in `cpp/`).

## Things to try

- Water + HCl + NaOH: neutralisation, pH moves towards 7, the mixture warms up.
- Copper sulfate + NaOH: blue Cu(OH)2 precipitate forms and sinks. Add HCl and it dissolves into green CuCl2.
- Oil on water: oil does not mix and floats.
- Stir and heat: heat speeds reactions up and thins the liquid.

## How it works

- **Physics** (`cpp/src/fluid.cpp`): each particle is a small packet of liquid. A uniform grid finds neighbours; poly6 density, spiky pressure and viscosity kernels give the forces. Species change gravity (buoyancy) and viscosity, which is why precipitate sinks and oil floats.
- **Reactions**: a table of `A + B -> C + D`. When two particles of A and B touch, they turn into C and D with a probability that grows with temperature.
- **pH**: concentration-weighted average of the particles' H+/OH- contribution. This is a teaching approximation, not a full equilibrium solver.

## Add your own chemicals

Edit `backend/app/chemistry.py`: append a species to `SPECIES` (id, colour, pH, gravity, viscosity, `addable`) and a rule to `REACTIONS`. The UI picks it up automatically (up to 16 species).

## Check the backend without the browser

```bash
cd backend && python3 smoke_test.py
```

## Ideas for next steps

- Real thermodynamics (reaction enthalpies, concentrations in mol/L), gas bubbles for CO2.
- Surface tension and a proper liquid surface mesh (marching cubes) instead of spheres.
- More vessels (flask, test tubes), pouring by tilting, save/load experiments, multi-user rooms.
- OpenMP or GPU compute for 50k+ particles.
