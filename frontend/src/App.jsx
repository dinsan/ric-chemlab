import { useEffect, useRef, useState } from "react";
import LabScene, { phColor } from "./LabScene.jsx";
import { useLab } from "./useLab.js";

const AMOUNTS = [{ label: "Drop", n: 80 }, { label: "Beaker", n: 500 }, { label: "Flood", n: 1200 }];
const PRESETS = [
  { name: "Neutralise", desc: "Water · HCl · NaOH", pours: [["water", 500], ["hcl", 300], ["naoh", 300]] },
  { name: "Precipitate", desc: "CuSO₄ · NaOH", pours: [["cuso4", 400], ["naoh", 400]] },
  { name: "Oil & water", desc: "Immiscible layers", pours: [["water", 600], ["oil", 300]] },
];

export default function App() {
  const { frameRef, init, stats, status, send } = useLab();
  const [amount, setAmount] = useState(500);
  const [stir, setStir] = useState(0);
  const [heat, setHeat] = useState(25);
  const [view, setView] = useState("natural");
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [elapsed, setElapsed] = useState(0);
  const [log, setLog] = useState([]);
  const sceneRef = useRef(null);

  useEffect(() => {
    if (paused) return undefined;
    const timer = setInterval(() => setElapsed((v) => v + 1), 1000);
    return () => clearInterval(timer);
  }, [paused]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.target?.tagName === "INPUT") return;
      if (event.code === "Space") {
        event.preventDefault();
        setPaused((value) => { send({ type: "pause", value: !value }); return !value; });
      }
      if (event.key.toLowerCase() === "p") setView((value) => value === "ph" ? "natural" : "ph");
      if (event.key.toLowerCase() === "c") send({ type: "clear" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [send]);

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
  const phLabel = ph == null ? "No aqueous reading" : ph < 6.5 ? "Acidic" : ph > 7.5 ? "Alkaline" : "Neutral";
  const formatTime = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  const addSpecies = (species, amount, label) => {
    send({ type: "add", species, amount });
    setLog((items) => [{ text: `Added ${label || species} (${amount})`, time: formatTime(elapsed) }, ...items].slice(0, 8));
  };
  const runPreset = (preset) => {
    const ids = Object.fromEntries(init.species.map((s) => [s.key, s.id]));
    preset.pours.forEach(([key, amount], i) => setTimeout(() => {
      const species = init.species.find((s) => s.key === key);
      if (species) addSpecies(ids[key], amount, species.name);
    }, i * 220));
  };
  const undo = () => {
    send({ type: "undo" });
    setLog((items) => [{ text: "Undid last pour", time: formatTime(elapsed) }, ...items].slice(0, 8));
  };
  const exportExperiment = () => {
    const data = { elapsed, temperature: stats?.temp, ph, particles: total, reactions: stats?.reactions, log };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "chemlab-experiment.json"; link.click(); URL.revokeObjectURL(url);
  };
  const screenshot = () => {
    const canvas = document.querySelector(".scene canvas");
    if (!canvas) return;
    const link = document.createElement("a"); link.download = "chemlab-snapshot.png"; link.href = canvas.toDataURL("image/png"); link.click();
  };

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
              <button key={s.id} className="reagent" onClick={() => addSpecies(s.id, amount, s.name)} title={s.note}>
                <i style={{ background: s.color }} />
                <span><b>{s.name}</b><small>{s.formula}</small></span>
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2>Experiment presets</h2>
          <div className="presets">
            {PRESETS.map((preset) => <button key={preset.name} onClick={() => runPreset(preset)}><b>{preset.name}</b><small>{preset.desc}</small></button>)}
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
          <label>Simulation speed <output>{speed}×</output>
            <input type="range" min="0.25" max="3" step="0.25" value={speed} onChange={(e) => { const v = +e.target.value; setSpeed(v); send({ type: "speed", value: v }); }} />
          </label>
          <div className="row">
            <button onClick={() => { setPaused(!paused); send({ type: "pause", value: !paused }); }}>{paused ? "Resume" : "Pause"}</button>
            <button onClick={() => setView(view === "ph" ? "natural" : "ph")}>{view === "ph" ? "Real colours" : "pH view"}</button>
            <button onClick={undo}>Undo pour</button>
            <button onClick={screenshot}>Snapshot</button>
            <button onClick={exportExperiment}>Export</button>
            <button onClick={() => document.documentElement.requestFullscreen?.()}>Fullscreen</button>
            <button className="danger" onClick={() => { send({ type: "clear" }); setHeat(25); setElapsed(0); setLog([]); }}>Empty beaker</button>
          </div>
        </section>

        <section>
          <h2>Readings</h2>
          <div className="readings">
            <div><small>pH · {phLabel}</small><strong style={{ color: phCss }}>{ph == null ? "–" : ph.toFixed(1)}</strong></div>
            <div><small>Temperature</small><strong>{stats ? stats.temp.toFixed(1) : "–"} °C</strong></div>
            <div><small>Particles</small><strong>{total}</strong></div>
            <div><small>Reactions</small><strong>{stats?.reactions ?? 0}</strong></div>
            <div><small>Density</small><strong>{stats?.compression ?? "–"}</strong></div>
            <div><small>Performance</small><strong>{stats?.fps ?? "–"} fps</strong></div>
          </div>
          <div className="experiment-meta"><span>Experiment time <b>{formatTime(elapsed)}</b></span><span>{paused ? "Paused" : "Running"} · {speed}×</span></div>
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
          {log.length > 0 && <><h3>Activity</h3><ul className="activity">{log.map((item, i) => <li key={`${item.time}-${i}`}><time>{item.time}</time><span>{item.text}</span></li>)}</ul></>}
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
