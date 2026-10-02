(() => {
  'use strict';

  const params = new URLSearchParams(location.search);
  const DEMO = params.has('demo');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // =====================================================================
  // Shaders
  // =====================================================================

  const VERT = `#version 300 es
  in vec2 aPos;
  out vec2 vUv;
  void main() {
    vUv = aPos * 0.5 + 0.5;
    gl_Position = vec4(aPos, 0.0, 1.0);
  }`;

  const NOISE = `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
    return v;
  }`;

  // The slow, blurred colour field that sits under the water.
  const GRADIENT_FRAG = `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 outColor;
  uniform float uTime;
  uniform float uAspect;
  uniform float uSpeed;

  const vec3 C_INK   = vec3(0.071, 0.094, 0.129);
  const vec3 C_STEEL = vec3(0.235, 0.353, 0.447);
  const vec3 C_TIDE  = vec3(0.435, 0.624, 0.651);
  const vec3 C_SAGE  = vec3(0.561, 0.710, 0.561);
  const vec3 C_GLOW  = vec3(0.875, 0.890, 0.627);
  ${NOISE}

  void main() {
    vec2 p = vec2(vUv.x * uAspect, vUv.y);
    float t = uTime * uSpeed;
    vec2 q = vec2(fbm(p * 0.8 + vec2(0.0, t)), fbm(p * 0.8 + vec2(5.2, -t)));
    vec2 r = vec2(fbm(p * 0.9 + 1.8 * q + vec2(1.7, 9.2) + t * 1.2),
                  fbm(p * 0.9 + 1.8 * q + vec2(8.3, 2.8) - t * 0.9));
    float f = fbm(p * 0.7 + r);

    // A drifting band of hazy light across the upper half, as on the Chumi screen
    float bandY = 0.66 + 0.07 * sin(t * 2.0 + p.x * 1.4) + (q.x - 0.5) * 0.18;
    float band = exp(-pow((vUv.y - bandY) / 0.2, 2.0));

    vec3 col = C_INK;
    col = mix(col, C_STEEL, clamp(band * 0.8 + smoothstep(0.35, 0.8, f) * 0.4, 0.0, 1.0));
    col = mix(col, C_TIDE, smoothstep(0.5, 0.9, f) * 0.5 * (0.35 + band));
    col = mix(col, C_SAGE, smoothstep(0.55, 0.95, r.x) * 0.3 * (0.4 + band));
    col = mix(col, C_GLOW, smoothstep(0.72, 1.0, r.y * q.x * 1.7) * 0.2);
    col *= mix(0.72, 1.0, smoothstep(0.0, 0.75, vUv.y));
    outColor = vec4(col, 1.0);
  }`;

  // Height-field wave equation. r = height, g = velocity.
  const SIM_FRAG = `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 outColor;
  uniform sampler2D uState;
  uniform vec2 uTexel;
  uniform float uAspect;
  uniform int uCount;
  uniform vec4 uImp[8]; // uv.x, uv.y, radius (height units), strength

  void main() {
    vec4 info = texture(uState, vUv);
    float l = texture(uState, vUv - vec2(uTexel.x, 0.0)).r;
    float r = texture(uState, vUv + vec2(uTexel.x, 0.0)).r;
    float d = texture(uState, vUv - vec2(0.0, uTexel.y)).r;
    float u = texture(uState, vUv + vec2(0.0, uTexel.y)).r;
    float avg = (l + r + d + u) * 0.25;
    info.g += (avg - info.r) * 1.96;
    info.g *= 0.993;
    info.r += info.g;
    info.r *= 0.9992;

    for (int i = 0; i < 8; i++) {
      if (i >= uCount) break;
      vec4 im = uImp[i];
      float dist = length((vUv - im.xy) * vec2(uAspect, 1.0)) / im.z;
      if (dist < 1.0) {
        info.r += (0.5 + 0.5 * cos(dist * 3.14159265)) * im.w;
      }
    }
    outColor = info;
  }`;

  // Final composite: refraction through the surface, light on the ripples,
  // falling drops, crowns and the rebound jet.
  const RENDER_FRAG = `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 outColor;
  uniform sampler2D uGrad;
  uniform sampler2D uSim;
  uniform vec2 uRes;       // css px
  uniform vec2 uSimTexel;
  uniform float uTime;
  uniform vec4 uFall[6];   // x px, y px, progress 0..1, radius px
  uniform vec4 uCrown[8];  // x px, y px, age s, radius px

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  const vec3 LIGHT = vec3(-0.22, 0.42, 1.0);
  const vec3 SKY = vec3(0.86, 0.92, 0.96);

  void main() {
    vec2 px = vUv * uRes;
    vec3 L = normalize(LIGHT);
    vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));

    // Surface normal from the height field
    float hl = texture(uSim, vUv - vec2(uSimTexel.x, 0.0)).r;
    float hr = texture(uSim, vUv + vec2(uSimTexel.x, 0.0)).r;
    float hd = texture(uSim, vUv - vec2(0.0, uSimTexel.y)).r;
    float hu = texture(uSim, vUv + vec2(0.0, uSimTexel.y)).r;
    vec3 n = normalize(vec3((hl - hr) * 1.6, (hd - hu) * 1.6, 1.0));

    // Refraction of the colour field below
    vec2 offPx = n.xy * 70.0;
    vec3 col = texture(uGrad, vUv + offPx / uRes).rgb;

    // Slopes facing the light catch sky, slopes facing away darken
    float facing = dot(n.xy, normalize(L.xy));
    col *= 1.0 + clamp(facing * 2.2, -0.22, 0.45);
    float fres = pow(1.0 - n.z, 1.5);
    col = mix(col, SKY * 0.55, clamp(fres * 1.4, 0.0, 0.25));

    // Specular glints on the ring crests
    float nh = max(dot(n, H), 0.0);
    col += vec3(1.0, 0.98, 0.95) * (pow(nh, 1400.0) * 1.1 + pow(nh, 160.0) * 0.08);

    // Crowns and splash cores right after impact
    for (int i = 0; i < 8; i++) {
      vec4 c = uCrown[i];
      if (c.w <= 0.0) continue;
      float a = c.z;
      vec2 dv = px - c.xy;
      float d = length(dv);
      float R = c.w * (0.8 + 1.8 * sqrt(clamp(a / 0.12, 0.0, 1.0)));
      float ring = exp(-pow((d - R) / 0.9, 2.0));
      float ang = atan(dv.y, dv.x);
      float beads = pow(0.5 + 0.5 * cos(ang * 11.0 + c.x * 0.37), 4.0);
      float fade = 1.0 - smoothstep(0.0, 0.12, a);
      col += SKY * ring * (0.25 + 0.35 * beads) * fade * 0.35;
      col += SKY * exp(-(d * d) / (c.w * c.w * 0.8)) * exp(-a * 30.0) * 0.3;
    }

    // Falling drops: shadow and focused light on the surface, then the drop itself
    for (int i = 0; i < 6; i++) {
      vec4 f = uFall[i];
      if (f.w <= 0.0) continue;
      float k = clamp(f.z, 0.0, 1.0);
      float height = (1.0 - k) * 160.0;
      vec2 sc = f.xy + vec2(0.22, -0.42) * height * 0.45;
      float sd = length(px - sc);
      float shadowR = f.w * mix(3.2, 1.3, k);
      col *= 1.0 - (1.0 - smoothstep(0.0, shadowR, sd)) * mix(0.12, 0.4, k);
      col += SKY * exp(-(sd * sd) / max(0.6, f.w * 0.35)) * 0.5 * k;

      float rr = f.w * mix(2.3, 1.0, k * k);
      vec2 q = (px - f.xy) / rr;
      float qq = dot(q, q);
      if (qq < 1.0) {
        float z = sqrt(1.0 - qq);
        vec3 dn = vec3(q, z);
        // A water sphere shows a small, inverted image of what is behind it
        vec2 suv = (f.xy - q * rr * 5.0) / uRes;
        vec3 dc = texture(uGrad, suv).rgb * 1.15;
        dc *= mix(0.35, 1.05, pow(z, 0.6));
        dc += vec3(1.0) * pow(max(dot(dn, H), 0.0), 90.0) * 1.6;
        dc += SKY * pow(max(dot(dn, normalize(vec3(0.45, -0.7, 0.4))), 0.0), 5.0) * 0.35;
        float edge = 1.0 - smoothstep(1.0 - 1.4 / rr, 1.0, sqrt(qq));
        col = mix(col, dc, edge * smoothstep(0.0, 0.12, k));
      }
    }

    col += (hash(px + fract(uTime) * 91.0) - 0.5) * 0.012;
    outColor = vec4(col, 1.0);
  }`;

  // =====================================================================
  // Water renderer
  // =====================================================================

  class Water {
    constructor(canvas) {
      const gl = canvas.getContext('webgl2', {
        antialias: false, alpha: false, depth: false, stencil: false,
        premultipliedAlpha: false, powerPreference: 'high-performance',
      });
      if (!gl) throw new Error('WebGL2 unavailable');
      if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) {
        throw new Error('Float render targets unavailable');
      }
      this.gl = gl;
      this.canvas = canvas;
      this.falling = [];
      this.crowns = [];
      this.impulses = [];
      this.timers = [];
      this.acc = 0;
      this.lastT = 0;
      this.fallBuf = new Float32Array(6 * 4);
      this.crownBuf = new Float32Array(8 * 4);
      this.impBuf = new Float32Array(8 * 4);

      this.gradProg = this.program(GRADIENT_FRAG);
      this.simProg = this.program(SIM_FRAG);
      this.renderProg = this.program(RENDER_FRAG);

      this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

      this.resize();
    }

    program(fragSrc) {
      const gl = this.gl;
      const compile = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
      };
      const p = gl.createProgram();
      gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT));
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fragSrc));
      gl.bindAttribLocation(p, 0, 'aPos');
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const uniforms = {};
      const count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < count; i++) {
        const info = gl.getActiveUniform(p, i);
        const name = info.name.replace(/\[0\]$/, '');
        uniforms[name] = gl.getUniformLocation(p, info.name);
      }
      return { p, u: uniforms };
    }

    target(w, h, float) {
      const gl = this.gl;
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      if (float) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
      } else {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      }
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return { tex, fbo, w, h };
    }

    resize() {
      const gl = this.gl;
      const cssW = this.canvas.clientWidth || innerWidth;
      const cssH = this.canvas.clientHeight || innerHeight;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      this.cssW = cssW;
      this.cssH = cssH;
      this.canvas.width = Math.round(cssW * dpr);
      this.canvas.height = Math.round(cssH * dpr);

      for (const t of [this.grad, this.simA, this.simB]) {
        if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); }
      }
      this.grad = this.target(Math.max(64, Math.round(cssW * 0.5)), Math.max(64, Math.round(cssH * 0.5)), false);
      const simW = 300;
      const simH = Math.round(simW * cssH / cssW);
      this.simA = this.target(simW, simH, true);
      this.simB = this.target(simW, simH, true);
    }

    // x, y in CSS px from the top-left corner; size is the drop radius in px
    addDrop(x, y, size, now) {
      this.falling.push({ x, y: this.cssH - y, size, t0: now, dur: 0.26 + Math.random() * 0.08 });
    }

    impact(d, now) {
      const u = d.x / this.cssW;
      const v = d.y / this.cssH;
      const r = (d.size * 1.35) / this.cssH;
      this.impulses.push([u, v, r, -0.55 * (d.size / 6)]);
      this.crowns.push({ x: d.x, y: d.y, size: d.size, t0: now });
      // The Worthington jet falls back a moment later and sends a second, finer ring
      this.timers.push({ at: now + 0.17 + Math.random() * 0.06, fn: () => {
        this.impulses.push([u, v, r * 0.55, -0.32 * (d.size / 6)]);
      } });
    }

    frame(now) {
      const gl = this.gl;
      const dt = Math.min(0.05, this.lastT ? now - this.lastT : 0.016);
      this.lastT = now;

      for (let i = this.falling.length - 1; i >= 0; i--) {
        const d = this.falling[i];
        if ((now - d.t0) / d.dur >= 1) {
          this.falling.splice(i, 1);
          this.impact(d, now);
        }
      }
      for (let i = this.timers.length - 1; i >= 0; i--) {
        if (now >= this.timers[i].at) { this.timers[i].fn(); this.timers.splice(i, 1); }
      }
      this.crowns = this.crowns.filter(c => now - c.t0 < 0.4);

      gl.bindVertexArray(this.vao);

      // 1. Colour field
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.grad.fbo);
      gl.viewport(0, 0, this.grad.w, this.grad.h);
      gl.useProgram(this.gradProg.p);
      gl.uniform1f(this.gradProg.u.uTime, now);
      gl.uniform1f(this.gradProg.u.uAspect, this.cssW / this.cssH);
      gl.uniform1f(this.gradProg.u.uSpeed, reduceMotion ? 0.012 : 0.03);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // 2. Wave simulation at a fixed rate
      this.acc += dt;
      let steps = Math.min(6, Math.floor(this.acc * 150));
      this.acc -= steps / 150;
      gl.useProgram(this.simProg.p);
      gl.uniform2f(this.simProg.u.uTexel, 1 / this.simA.w, 1 / this.simA.h);
      gl.uniform1f(this.simProg.u.uAspect, this.cssW / this.cssH);
      gl.uniform1i(this.simProg.u.uState, 0);
      gl.viewport(0, 0, this.simA.w, this.simA.h);
      gl.activeTexture(gl.TEXTURE0);
      for (let s = 0; s < steps; s++) {
        const n = s === 0 ? Math.min(8, this.impulses.length) : 0;
        if (n) {
          this.impBuf.fill(0);
          for (let i = 0; i < n; i++) this.impBuf.set(this.impulses[i], i * 4);
          this.impulses.splice(0, n);
          gl.uniform4fv(this.simProg.u.uImp, this.impBuf);
        }
        gl.uniform1i(this.simProg.u.uCount, n);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.simB.fbo);
        gl.bindTexture(gl.TEXTURE_2D, this.simA.tex);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        [this.simA, this.simB] = [this.simB, this.simA];
      }

      // 3. Composite
      this.fallBuf.fill(0);
      this.falling.slice(0, 6).forEach((d, i) => {
        this.fallBuf.set([d.x, d.y, (now - d.t0) / d.dur, d.size], i * 4);
      });
      this.crownBuf.fill(0);
      this.crowns.slice(-8).forEach((c, i) => {
        this.crownBuf.set([c.x, c.y, now - c.t0, c.size], i * 4);
      });

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      const r = this.renderProg;
      gl.useProgram(r.p);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.grad.tex);
      gl.uniform1i(r.u.uGrad, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.simA.tex);
      gl.uniform1i(r.u.uSim, 1);
      gl.uniform2f(r.u.uRes, this.cssW, this.cssH);
      gl.uniform2f(r.u.uSimTexel, 1 / this.simA.w, 1 / this.simA.h);
      gl.uniform1f(r.u.uTime, now);
      gl.uniform4fv(r.u.uFall, this.fallBuf);
      gl.uniform4fv(r.u.uCrown, this.crownBuf);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.activeTexture(gl.TEXTURE0);
    }
  }

  // =====================================================================
  // Listening: speech-to-text where available, microphone level otherwise
  // =====================================================================

  class Listener {
    constructor({ onText, onError }) {
      this.SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
      this.onText = onText;
      this.onError = onError;
      this.base = '';
      this.current = '';
      this.level = 0;
      this.active = false;
      this.denied = false;
    }

    get text() {
      return `${this.base} ${this.current}`.replace(/\s+/g, ' ').trim();
    }

    start() {
      this.active = true;
      this.base = '';
      this.current = '';
      this.restarts = 0;
      if (this.SR) this.startRecognition();
      else this.startMeter();
    }

    startRecognition() {
      const rec = new this.SR();
      rec.lang = navigator.language || 'en-US';
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      rec.onresult = e => {
        let s = '';
        for (let i = 0; i < e.results.length; i++) s += e.results[i][0].transcript;
        this.current = s;
        this.onText(this.text);
      };
      rec.onerror = e => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          this.denied = true;
          this.onError('denied');
        } else if (e.error === 'audio-capture') {
          this.onError('nomic');
        }
      };
      rec.onend = () => {
        this.base = this.text;
        this.current = '';
        // iOS ends recognition after a pause; keep listening while the finger is down
        if (this.active && !this.denied && this.restarts < 20) {
          this.restarts++;
          try { this.startRecognition(); } catch (_) { /* ignore */ }
        } else if (this.resolveEnd) {
          this.resolveEnd();
        }
      };
      this.rec = rec;
      try { rec.start(); } catch (_) { this.onError('failed'); }
    }

    async startMeter() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        if (!this.active) { this.stopMeter(); return; }
        const ctx = this.ctx || (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
        if (ctx.state === 'suspended') await ctx.resume();
        const src = ctx.createMediaStreamSource(this.stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        src.connect(analyser);
        const data = new Float32Array(analyser.fftSize);
        const tick = () => {
          if (!this.active) return;
          analyser.getFloatTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
          this.level = Math.min(1, Math.sqrt(sum / data.length) * 8);
          requestAnimationFrame(tick);
        };
        tick();
      } catch (_) {
        this.onError('denied');
      }
    }

    stopMeter() {
      if (this.stream) this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
      this.level = 0;
    }

    stop() {
      this.active = false;
      this.stopMeter();
      return new Promise(resolve => {
        const done = () => {
          clearTimeout(timeout);
          this.resolveEnd = null;
          resolve(this.text);
        };
        const timeout = setTimeout(done, 1500);
        this.resolveEnd = done;
        if (this.rec) {
          try { this.rec.stop(); } catch (_) { done(); }
          this.rec = null;
        } else {
          done();
        }
      });
    }
  }

  // Scripted listener for ?demo, used to preview the flow without a microphone
  class DemoListener {
    constructor({ onText }) { this.onText = onText; this.level = 0; this.SR = true; }
    start() {
      const words = "I've been carrying this all week and I just needed to say it out loud".split(' ');
      this.text = '';
      this.timers = words.map((w, i) => setTimeout(() => {
        this.text = words.slice(0, i + 1).join(' ');
        this.onText(this.text);
      }, 300 + i * 260));
    }
    stop() {
      this.timers.forEach(clearTimeout);
      return Promise.resolve(this.text);
    }
  }

  // =====================================================================
  // App
  // =====================================================================

  const canvas = document.getElementById('water');
  const talk = document.getElementById('talk');
  const wordsEl = document.getElementById('words');
  const noteEl = document.getElementById('note');
  const hintTitle = document.getElementById('hintTitle');

  let water = null;
  try {
    water = new Water(canvas);
  } catch (e) {
    console.warn(e);
  }

  const t0 = performance.now();
  const now = () => (performance.now() - t0) / 1000;

  function loop() {
    if (water) water.frame(now());
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  addEventListener('resize', () => water && water.resize());

  function randomDrop(scale = 1) {
    const w = innerWidth;
    const h = innerHeight;
    const x = w * (0.08 + Math.random() * 0.84);
    const y = h * (0.12 + Math.random() * 0.7);
    const size = (4.2 + Math.random() * 2.6) * scale;
    if (water) water.addDrop(x, y, size, now());
  }

  let holding = false;
  let drizzleTimer = null;
  let meterTimer = null;
  let resetTimer = null;
  let heardTimer = null;
  let wordCount = 0;
  let session = 0;

  const listener = new (DEMO ? DemoListener : Listener)({
    onText(text) {
      if (!holding) return;
      wordsEl.classList.remove('placeholder');
      wordsEl.textContent = text.length > 150 ? `…${text.slice(-150).replace(/^\S*\s/, '')}` : text;
      // Each new word lets a drop fall
      const count = text.split(/\s+/).filter(Boolean).length;
      const fresh = Math.min(3, count - wordCount);
      for (let i = 0; i < fresh; i++) setTimeout(() => holding && randomDrop(), i * 120 + Math.random() * 60);
      wordCount = Math.max(wordCount, count);
    },
    onError(kind) {
      if (kind === 'denied') {
        showNote('Chumi needs the microphone. Turn on Microphone and Speech Recognition in Settings, then hold again.');
      } else if (kind === 'nomic') {
        showNote('No microphone was found.');
      }
    },
  });

  function showNote(text) {
    noteEl.textContent = text;
    noteEl.hidden = false;
    wordsEl.textContent = '';
  }

  function drizzle() {
    if (!holding) return;
    randomDrop(0.85);
    drizzleTimer = setTimeout(drizzle, reduceMotion ? 1400 : 650 + Math.random() * 700);
  }

  function setState(s) {
    document.body.dataset.state = s;
    hintTitle.textContent = s === 'listening' ? 'Listening' : 'Hold to speak';
  }

  function press(e) {
    if (e && e.button > 0) return;
    if (e) e.preventDefault();
    if (holding) return;
    holding = true;
    session++;
    if (e && e.pointerId !== undefined) {
      try { talk.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    }
    clearTimeout(resetTimer);
    clearTimeout(heardTimer);
    noteEl.hidden = true;
    wordCount = 0;
    wordsEl.className = 'words placeholder';
    wordsEl.textContent = 'Say what is on your mind';
    setState('listening');
    listener.start();
    randomDrop();
    drizzleTimer = setTimeout(drizzle, 500);
    // Without speech-to-text, let the voice level call the drops
    if (!listener.SR) {
      meterTimer = setInterval(() => {
        if (holding && Math.random() < listener.level * 0.5) randomDrop(0.8 + listener.level * 0.6);
      }, 90);
    }
  }

  function release() {
    if (!holding) return;
    holding = false;
    clearTimeout(drizzleTimer);
    clearInterval(meterTimer);
    setState('releasing');
    const mine = session;
    listener.stop().then(text => {
      if (mine !== session || holding) return;
      if (text) wordsEl.textContent = text.length > 150 ? `…${text.slice(-150).replace(/^\S*\s/, '')}` : text;
      wordsEl.classList.add('sink');
      // Let the last drops land and the words sink before answering
      heardTimer = setTimeout(() => {
        if (mine !== session || holding) return;
        setState('heard');
        resetTimer = setTimeout(() => {
          if (mine !== session || holding) return;
          setState('idle');
          wordsEl.className = 'words';
          wordsEl.textContent = '';
        }, 5200);
      }, text ? 1100 : 500);
    });
  }

  talk.addEventListener('pointerdown', press);
  talk.addEventListener('pointerup', release);
  talk.addEventListener('pointercancel', release);
  talk.addEventListener('lostpointercapture', release);
  talk.addEventListener('contextmenu', e => e.preventDefault());
  talk.addEventListener('keydown', e => {
    if ((e.code === 'Space' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); press(); }
  });
  talk.addEventListener('keyup', e => {
    if (e.code === 'Space' || e.key === 'Enter') { e.preventDefault(); release(); }
  });
  addEventListener('blur', release);
  document.addEventListener('visibilitychange', () => { if (document.hidden) release(); });

  if (DEMO) {
    setTimeout(press, 400);
    const hold = parseFloat(params.get('hold')) || 4.5;
    setTimeout(release, 400 + hold * 1000);
  }
})();
