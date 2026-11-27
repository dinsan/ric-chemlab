import { useState } from "react";
import LabScene, { phColor } from "./LabScene.jsx";
import { useLab } from "./useLab.js";

const AMOUNTS = [{ label: "Drop", n: 80 }, { label: "Beaker", n: 500 }, { label: "Flood", n: 1200 }];

export default function App() {
  const { frameRef, init, stats, status, send } = useLab();
  const [amount, setAmount] = useState(500);
  const [stir, setStir] = useState(0);
  const [heat, setHeat] = useState(25);
  const [view, setView] = useState("natural");
  const [paused, setPaused] = useState(false);

  if (!init) {
    return (
      <div className="boot">
        <h1>ChemLab 3D</h1>
        <p>{status === "offline" ? "Can’t reach the simulation server. Start the backend with ./run_backend.sh" : "Connecting to the simulation server…"}</p>
      </div>
    );
  }

  const total = stats?.particles || 0;
  const ph = stats?.ph;
  const phCss = ph == null ? "#999" : "#" + phColor(ph).getHexString();

  return (
    <div className="app">
      <LabScene frameRef={frameRef} init={init} viewMode={view} stir={stir} />

      <header className="title">
        <h1>ChemLab 3D</h1>
        <span className="engine">{init.engine}</span>
      </header>

      <aside className="panel">
        <section>
          <h2>Pour into the beaker</h2>
          <div className="seg">
            {AMOUNTS.map((a) => (
              <button key={a.n} className={amount === a.n ? "on" : ""} onClick={() => setAmount(a.n)}>{a.label}</button>
            ))}
          </div>
          <div className="reagents">
            {init.species.filter((s) => s.addable).map((s) => (
              <button key={s.id} className="reagent" onClick={() => send({ type: "add", species: s.id, amount })} title={s.note}>
                <i style={{ background: s.color }} />
                <span><b>{s.name}</b><small>{s.formula}</small></span>
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2>Bench controls</h2>
          <label>Stirring <output>{Math.round(stir * 100)}%</output>
            <input type="range" min="0" max="1" step="0.05" value={stir} onChange={(e) => { const v = +e.target.value; setStir(v); send({ type: "stir", value: v }); }} />
          </label>
          <label>Hot plate <output>{heat} °C</output>
            <input type="range" min="10" max="80" step="1" value={heat} onChange={(e) => { const v = +e.target.value; setHeat(v); send({ type: "heat", value: v }); }} />
          </label>
          <div className="row">
            <button onClick={() => { setPaused(!paused); send({ type: "pause", value: !paused }); }}>{paused ? "Resume" : "Pause"}</button>
            <button onClick={() => setView(view === "ph" ? "natural" : "ph")}>{view === "ph" ? "Show real colours" : "Show pH indicator"}</button>
            <button className="danger" onClick={() => { send({ type: "clear" }); setHeat(25); }}>Empty beaker</button>
          </div>
        </section>

        <section>
          <h2>Readings</h2>
          <div className="readings">
            <div><small>pH</small><strong style={{ color: phCss }}>{ph == null ? "–" : ph.toFixed(1)}</strong></div>
            <div><small>Temperature</small><strong>{stats ? stats.temp.toFixed(1) : "–"} °C</strong></div>
            <div><small>Particles</small><strong>{total}</strong></div>
            <div><small>Reactions</small><strong>{stats?.reactions ?? 0}</strong></div>
          </div>
          {total === 0 ? (
            <p className="hint">The beaker is empty. Pour some water first, then add reagents.</p>
          ) : (
            <ul className="mix">
              {init.species.filter((s) => stats?.counts?.[s.id]).map((s) => (
                <li key={s.id}>
                  <i style={{ background: s.color }} />
                  <span>{s.name}</span>
                  <em>{Math.round((100 * stats.counts[s.id]) / total)}%</em>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2>Reactions to try</h2>
          <ul className="rx">
            {init.reactions.map((r, i) => (<li key={i}><b>{r.name}</b><code>{r.equation}</code></li>))}
          </ul>
          <p className="hint">Drag to orbit, scroll to zoom. Heating speeds up reactions and thins the liquid.</p>
        </section>
      </aside>
    </div>
  );
}
