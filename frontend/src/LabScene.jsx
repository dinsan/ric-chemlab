import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

// Universal-indicator style gradient used in "pH view"
const PH_STOPS = [[0, "#e8202a"], [3, "#f26a21"], [5, "#f4d03f"], [7, "#3fbf5f"], [9, "#2b9bd6"], [11, "#4b4fc4"], [14, "#7a2bb5"]];
export function phColor(ph) {
  for (let i = 1; i < PH_STOPS.length; i++) {
    if (ph <= PH_STOPS[i][0]) {
      const [a, ca] = PH_STOPS[i - 1], [b, cb] = PH_STOPS[i];
      return new THREE.Color(ca).lerp(new THREE.Color(cb), (ph - a) / (b - a));
    }
  }
  return new THREE.Color(PH_STOPS.at(-1)[1]);
}

const VERT = `
attribute vec3 aColor; varying vec3 vColor; uniform float uScale; uniform float uSize;
void main(){ vColor = aColor; vec4 mv = modelViewMatrix * vec4(position,1.0);
  gl_PointSize = uSize * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`;
const FRAG = `
varying vec3 vColor;
void main(){ vec2 p = gl_PointCoord*2.0-1.0; float d = dot(p,p); if(d>1.0) discard;
  vec3 n = vec3(p.x,-p.y,sqrt(1.0-d)); vec3 L = normalize(vec3(.4,.8,.6));
  float diff = max(dot(n,L),0.0)*.55+.45;
  float spec = pow(max(dot(reflect(-L,n),vec3(0,0,1)),0.0),28.0)*.45;
  gl_FragColor = vec4(vColor*diff+spec,1.0); }`;

export default function LabScene({ frameRef, init, viewMode, stir }) {
  const mount = useRef(null);
  const live = useRef({ viewMode, stir, init });
  live.current = { viewMode, stir, init };

  useEffect(() => {
    if (!init) return;
    const el = mount.current;
    const { radius: R, height: H, max_particles: MAXP, spacing } = init;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
    camera.position.set(3.4, 2.3, 3.4);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.8, 0);
    controls.enableDamping = true;
    controls.minDistance = 2; controls.maxDistance = 9;
    controls.maxPolarAngle = Math.PI * 0.52;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x9fb3ad, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(3, 5, 2); scene.add(sun);

    // bench
    const bench = new THREE.Mesh(new THREE.CircleGeometry(4.5, 64), new THREE.MeshStandardMaterial({ color: 0xcfdad5, roughness: 0.9 }));
    bench.rotation.x = -Math.PI / 2; scene.add(bench);
    const grid = new THREE.GridHelper(9, 36, 0x9bb0aa, 0xb7c7c2); grid.position.y = 0.002; scene.add(grid);

    // glass beaker
    const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xdff6ff, transparent: true, opacity: 0.16, roughness: 0.05, side: THREE.DoubleSide, depthWrite: false });
    const gR = R + 0.04;
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(gR, gR, H, 64, 1, true), glassMat);
    glass.position.y = H / 2; glass.renderOrder = 2; scene.add(glass);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(gR, gR, 0.04, 64), new THREE.MeshPhysicalMaterial({ color: 0xcfeaf5, transparent: true, opacity: 0.45, roughness: 0.1 }));
    base.position.y = -0.02; scene.add(base);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(gR, 0.02, 12, 64), new THREE.MeshStandardMaterial({ color: 0xe8f6fb, roughness: 0.2 }));
    rim.rotation.x = Math.PI / 2; rim.position.y = H; scene.add(rim);
    // graduation marks every 0.3 units
    const lineMat = new THREE.LineBasicMaterial({ color: 0x4d6b66 });
    for (let y = 0.3; y < H; y += 0.3) {
      const pts = [];
      for (let a = -0.45; a <= 0.45; a += 0.05) pts.push(new THREE.Vector3(Math.sin(a + 0.8) * (gR + 0.003), y, Math.cos(a + 0.8) * (gR + 0.003)));
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
    }

    // stirring rod
    const rod = new THREE.Group();
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, H * 1.25, 12), new THREE.MeshStandardMaterial({ color: 0x9aa9a5, metalness: 0.6, roughness: 0.3 }));
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.04), stick.material);
    arm.position.y = -H * 0.5 + 0.2;
    rod.add(stick, arm); rod.position.set(0, H * 0.625 + 0.05, 0); scene.add(rod);

    // liquid particles
    const geo = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(new Float32Array(MAXP * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const colAttr = new THREE.BufferAttribute(new Float32Array(MAXP * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("position", posAttr); geo.setAttribute("aColor", colAttr);
    geo.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { uScale: { value: 500 }, uSize: { value: spacing * 1.35 } } });
    const points = new THREE.Points(geo, mat); points.frustumCulled = false; scene.add(points);

    const natural = init.species.map((s) => new THREE.Color(s.color));
    const indicator = init.species.map((s) => phColor(s.ph));

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
      mat.uniforms.uScale.value = (h * renderer.getPixelRatio()) / (2 * Math.tan((camera.fov * Math.PI) / 360));
    };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();

    let seen = -1, raf, last = performance.now();
    const loop = (t) => {
      raf = requestAnimationFrame(loop);
      const dt = (t - last) / 1000; last = t;
      const f = frameRef.current;
      if (f.version !== seen || live.current.lastMode !== live.current.viewMode) {
        seen = f.version; live.current.lastMode = live.current.viewMode;
        const pal = live.current.viewMode === "ph" ? indicator : natural;
        posAttr.array.set(f.pos); posAttr.needsUpdate = true;
        const c = colAttr.array;
        for (let i = 0; i < f.n; i++) { const col = pal[f.sp[i]] || natural[0]; c[3 * i] = col.r; c[3 * i + 1] = col.g; c[3 * i + 2] = col.b; }
        colAttr.needsUpdate = true; geo.setDrawRange(0, f.n);
      }
      rod.rotation.y += live.current.stir * 7 * dt;
      controls.update();
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); renderer.dispose();
      scene.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
      el.removeChild(renderer.domElement);
    };
  }, [init, frameRef]);

  return <div className="scene" ref={mount} />;
}
