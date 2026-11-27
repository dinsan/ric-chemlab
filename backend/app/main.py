"""FastAPI server: streams the live simulation to the browser over a WebSocket."""
import asyncio
import os
import time

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from . import chemistry as chem
from .engine import Lab

app = FastAPI(title="ChemLab")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

FPS = 30


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/species")
def species():
    return {"species": chem.SPECIES, "reactions": chem.REACTIONS}


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    lab = Lab(force_python=os.environ.get("CHEMLAB_PYTHON_ONLY") == "1")
    await ws.send_json(lab.info())

    async def reader():
        try:
            while True:
                lab.handle(await ws.receive_json())
        except WebSocketDisconnect:
            pass

    task = asyncio.create_task(reader())
    frame_no, fps, last = 0, float(FPS), time.perf_counter()
    try:
        while not task.done():
            t0 = time.perf_counter()
            lab.tick()
            await ws.send_bytes(lab.frame())
            frame_no += 1
            if frame_no % 6 == 0:
                now = time.perf_counter()
                fps = 6 / max(now - last, 1e-6); last = now
                await ws.send_json(lab.stats(fps))
            await asyncio.sleep(max(0.0, 1 / FPS - (time.perf_counter() - t0)))
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        task.cancel()
