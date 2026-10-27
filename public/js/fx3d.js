// Three.js visuals: flowing silk + gold dust behind the hero, and interactive mirror-work discs.
// Three is lazy-loaded (import map in index.html) so it never blocks first paint, and every scene
// degrades silently (no WebGL / reduced motion / off-screen) to the plain CSS design underneath.

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');
const COARSE = matchMedia('(pointer: coarse)');
let threePromise;
const loadThree = () => (threePromise ||= import('three'));

function webglOK() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}

// Shared lifecycle: sizes the renderer to its host, only animates while visible, and cleans up on route leave.
function createStage(THREE, host, { maxDpr = 1.75, onFrame, alpha = true }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha, powerPreference: 'high-performance' });
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  host.appendChild(canvas);
  const state = { w: 1, h: 1, visible: true, running: false, raf: 0, t0: performance.now(), dead: false };
  const resize = () => {
    const r = host.getBoundingClientRect();
    state.w = Math.max(1, Math.round(r.width)); state.h = Math.max(1, Math.round(r.height));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, COARSE.matches ? Math.min(maxDpr, 1.5) : maxDpr));
    renderer.setSize(state.w, state.h, false);
    onFrame.resize?.(state.w, state.h);
    draw();
  };
  const draw = () => { if (!state.dead) onFrame((performance.now() - state.t0) / 1000, state); };
  const loop = () => { state.raf = 0; if (!state.running) return; draw(); state.raf = requestAnimationFrame(loop); };
  const sync = () => {
    const want = state.visible && !document.hidden && !REDUCED.matches && !state.dead;
    if (want && !state.running) { state.running = true; state.raf = requestAnimationFrame(loop); }
    if (!want && state.running) { state.running = false; cancelAnimationFrame(state.raf); }
  };
  const ro = new ResizeObserver(resize); ro.observe(host);
  const io = new IntersectionObserver(([e]) => { state.visible = e.isIntersecting; sync(); }, { rootMargin: '100px' }); io.observe(host);
  document.addEventListener('visibilitychange', sync); REDUCED.addEventListener('change', sync);
  resize(); sync();
  requestAnimationFrame(() => canvas.classList.add('on'));
  const onLost = e => { e.preventDefault(); state.running = false; cancelAnimationFrame(state.raf); canvas.remove(); };
  canvas.addEventListener('webglcontextlost', onLost);
  return {
    renderer, state, draw,
    destroy() {
      state.dead = true; state.running = false; cancelAnimationFrame(state.raf);
      ro.disconnect(); io.disconnect(); document.removeEventListener('visibilitychange', sync); REDUCED.removeEventListener('change', sync);
      renderer.dispose(); renderer.forceContextLoss?.(); canvas.remove();
    }
  };
}

// Smoothed pointer in [-1,1] relative to a host element (works for mouse, pen and touch drags).
function trackPointer(host, target = window) {
  const p = { x: 0, y: 0, sx: 0, sy: 0, active: false, vx: 0, vy: 0, px: 0, py: 0, cx: -9, cy: -9 };
  const move = e => {
    const r = host.getBoundingClientRect(); if (!r.width) return;
    const x = ((e.clientX - r.left) / r.width) * 2 - 1, y = -(((e.clientY - r.top) / r.height) * 2 - 1);
    p.x = Math.max(-1.4, Math.min(1.4, x)); p.y = Math.max(-1.4, Math.min(1.4, y)); p.cx = x; p.cy = y;
    p.active = Math.abs(x) <= 1 && Math.abs(y) <= 1;
  };
  const leave = () => { p.active = false; p.cx = p.cy = -9; };
  target.addEventListener('pointermove', move, { passive: true });
  document.addEventListener('pointerleave', leave);
  return {
    p,
    step(k = 0.08) {
      const nx = p.sx + (p.x - p.sx) * k, ny = p.sy + (p.y - p.sy) * k;
      p.vx = nx - p.sx; p.vy = ny - p.sy; p.sx = nx; p.sy = ny; return p;
    },
    destroy() { target.removeEventListener('pointermove', move); document.removeEventListener('pointerleave', leave); }
  };
}

/* ------------------------------------------------------------------ hero silk */
const SILK_VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const SILK_FRAG = `
precision highp float;
varying vec2 vUv;
uniform float uTime; uniform vec2 uRes; uniform vec2 uMouse; uniform float uEnergy; uniform float uScroll;
const vec3 IVORY = vec3(0.992,0.976,0.957);
const vec3 BLUSH = vec3(0.973,0.914,0.933);
const vec3 ROSE  = vec3(0.788,0.541,0.627);
const vec3 GOLD  = vec3(0.847,0.718,0.451);
const vec3 SAND  = vec3(0.945,0.902,0.839);

float height(vec2 p, float t){
  float h = 0.0;
  h += sin(p.x*1.7 + t*0.35 + sin(p.y*1.3 - t*0.22)*1.6) * 0.55;
  h += sin(p.y*2.3 - t*0.28 + sin(p.x*1.1 + t*0.18)*1.9) * 0.35;
  h += sin((p.x+p.y)*3.1 + t*0.45) * 0.14;
  float d = distance(p, uMouse);
  h += exp(-d*d*3.2) * uEnergy * sin(d*9.0 - t*3.2) * 0.22;
  return h;
}
void main(){
  float asp = uRes.x / uRes.y;
  vec2 p = (vUv - 0.5) * vec2(asp, 1.0) * 2.4 + vec2(uScroll * 0.25, uScroll * 0.7);
  vec2 m = (uMouse);
  float t = uTime;
  float e = 0.012;
  float h  = height(p, t);
  float hx = height(p + vec2(e,0.0), t) - h;
  float hy = height(p + vec2(0.0,e), t) - h;
  vec3 n = normalize(vec3(-hx/e*0.22, -hy/e*0.22, 1.0));
  vec3 L = normalize(vec3(-0.45, 0.55, 0.7));
  vec3 V = vec3(0.0,0.0,1.0);
  float diff = clamp(dot(n, L), 0.0, 1.0);
  // anisotropic satin sheen: highlight stretched along the fold direction
  vec3 H = normalize(L + V);
  float spec = pow(clamp(dot(n, H), 0.0, 1.0), 38.0);
  float sheen = pow(1.0 - clamp(dot(n, V), 0.0, 1.0), 1.6);
  float tone = smoothstep(-0.9, 0.9, h);
  vec3 base = mix(IVORY, BLUSH, tone * 0.9);
  base = mix(base, SAND, smoothstep(0.55, 1.1, vUv.y + vUv.x*0.35 - h*0.12) * 0.55);
  base = mix(base, ROSE, sheen * 0.34);
  vec3 col = base * (0.80 + diff * 0.28);
  col += GOLD * spec * 0.55;
  // soft vignette keeps edges calm so copy stays legible
  float v = smoothstep(1.25, 0.25, length((vUv - 0.5) * vec2(1.0, 1.15)));
  col = mix(col, IVORY, (1.0 - v) * 0.5);
  gl_FragColor = vec4(col, 1.0);
}`;

const DUST_VERT = `
attribute float aSeed; attribute float aSize;
uniform float uTime; uniform vec2 uMouse; uniform float uPx; uniform float uAsp;
varying float vTw;
void main(){
  float t = uTime * (0.03 + aSeed*0.05);
  vec2 p = position.xy;
  p.y = mod(p.y + t + 1.0, 2.2) - 1.1;
  p.x += sin(uTime*0.4 + aSeed*20.0) * 0.04;
  vec2 d = p - uMouse * vec2(uAsp, 1.0) * 0.5;
  float f = exp(-dot(d,d)*6.0);
  p += normalize(d + 1e-4) * f * 0.12;
  vTw = 0.45 + 0.55*sin(uTime*(1.2+aSeed*2.0) + aSeed*40.0);
  gl_Position = vec4(p.x / uAsp, p.y, 0.0, 1.0);
  gl_PointSize = aSize * uPx * (0.7 + vTw*0.5 + f*0.9);
}`;
const DUST_FRAG = `
precision mediump float; varying float vTw;
void main(){
  vec2 c = gl_PointCoord - 0.5; float r = length(c);
  float core = smoothstep(0.5, 0.0, r);
  float star = max(smoothstep(0.06, 0.0, abs(c.x)), smoothstep(0.06, 0.0, abs(c.y))) * smoothstep(0.5,0.1,r);
  float a = (core*core*0.7 + star*0.55) * vTw;
  gl_FragColor = vec4(vec3(0.80,0.62,0.30), a);
}`;

export async function mountSilk(host, hero, onLeave) {
  if (!host || !webglOK()) return;
  const THREE = await loadThree();
  if (!host.isConnected) return;
  const small = innerWidth < 720;
  const uniforms = {
    uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uMouse: { value: new THREE.Vector2(0, 0) }, uEnergy: { value: 0 }, uScroll: { value: 0 }
  };
  const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ vertexShader: SILK_VERT, fragmentShader: SILK_FRAG, uniforms, depthTest: false, depthWrite: false }));
  quad.frustumCulled = false; scene.add(quad);

  const N = small ? 34 : 80, pos = new Float32Array(N * 3), seed = new Float32Array(N), size = new Float32Array(N);
  for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() * 2 - 1) * 2.4; pos[i * 3 + 1] = Math.random() * 2.2 - 1.1; seed[i] = Math.random(); size[i] = 5 + Math.random() * 11; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1)); g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const du = { uTime: uniforms.uTime, uMouse: { value: new THREE.Vector2() }, uPx: { value: 1 }, uAsp: { value: 1 } };
  const dust = new THREE.Points(g, new THREE.ShaderMaterial({ vertexShader: DUST_VERT, fragmentShader: DUST_FRAG, uniforms: du, transparent: true, depthTest: false, depthWrite: false }));
  dust.frustumCulled = false; scene.add(dust);

  const ptr = trackPointer(hero);
  let stage, energy = 0;
  const frame = (t) => {
    if (!stage) return;
    const p = ptr.step(0.06);
    energy += ((p.active ? Math.min(1, Math.hypot(p.vx, p.vy) * 55) : 0) - energy) * 0.08;
    uniforms.uTime.value = REDUCED.matches ? 6 : t;
    uniforms.uEnergy.value = energy;
    const asp = uniforms.uRes.value.x / uniforms.uRes.value.y;
    const sc = Math.min(scrollY / innerHeight, 2) * (REDUCED.matches ? 0 : 1);
    uniforms.uScroll.value += (sc - uniforms.uScroll.value) * 0.08;
    uniforms.uMouse.value.set(p.sx * asp * 1.2 + uniforms.uScroll.value * 0.25, p.sy * 1.2 + uniforms.uScroll.value * 0.7);
    du.uMouse.value.set(p.sx, p.sy); du.uAsp.value = asp; du.uPx.value = stage.renderer.getPixelRatio();
    // tilt the arch collage in 3D with the pointer (CSS vars read in app.css)
    hero.style.setProperty('--mx', p.sx.toFixed(3)); hero.style.setProperty('--my', p.sy.toFixed(3));
    stage.renderer.render(scene, cam);
  };
  frame.resize = (w, h) => uniforms.uRes.value.set(w, h);
  stage = createStage(THREE, host, { maxDpr: small ? 1.25 : 1.5, onFrame: frame, alpha: false });
  frame(0);
  onLeave(() => { ptr.destroy(); stage.destroy(); g.dispose(); dust.material.dispose(); quad.geometry.dispose(); quad.material.dispose(); });
}

/* ------------------------------------------------------------------ mirror work */
export async function mountMirrors(host, onLeave) {
  if (!host || !webglOK()) return;
  const THREE = await loadThree();
  const { RoomEnvironment } = await import('./vendor/RoomEnvironment.js');
  if (!host.isConnected) return;
  const small = innerWidth < 720;
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 60); cam.position.set(0, 0, 15);
  let stage, r, pm, envTex;
  const key = new THREE.PointLight(0xffe2b0, 90, 40, 2); key.position.set(4, 5, 8); scene.add(key);
  const rim = new THREE.PointLight(0xd77ea5, 70, 40, 2); rim.position.set(-6, -3, 5); scene.add(rim);

  const mirrorMat = new THREE.MeshStandardMaterial({ color: 0xf2eaf0, metalness: 1, roughness: 0.1, envMapIntensity: 0.8 });
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xc9a05a, metalness: 1, roughness: 0.28, envMapIntensity: 1.1 });
  const threadMat = new THREE.MeshStandardMaterial({ color: 0x8e2f5a, metalness: 0.1, roughness: 0.7 });
  const discGeo = new THREE.CylinderGeometry(1, 1, 0.14, small ? 40 : 64); discGeo.rotateX(Math.PI / 2);
  const rimGeo = new THREE.TorusGeometry(1.04, 0.1, 14, small ? 40 : 72);
  const stitchGeo = new THREE.TorusGeometry(1.17, 0.035, 8, small ? 40 : 72);

  const root = new THREE.Group(); scene.add(root);
  const items = [], discs = [];
  const COUNT = small ? 9 : 14;
  // phyllotaxis layout: reads as a scattered embroidery cluster, never a grid
  for (let i = 0; i < COUNT; i++) {
    const a = i * 2.399963, rad = 0.95 * Math.sqrt(i + 0.6) * 1.18, s = 0.5 + ((i * 37) % 10) / 10 * 0.62;
    const g = new THREE.Group(); g.position.set(Math.cos(a) * rad * 1.25, Math.sin(a) * rad * 0.95, -((i * 13) % 5) * 0.35);
    const disc = new THREE.Mesh(discGeo, mirrorMat), ring = new THREE.Mesh(rimGeo, goldMat), st = new THREE.Mesh(stitchGeo, threadMat);
    g.add(disc, ring, st); g.scale.setScalar(s); root.add(g); disc.userData.i = items.length; discs.push(disc);
    items.push({ g, s, ph: Math.random() * 6.28, sp: 0.5 + Math.random() * 0.7, hover: 0, spin: 0, tx: 0, ty: 0 });
  }

  const ray = new THREE.Raycaster(), v2 = new THREE.Vector2(9, 9);
  const ptr = trackPointer(host);
  let hoverIdx = -1, scroll = 0, introT = 0;
  const born = performance.now();
  host.classList.add('is-3d');
  function frame(t) {
    if (!r) return;
    const p = ptr.step(0.07);
    const time = REDUCED.matches ? 0 : t;
    introT = REDUCED.matches ? 1 : Math.min(1, (performance.now() - born) / 1400);
    const ease = 1 - Math.pow(1 - introT, 3);
    const rect = host.getBoundingClientRect(), vh = innerHeight;
    scroll = THREE.MathUtils.clamp(1 - (rect.top + rect.height / 2) / vh, -0.5, 1.5);
    root.rotation.y = p.sx * 0.28; root.rotation.x = -p.sy * 0.2 + scroll * 0.08;
    root.scale.setScalar(ease);
    // hover pick
    hoverIdx = -1;
    if (p.cx > -2) { v2.set(p.cx, p.cy); ray.setFromCamera(v2, cam); const hit = ray.intersectObjects(discs, false)[0]; if (hit) hoverIdx = hit.object.userData.i; }
    host.style.cursor = hoverIdx >= 0 ? 'pointer' : '';
    items.forEach((it, i) => {
      const hv = hoverIdx === i ? 1 : 0;
      it.hover += (hv - it.hover) * 0.12; it.spin += (hv * 0.09 - it.spin * 0.05);
      const bob = Math.sin(time * it.sp + it.ph);
      it.g.position.z += ((-((i * 13) % 5) * 0.35 + it.hover * 1.4) - it.g.position.z) * 0.1;
      it.g.scale.setScalar(it.s * (1 + it.hover * 0.22));
      it.tx += (p.sy * -0.5 + Math.sin(time * 0.6 * it.sp + it.ph) * 0.35 - it.tx) * 0.07;
      it.ty += (p.sx * 0.6 + Math.cos(time * 0.5 * it.sp + it.ph) * 0.4 + it.spin * 6 - it.ty) * 0.07;
      it.g.rotation.set(it.tx, it.ty, bob * 0.12);
      it.g.position.y += (Math.sin(time * 0.7 * it.sp + it.ph) * 0.0035);
    });
    key.position.x = 4 + p.sx * 4; key.position.y = 5 + p.sy * 3;
    r.render(scene, cam);
  }
  frame.resize = (w, h) => {
    cam.aspect = w / h; cam.position.z = w / h < 0.9 ? 22 : w / h < 1.05 ? 19.5 : w / h < 1.3 ? 17 : 16.5; cam.updateProjectionMatrix();
  };
  stage = createStage(THREE, host, { maxDpr: 1.75, onFrame: frame });
  r = stage.renderer;
  r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.9; r.outputColorSpace = THREE.SRGBColorSpace;
  pm = new THREE.PMREMGenerator(r);
  envTex = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environment = envTex;
  frame.resize(stage.state.w, stage.state.h); frame(0);

  onLeave(() => {
    ptr.destroy(); stage.destroy(); envTex.dispose(); pm.dispose();
    [discGeo, rimGeo, stitchGeo, mirrorMat, goldMat, threadMat].forEach(o => o.dispose());
  });
}

/* ------------------------------------------------------------------ golden-hour gallery */
const GAL_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex0; uniform sampler2D uTex1;
uniform float uProg, uTime, uHover, uAsp, uImgAsp; uniform vec2 uMouse;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
void main(){
  // cover-fit the photo into the frame
  vec2 uv = vUv - 0.5;
  if (uAsp > uImgAsp) uv.y *= uImgAsp / uAsp; else uv.x *= uAsp / uImgAsp;
  uv += 0.5;
  // gentle parallax + cursor ripple
  vec2 d = vUv - uMouse; float r = length(d * vec2(uAsp, 1.0));
  uv += (uMouse - 0.5) * -0.012;
  uv += normalize(d + 1e-5) * sin(r * 30.0 - uTime * 3.5) * exp(-r * 4.5) * uHover * 0.011;
  // liquid wipe between the two photos
  float n = noise(vUv * 3.2 + uTime * 0.05);
  float edge = uProg * 1.45 - (vUv.y * 0.72 + n * 0.28);
  float m = smoothstep(0.0, 0.32, edge);
  float bend = sin(clamp(m, 0.0, 1.0) * 3.14159) * 0.035;
  vec4 a = texture2D(uTex0, uv + vec2(bend, 0.0));
  vec4 b = texture2D(uTex1, uv - vec2(bend, 0.0));
  gl_FragColor = mix(a, b, m);
  #include <colorspace_fragment>
}`;

export async function mountGallery(root, onLeave) {
  const host = root.querySelector('.gal-stage'), imgs = [...host.querySelectorAll('img')];
  const dots = [...root.querySelectorAll('[data-gal]')], caps = [...root.querySelectorAll('.gal-cap')];
  let idx = 0, last = 0, stage = null, timer = 0, prog = 1, texs = null, U = null;
  const show = i => {
    const from = idx; idx = i;
    imgs.forEach((im, k) => im.classList.toggle('on', k === i));
    dots.forEach((d, k) => d.setAttribute('aria-current', String(k === i)));
    caps.forEach((c, k) => c.classList.toggle('on', k === i));
    if (U && from !== i) { U.uTex0.value = texs[from]; U.uTex1.value = texs[i]; prog = REDUCED.matches ? 1 : 0; if (stage && REDUCED.matches) stage.draw(); }
  };
  const next = () => show((idx + 1) % imgs.length);
  const restart = () => { clearInterval(timer); if (!REDUCED.matches) timer = setInterval(() => { if (!document.hidden && host.dataset.vis !== '0') next(); }, 5800); };
  const onDot = e => { const b = e.target.closest('[data-gal]'); if (b) { show(+b.dataset.gal); restart(); } };
  const onTap = () => { next(); restart(); };
  root.addEventListener('click', onDot); host.addEventListener('click', onTap);
  show(0); restart();
  onLeave(() => { clearInterval(timer); root.removeEventListener('click', onDot); host.removeEventListener('click', onTap); });
  if (!webglOK()) return;

  const THREE = await loadThree();
  if (!host.isConnected) return;
  const loader = new THREE.TextureLoader();
  const loaded = await Promise.all(imgs.map(im => new Promise((res, rej) => loader.load(im.currentSrc || im.src, t => { t.colorSpace = THREE.SRGBColorSpace; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; res(t); }, undefined, rej)))).catch(() => null);
  if (!loaded || !host.isConnected) return;
  texs = loaded;
  U = { uTex0: { value: texs[idx] }, uTex1: { value: texs[idx] }, uProg: { value: 1 }, uTime: { value: 0 }, uHover: { value: 0 }, uAsp: { value: 0.75 }, uImgAsp: { value: texs[0].image.width / texs[0].image.height }, uMouse: { value: new THREE.Vector2(0.5, 0.5) } };
  const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mat = new THREE.ShaderMaterial({ vertexShader: SILK_VERT, fragmentShader: GAL_FRAG, uniforms: U, depthTest: false });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); quad.frustumCulled = false; scene.add(quad);
  const ptr = trackPointer(host);
  let hov = 0;
  const frame = t => {
    if (!stage) return;
    const p = ptr.step(0.12), dt = Math.min(0.1, t - last || 0.016); last = t;
    prog = Math.min(1, prog + dt / 1.5);
    hov += ((p.active ? 1 : 0) - hov) * 0.08;
    U.uProg.value = prog; U.uTime.value = t; U.uHover.value = hov;
    U.uMouse.value.set(p.cx * 0.5 + 0.5, p.cy * 0.5 + 0.5);
    stage.renderer.render(scene, cam);
  };
  frame.resize = (w, h) => { U.uAsp.value = w / h; };
  stage = createStage(THREE, host, { maxDpr: 1.5, onFrame: frame, alpha: false });
  frame(0); host.classList.add('ready');
  const io = new IntersectionObserver(([e]) => { host.dataset.vis = e.isIntersecting ? '1' : '0'; }); io.observe(host);
  onLeave(() => { io.disconnect(); ptr.destroy(); stage.destroy(); texs.forEach(t => t.dispose()); quad.geometry.dispose(); mat.dispose(); });
}

/* ------------------------------------------------------------------ 3D lehenga designer */
// Cloth texture drawn on a canvas: base colour + block-print motif + gold gota border at the hem.
function clothTexture(THREE, base, print) {
  const W = 1024, H = 512, BORDER = 78, body = H - BORDER;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const col = new THREE.Color(base), hex = k => '#' + k.getHexString();
  const dark = hex(col.clone().multiplyScalar(0.5)), light = hex(col.clone().lerp(new THREE.Color('#ffffff'), 0.62));
  g.fillStyle = hex(col); g.fillRect(0, 0, W, H);
  const tone = g.createLinearGradient(0, 0, 0, H);
  tone.addColorStop(0, 'rgba(0,0,0,.16)'); tone.addColorStop(.55, 'rgba(0,0,0,0)'); tone.addColorStop(1, 'rgba(255,255,255,.06)');
  g.fillStyle = tone; g.fillRect(0, 0, W, H);
  g.save(); g.beginPath(); g.rect(0, 0, W, body); g.clip();
  if (print === 'ajrakh') {
    const s = 64;
    for (let y = -s; y < body + s; y += s / 2) for (let x = -s; x < W + s; x += s) {
      const cx = x + ((Math.round(y / (s / 2)) % 2) ? s / 2 : 0);
      g.strokeStyle = dark; g.lineWidth = 3; g.beginPath(); g.moveTo(cx, y - 24); g.lineTo(cx + 24, y); g.lineTo(cx, y + 24); g.lineTo(cx - 24, y); g.closePath(); g.stroke();
      g.fillStyle = dark; g.beginPath(); g.moveTo(cx, y - 9); g.lineTo(cx + 9, y); g.lineTo(cx, y + 9); g.lineTo(cx - 9, y); g.closePath(); g.fill();
      g.fillStyle = light; [[-24, 0], [24, 0], [0, -24], [0, 24]].forEach(([dx, dy]) => { g.beginPath(); g.arc(cx + dx, y + dy, 2.2, 0, 7); g.fill(); });
    }
  } else if (print === 'bandhani') {
    const s = 30;
    for (let y = 8; y < body; y += s) for (let x = 8; x < W; x += s) {
      const o = (Math.round(y / s) % 2) ? s / 2 : 0, cx = x + o;
      g.fillStyle = light;
      [[0, 0], [-6, -6], [6, -6], [-6, 6], [6, 6]].forEach(([dx, dy]) => { g.beginPath(); g.arc(cx + dx, y + dy, 2.1, 0, 7); g.fill(); });
    }
  } else if (print === 'mirror') {
    const s = 92;
    for (let y = 30; y < body + s; y += s * 0.8) for (let x = 0; x < W + s; x += s) {
      const cx = x + ((Math.round(y / (s * 0.8)) % 2) ? s / 2 : 0);
      const rg = g.createRadialGradient(cx - 4, y - 4, 2, cx, y, 15); rg.addColorStop(0, '#ffffff'); rg.addColorStop(.6, '#bfc3cc'); rg.addColorStop(1, '#7d8290');
      g.fillStyle = rg; g.beginPath(); g.arc(cx, y, 15, 0, 7); g.fill();
      g.strokeStyle = '#d9b56a'; g.lineWidth = 3; g.beginPath(); g.arc(cx, y, 17.5, 0, 7); g.stroke();
      g.fillStyle = light; for (let k = 0; k < 12; k++) { const a = k / 12 * 6.2832; g.beginPath(); g.arc(cx + Math.cos(a) * 25, y + Math.sin(a) * 25, 1.9, 0, 7); g.fill(); }
      g.fillStyle = dark; g.beginPath(); g.arc(cx + s / 2, y + s * 0.4, 3, 0, 7); g.fill();
    }
  } else {
    g.fillStyle = '#d9b56a'; [body - 46, body - 36, body - 26].forEach(y => g.fillRect(0, y, W, 3));
  }
  g.restore();
  g.fillStyle = 'rgba(0,0,0,.16)'; g.fillRect(0, 0, 3, H); g.fillRect(W / 2 - 1, 0, 3, H); g.fillRect(W - 3, 0, 3, H);
  const gold = g.createLinearGradient(0, body, 0, H); gold.addColorStop(0, '#f1d99a'); gold.addColorStop(.5, '#b8914a'); gold.addColorStop(1, '#e6c47e');
  g.fillStyle = gold; g.fillRect(0, body, W, BORDER);
  g.strokeStyle = 'rgba(70,40,10,.55)'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, body + 9); g.lineTo(W, body + 9); g.moveTo(0, H - 9); g.lineTo(W, H - 9); g.stroke();
  g.beginPath(); for (let x = 0; x <= W; x += 16) { const y = body + BORDER / 2 + (x / 16 % 2 ? 9 : -9); x ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = THREE.RepeatWrapping; tex.repeat.set(3, 1); tex.anisotropy = 8;
  return tex;
}

export async function mountDesigner(root, onLeave) {
  const host = root.querySelector('.dz-stage');
  if (!host || !webglOK()) return false;
  const THREE = await loadThree();
  const { RoomEnvironment } = await import('./vendor/RoomEnvironment.js');
  if (!host.isConnected) return false;

  const pick = sel => { const b = root.querySelector(sel + '[aria-pressed="true"]') || root.querySelector(sel); return b; };
  const sel = { skirt: pick('[data-skirt]'), choli: pick('[data-choli]'), print: pick('[data-print]') };
  const twirlInput = root.querySelector('[data-twirl]'), spinBtn = root.querySelector('[data-spin]'), summary = root.querySelector('[data-summary]');

  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 60);
  const SU = 144, SV = 44, SH = 2.7, R0 = 0.52;
  const vCount = (SU + 1) * (SV + 1);
  const pos = new Float32Array(vCount * 3), uv = new Float32Array(vCount * 2), idx = [];
  for (let j = 0; j <= SV; j++) for (let i = 0; i <= SU; i++) {
    const k = j * (SU + 1) + i; uv[k * 2] = i / SU; uv[k * 2 + 1] = 1 - j / SV;
    if (i < SU && j < SV) { const a = k, b = k + 1, c = k + SU + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);

  const clothMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0, sheen: 0.35, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xd9b8a0), envMapIntensity: 0.38, side: THREE.DoubleSide });
  const skirt = new THREE.Mesh(geo, clothMat);
  const choliMat = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(sel.choli.dataset.choli), roughness: 0.7, sheen: 0.3, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xd9b8a0), envMapIntensity: 0.4 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xe6d6c4, roughness: 0.7 });
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xc9a04f, metalness: 1, roughness: 0.3 });
  const torso = new THREE.Mesh(new THREE.LatheGeometry([[0.5, 0], [0.47, 0.16], [0.51, 0.4], [0.5, 0.52], [0.42, 0.7], [0.3, 0.8], [0.13, 0.84]].map(([x, y]) => new THREE.Vector2(x, y)), 48), choliMat);
  const neck = new THREE.Group();
  const neckPost = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.32, 24), skinMat); neckPost.position.y = 0.98;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 32, 24), skinMat); head.scale.set(0.9, 1.25, 1); head.position.y = 1.32;
  neck.add(neckPost, head);
  neck.geometry = { dispose() { neckPost.geometry.dispose(); head.geometry.dispose(); } };
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.505, 0.022, 10, 64), goldMat); band.rotation.x = Math.PI / 2; band.position.y = 0.01;
  const rootG = new THREE.Group(), spinG = new THREE.Group();
  spinG.add(skirt, torso, neck, band); rootG.add(spinG); scene.add(rootG); rootG.position.y = 0.72;

  // soft contact shadow under the hem
  const sc = document.createElement('canvas'); sc.width = sc.height = 128; const sg = sc.getContext('2d');
  const rg = sg.createRadialGradient(64, 64, 6, 64, 64, 64); rg.addColorStop(0, 'rgba(20,0,20,.5)'); rg.addColorStop(1, 'rgba(20,0,20,0)'); sg.fillStyle = rg; sg.fillRect(0, 0, 128, 128);
  const shadowTex = new THREE.CanvasTexture(sc);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = -SH - 0.01; rootG.add(shadow);

  const key = new THREE.PointLight(0xffe2b0, 80, 40, 2); key.position.set(4, 5, 7); scene.add(key);
  const rim = new THREE.PointLight(0xd77ea5, 55, 40, 2); rim.position.set(-6, 1, -4); scene.add(rim);

  let flare = 0, flareT = (+twirlInput.value || 0) / 100, auto = spinBtn ? spinBtn.getAttribute('aria-pressed') !== 'false' : true;
  let spin = 0.6, dragV = 0, dragging = false, lastX = 0, lastY = 0, lastT = 0, stage, tex = null;

  function shape(t) {
    const R = 1.5 + flare * 0.62, amp0 = 0.034 + 0.1 * flare;
    for (let j = 0; j <= SV; j++) {
      const v = j / SV, prof = Math.pow(v, 0.8), r0 = R0 + (R - R0) * prof, amp = amp0 * Math.pow(v, 1.15);
      const y = -SH * v + flare * 0.45 * v * v, ph = t * flare * 3.4 + v * flare * 2.4;
      for (let i = 0; i <= SU; i++) {
        const th = i / SU * 6.283185, k = (j * (SU + 1) + i) * 3;
        const r = r0 + amp * Math.sin(th * 18 + ph) + flare * 0.05 * v * Math.sin(th * 3 - t * 2.6);
        pos[k] = Math.cos(th) * r; pos[k + 1] = y; pos[k + 2] = Math.sin(th) * r;
      }
    }
    geo.attributes.position.needsUpdate = true; geo.computeVertexNormals();
    const n = geo.attributes.normal; // make the wrap-around seam seamless
    for (let j = 0; j <= SV; j++) {
      const a = j * (SU + 1), b = a + SU;
      const x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b), l = Math.hypot(x, y, z) || 1;
      n.setXYZ(a, x / l, y / l, z / l); n.setXYZ(b, x / l, y / l, z / l);
    }
    n.needsUpdate = true;
    shadow.scale.setScalar((R + 0.35) * 1.9);
  }

  const label = b => b.dataset.name || b.getAttribute('aria-label') || '';
  function applyLook() {
    if (tex) tex.dispose();
    tex = clothTexture(THREE, sel.skirt.dataset.skirt, sel.print.dataset.print);
    clothMat.map = tex; clothMat.needsUpdate = true;
    choliMat.color.set(sel.choli.dataset.choli);
    const text = `${label(sel.skirt)} skirt · ${label(sel.choli)} choli · ${label(sel.print)} print`;
    if (summary) summary.textContent = text;
    root.dispatchEvent(new CustomEvent('design', { detail: { summary: text } }));
    if (REDUCED.matches && stage) stage.draw();
  }

  let last = performance.now();
  function frame(t) {
    if (!stage) return;
    const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
    flare += (flareT - flare) * (1 - Math.exp(-dt * 5));
    if (!REDUCED.matches) {
      if (!dragging) { spin += dragV; dragV *= 0.94; if (auto) spin += dt * (0.45 + flare * 3.2); }
      shape(t);
    } else if (!shape.done) { shape(0); shape.done = true; }
    spinG.rotation.y = spin; spinG.rotation.x = 0;
    rim.position.x = -6 + Math.sin(t * 0.3) * 1.5;
    stage.renderer.render(scene, cam);
  }
  frame.resize = (w, h) => {
    cam.aspect = w / h; const need = 2.2 + flareT * 0.55;
    const zh = (SH + 1.15) / 2 / Math.tan(THREE.MathUtils.degToRad(15)), zw = need / Math.tan(THREE.MathUtils.degToRad(15)) / cam.aspect;
    cam.position.set(0, 0.7, Math.max(zh, zw) + 1); cam.lookAt(0, -0.2, 0); cam.updateProjectionMatrix();
  };

  stage = createStage(THREE, host, { maxDpr: 1.75, onFrame: frame });
  const r = stage.renderer; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.82; r.outputColorSpace = THREE.SRGBColorSpace;
  const pm = new THREE.PMREMGenerator(r), envTex = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environment = envTex;
  key.intensity = 45; rim.intensity = 30;
  frame.resize(stage.state.w, stage.state.h); shape(0); applyLook(); frame(0);

  // ---- controls
  const group = (attr, setter) => root.addEventListener('click', e => {
    const b = e.target.closest(`[${attr}]`); if (!b) return;
    root.querySelectorAll(`[${attr}]`).forEach(o => o.setAttribute('aria-pressed', String(o === b)));
    setter(b); applyLook();
  });
  group('data-skirt', b => { sel.skirt = b; }); group('data-choli', b => { sel.choli = b; }); group('data-print', b => { sel.print = b; });
  const onTwirl = () => { flareT = +twirlInput.value / 100; frame.resize(stage.state.w, stage.state.h); if (REDUCED.matches) { flare = flareT; shape.done = false; stage.draw(); } };
  twirlInput.addEventListener('input', onTwirl);
  const onSpin = () => { auto = !auto; spinBtn.setAttribute('aria-pressed', String(auto)); };
  spinBtn?.addEventListener('click', onSpin);

  // drag to rotate (horizontal only so the page still scrolls vertically on touch)
  const down = e => { dragging = true; lastX = e.clientX; lastY = e.clientY; dragV = 0; host.setPointerCapture?.(e.pointerId); host.classList.add('drag'); };
  const move = e => { if (!dragging) return; const dx = e.clientX - lastX; lastX = e.clientX; lastY = e.clientY; spin += dx * 0.012; dragV = dx * 0.012; if (REDUCED.matches) stage.draw(); };
  const up = () => { dragging = false; host.classList.remove('drag'); };
  host.addEventListener('pointerdown', down); host.addEventListener('pointermove', move); host.addEventListener('pointerup', up); host.addEventListener('pointercancel', up);
  const key_ = e => { if (e.key === 'ArrowLeft') { spin -= 0.25; e.preventDefault(); } else if (e.key === 'ArrowRight') { spin += 0.25; e.preventDefault(); } else return; if (REDUCED.matches) stage.draw(); };
  host.addEventListener('keydown', key_);

  onLeave(() => {
    twirlInput.removeEventListener('input', onTwirl); spinBtn?.removeEventListener('click', onSpin);
    host.removeEventListener('pointerdown', down); host.removeEventListener('pointermove', move); host.removeEventListener('pointerup', up); host.removeEventListener('pointercancel', up); host.removeEventListener('keydown', key_);
    stage.destroy(); envTex.dispose(); pm.dispose(); tex?.dispose(); shadowTex.dispose();
    [geo, clothMat, choliMat, skinMat, goldMat, torso.geometry, neck.geometry, band.geometry, shadow.geometry, shadow.material].forEach(o => o.dispose());
  });
  return true;
}

/* ------------------------------------------------------------------ scroll + card motion */
let motionOn = false;
export function initMotion() {
  if (motionOn || REDUCED.matches) return; motionOn = true;
  // marquee speeds up (and reverses) with scroll velocity
  let lastY = scrollY, vel = 0, rate = 1, dir = 1, raf = 0;
  const tick = () => {
    const y = scrollY; vel += ((y - lastY) - vel) * 0.2; lastY = y;
    if (vel > 0.6) dir = 1; else if (vel < -0.6) dir = -1;
    const target = 1 + Math.min(Math.abs(vel) * 0.18, 6); rate += (target - rate) * 0.1;
    document.querySelectorAll('.marquee .track').forEach(t => t.getAnimations().forEach(a => { a.playbackRate = rate * dir; }));
    raf = (Math.abs(vel) > 0.05 || rate > 1.02) ? requestAnimationFrame(tick) : 0;
  };
  addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(tick); }, { passive: true });
  // gentle 3D tilt on product cards
  if (matchMedia('(hover: hover)').matches) {
    let cur = null;
    const reset = () => { if (cur) { cur.style.removeProperty('--tx'); cur.style.removeProperty('--ty'); cur = null; } };
    addEventListener('pointermove', e => {
      const m = e.target.closest?.('.card-media');
      if (cur && cur !== m) reset();
      if (!m) return; cur = m; const r = m.getBoundingClientRect();
      m.style.setProperty('--tx', (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(3)); m.style.setProperty('--ty', (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(3));
    }, { passive: true });
    document.addEventListener('pointerleave', reset);
  }
}

/* ------------------------------------------------------------------ cursor + magnetic buttons */
let cursorOn = false;
export function initCursor() {
  if (cursorOn || COARSE.matches || REDUCED.matches || !matchMedia('(hover: hover)').matches) return;
  cursorOn = true;
  const dot = Object.assign(document.createElement('div'), { className: 'cur-dot' });
  const ring = Object.assign(document.createElement('div'), { className: 'cur-ring' });
  dot.setAttribute('aria-hidden', 'true'); ring.setAttribute('aria-hidden', 'true');
  document.body.append(ring, dot);
  let x = -100, y = -100, rx = x, ry = y, raf = 0, shown = false;
  const loop = () => { rx += (x - rx) * 0.18; ry += (y - ry) * 0.18; ring.style.transform = `translate3d(${rx}px,${ry}px,0) translate(-50%,-50%)`; raf = Math.abs(x - rx) + Math.abs(y - ry) > 0.1 ? requestAnimationFrame(loop) : 0; };
  addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') return;
    x = e.clientX; y = e.clientY; dot.style.transform = `translate3d(${x}px,${y}px,0) translate(-50%,-50%)`;
    if (!shown) { shown = true; document.documentElement.classList.add('has-cursor'); rx = x; ry = y; }
    if (!raf) raf = requestAnimationFrame(loop);
    const hot = e.target.closest?.('a,button,[data-action],input,select,textarea,summary,.is-3d');
    ring.classList.toggle('hot', !!hot);
  }, { passive: true });
  document.addEventListener('pointerleave', () => { shown = false; document.documentElement.classList.remove('has-cursor'); });
  document.addEventListener('pointerdown', () => ring.classList.add('down'));
  document.addEventListener('pointerup', () => ring.classList.remove('down'));

  // magnetic pull on primary calls to action
  const MAG = '.hero-cta .btn, .cta-band .btn, .mirror .btn, .twin-band .btn';
  let cur = null;
  addEventListener('pointermove', e => {
    const b = e.target.closest?.(MAG);
    if (cur && cur !== b) { cur.style.translate = ''; cur = null; }
    if (!b) return;
    cur = b; const r = b.getBoundingClientRect();
    b.style.translate = `${((e.clientX - r.left) / r.width - 0.5) * 10}px ${((e.clientY - r.top) / r.height - 0.5) * 8}px`;
  }, { passive: true });
}
