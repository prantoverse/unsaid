// Full-screen generative background (raw WebGL, no libs).
// Domain-warped fbm tinted by the song palette; reacts to pointer, typing,
// shockwave pulses and live audio level.

const VERT = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 u_res;
uniform float u_time, u_pulse, u_energy, u_seed, u_level, u_bass;
uniform vec3 u_c0, u_c1, u_c2;
uniform vec2 u_mouse, u_pc;

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1., 0.)), u.x),
             mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0., a = .5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++){ v += a * noise(p); p = m * p; a *= .5; }
  return v;
}

void main(){
  float s = min(u_res.x, u_res.y);
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p  = (gl_FragCoord.xy - .5 * u_res) / s;
  vec2 m  = (u_mouse - .5 * u_res) / s;
  vec2 pc = (u_pc    - .5 * u_res) / s;
  float t = u_time * .06 + u_seed;

  // shockwave ring
  float d  = length(p - pc);
  float rd = (d - (1. - u_pulse) * 1.6) * 7.;
  float ring = u_pulse * exp(-rd * rd);
  p += normalize(p - pc + 1e-4) * ring * .09;

  // pointer gravity + bass breathing
  p += (m - p) * .05 * exp(-length(p - m) * 2.);
  p *= 1. - u_bass * .06;

  vec2 q = vec2(fbm(p * 1.4 + t), fbm(p * 1.4 - t + 3.1));
  vec2 r = vec2(fbm(p * 1.7 + q * 2.2 + vec2(1.7, 9.2) + t * 1.3),
                fbm(p * 1.7 + q * 2.2 + vec2(8.3, 2.8) - t));
  float f = fbm(p * 1.2 + r * (1.6 + u_energy + u_level * 1.4));

  vec3 col = mix(u_c0, u_c1, smoothstep(.2, .8, f));
  col = mix(col, u_c2, smoothstep(.45, 1., length(r)) * .8);
  col *= .42 + .95 * f * f + u_level * .35;
  col += ring * (u_c2 * .6 + .25);

  col *= smoothstep(1.3, .2, length(uv - .5) * 1.4);            // vignette
  col += (hash(gl_FragCoord.xy + fract(u_time)) - .5) * .035;    // grain
  gl_FragColor = vec4(col, 1.);
}`;

const UNIFORMS = ['u_res', 'u_time', 'u_pulse', 'u_energy', 'u_seed', 'u_level', 'u_bass', 'u_c0', 'u_c1', 'u_c2', 'u_mouse', 'u_pc'];

export function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function setup(gl) {
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = {};
  for (const n of UNIFORMS) u[n] = gl.getUniformLocation(prog, n);
  return u;
}

function draw(gl, u, s) {
  gl.viewport(0, 0, s.w, s.h);
  gl.uniform2f(u.u_res, s.w, s.h);
  gl.uniform1f(u.u_time, s.time);
  gl.uniform1f(u.u_pulse, s.pulse);
  gl.uniform1f(u.u_energy, s.energy);
  gl.uniform1f(u.u_seed, s.seed);
  gl.uniform1f(u.u_level, s.level);
  gl.uniform1f(u.u_bass, s.bass);
  gl.uniform3fv(u.u_c0, s.c[0]);
  gl.uniform3fv(u.u_c1, s.c[1]);
  gl.uniform3fv(u.u_c2, s.c[2]);
  gl.uniform2f(u.u_mouse, s.mouse[0], s.mouse[1]);
  gl.uniform2f(u.u_pc, s.pc[0], s.pc[1]);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

export class Background {
  constructor(canvas) {
    this.canvas = canvas;
    this.hex = ['#0a0618', '#7b5cff', '#ff3d81'];
    this.c = this.hex.map(hexToRgb);
    this.target = this.c.map((v) => v.slice());
    this.pulseV = 0; this.pc = [0, 0]; this.energyV = 0;
    this.level = 0; this.bass = 0; this.levelSource = null;
    this.m = [innerWidth / 2, innerHeight / 2]; this.mt = this.m.slice();
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.seed = Math.random() * 50;
    this.time = 0;
    this.gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' });
    if (!this.gl) { canvas.classList.add('fallback'); return; }
    try { this.u = setup(this.gl); } catch (e) { console.warn(e); this.gl = null; canvas.classList.add('fallback'); return; }
    this.resize();
    addEventListener('resize', () => this.resize());
    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }

  get palette() { return this.hex.slice(); }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.k = dpr * 0.5; // half-res: it's a blurry field anyway
    this.canvas.width = Math.max(1, Math.round(innerWidth * this.k));
    this.canvas.height = Math.max(1, Math.round(innerHeight * this.k));
  }

  setPalette(hex) { this.hex = hex.slice(0, 3); this.target = this.hex.map(hexToRgb); }
  pulse(x = innerWidth / 2, y = innerHeight / 2, s = 1) { this.pulseV = Math.min(1, Math.max(this.pulseV, s)); this.pc = [x, y]; }
  energy(a) { this.energyV = Math.min(1.5, this.energyV + a); }
  mouse(x, y) { this.mt = [x, y]; }
  /** fn() → {level, bass} in 0..1, or null to detach */
  listen(fn) { this.levelSource = fn; }

  frame = (now) => {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const lv = this.levelSource ? this.levelSource() : null;
    const tl = lv ? lv.level : 0, tb = lv ? lv.bass : 0;
    this.level += (tl - this.level) * (1 - Math.exp(-dt * 12));
    this.bass += (tb - this.bass) * (1 - Math.exp(-dt * 18));

    const motion = this.reduced ? 0.25 : 1;
    this.time += dt * motion * (1 + this.energyV * 1.5 + this.level * 2);
    const k = 1 - Math.exp(-dt * 2.2);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) this.c[i][j] += (this.target[i][j] - this.c[i][j]) * k;
    this.pulseV = Math.max(0, this.pulseV - dt * 0.85);
    this.energyV *= Math.exp(-dt * 1.6);
    const km = 1 - Math.exp(-dt * 4);
    this.m[0] += (this.mt[0] - this.m[0]) * km;
    this.m[1] += (this.mt[1] - this.m[1]) * km;

    const K = this.k, H = this.canvas.height;
    draw(this.gl, this.u, {
      w: this.canvas.width, h: H, time: this.time, c: this.c, seed: this.seed,
      mouse: [this.m[0] * K, H - this.m[1] * K],
      pulse: this.reduced ? 0 : this.pulseV,
      pc: [this.pc[0] * K, H - this.pc[1] * K],
      energy: this.energyV,
      level: this.level * motion, bass: this.bass * motion,
    });
    requestAnimationFrame(this.frame);
  };
}

/** One frame of the same field, for story images. Returns a canvas (or null). */
export function renderStill(hex, w, h, seed = Math.random() * 50) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const gl = c.getContext('webgl', { preserveDrawingBuffer: true, antialias: false });
  if (!gl) return null;
  try {
    const u = setup(gl);
    draw(gl, u, { w, h, time: 0, c: hex.map(hexToRgb), seed, mouse: [w / 2, h * 0.55], pulse: 0, pc: [w / 2, h / 2], energy: 0.4, level: 0.15, bass: 0 });
  } catch { return null; }
  c.dispose = () => gl.getExtension('WEBGL_lose_context')?.loseContext();
  return c;
}
