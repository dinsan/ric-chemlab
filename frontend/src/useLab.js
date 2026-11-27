import { useCallback, useEffect, useRef, useState } from "react";

// Connects to the Python backend. Binary frames go to frameRef (read by the 3D scene every
// animation frame, so React never re-renders per particle); JSON messages go to React state.
export function useLab() {
  const frameRef = useRef({ n: 0, pos: new Float32Array(0), sp: new Uint8Array(0), version: 0 });
  const wsRef = useRef(null);
  const [init, setInit] = useState(null);
  const [stats, setStats] = useState(null);
  const [status, setStatus] = useState("connecting");

  useEffect(() => {
    let closed = false, retry;
    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;
      ws.onopen = () => setStatus("live");
      ws.onclose = () => {
        setStatus("offline");
        if (!closed) retry = setTimeout(connect, 1500);
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data === "string") {
          const m = JSON.parse(ev.data);
          if (m.type === "init") setInit(m);
          else if (m.type === "stats") setStats(m);
          return;
        }
        const n = new DataView(ev.data).getUint32(0, true);
        const f = frameRef.current;
        f.n = n;
        f.pos = new Float32Array(ev.data, 4, n * 3);
        f.sp = new Uint8Array(ev.data, 4 + n * 12, n);
        f.version++;
      };
    };
    connect();
    return () => { closed = true; clearTimeout(retry); wsRef.current?.close(); };
  }, []);

  const send = useCallback((msg) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
  }, []);

  return { frameRef, init, stats, status, send };
}
