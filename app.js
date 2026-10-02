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

  // Aquarelle field after the "Restful" moodboard image: an aqua wash with
  // sweeping painted bands of violet and cobalt, thin coral and navy lines, cream arcs.
  const GRADIENT_FRAG = `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 outColor;
  uniform float uTime;
  uniform float uAspect;
  uniform float uSpeed;

  const vec3 C_AQUA   = vec3(0.612, 0.769, 0.784);
  const vec3 C_AQUA_D = vec3(0.435, 0.639, 0.678);
  const vec3 C_BLOT   = vec3(0.310, 0.540, 0.610);
  const vec3 C_CREAM  = vec3(0.937, 0.910, 0.824);
  const vec3 C_VIOLET = vec3(0.545, 0.533, 0.839);
  const vec3 C_COBALT = vec3(0.227, 0.322, 0.769);
  const vec3 C_CORAL  = vec3(0.878, 0.565, 0.486);
  const vec3 C_NAVY   = vec3(0.122, 0.169, 0.231);
  ${NOISE}

  float band(float c, float c0, float w) { return exp(-pow((c - c0) / w, 2.0)); }
  float blot(vec2 p, vec2 c, float r) { vec2 d = p - c; return exp(-dot(d, d) / (r * r)); }

  void main() {
    float A = uAspect;
    vec2 p = vec2(vUv.x * A, vUv.y);
    float t = uTime * uSpeed;
    vec2 w = vec2(fbm(p * 1.6 + vec2(t * 0.6, 0.0)), fbm(p * 1.6 + vec2(3.7, -t * 0.5))) - 0.5;
    vec2 q = p + w * 0.3 + (vec2(noise(p * 14.0), noise(p * 14.0 + 7.0)) - 0.5) * 0.012;
    float x = q.x / A;
    // Dry-brush break-up along each stroke
    float dry = 0.45 + 0.55 * smoothstep(0.2, 0.8, noise(q * vec2(7.0, 30.0)) * 0.7 + noise(q * 60.0) * 0.3);

    vec3 col = mix(C_AQUA_D, C_AQUA, smoothstep(0.0, 0.85, vUv.y));
    col = mix(col, C_BLOT, blot(q, vec2(A * 0.08, 0.93), 0.11) * 0.55);
    col = mix(col, C_BLOT, blot(q, vec2(A * 0.36, 0.86 + 0.02 * sin(t)), 0.07) * 0.4);

    // Flow coordinate: bands sweep down to the right and lift again
    float c = q.y + 0.16 * sin(x * 3.0 + 0.4 + t * 0.8) - 0.18 * x;
    col = mix(col, C_VIOLET, band(c, 0.40, 0.055) * 0.7);
    col = mix(col, C_COBALT, band(c, 0.22, 0.05) * 0.8);
    col = mix(col, C_COBALT, band(c, 0.11, 0.035) * 0.55);
    col = mix(col, C_CORAL, band(c, 0.31, 0.014) * 0.75 * dry);
    col = mix(col, C_CORAL, band(c, 0.165, 0.012) * 0.6 * dry);
    col = mix(col, C_NAVY, band(c, 0.335, 0.007) * 0.7 * dry);
    col = mix(col, C_NAVY, band(c, 0.065, 0.0065) * 0.55 * dry);

    // Cream arcs: a long sweep from the upper left, a short one on the right
    float arc1 = length(q - vec2(A * 1.05, 1.02 + 0.02 * sin(t * 0.7))) - 0.82;
    col = mix(col, C_CREAM, band(arc1, 0.0, 0.011) * 0.85 * dry);
    float arc2 = length(q - vec2(A * 0.5, 1.32)) - 0.66;
    col = mix(col, C_CREAM, band(arc2, 0.0, 0.01) * 0.8 * dry * smoothstep(0.5, 0.75, x));
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
    info.g *= 0.992;
    info.r += info.g;
    info.r *= 0.999;

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

  // Final composite: water surface, the running stream, foam where it lands,
  // and the glass button refracting everything beneath it.
  const RENDER_FRAG = `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 outColor;
  uniform sampler2D uGrad;
  uniform sampler2D uSim;
  uniform vec2 uRes;        // css px, y up
  uniform vec2 uSimTexel;
  uniform float uTime;
  uniform vec4 uStreamA;    // x, impact y, top end y, bottom end y
  uniform vec4 uStreamB;    // half width at top, half width at impact, visible, foam
  uniform vec4 uGlass;      // x, y, radius, press
  ${NOISE}

  const vec3 LIGHT = vec3(-0.22, 0.42, 1.0);
  const vec3 WHITE = vec3(0.98, 0.985, 0.99);
  const vec3 CREAM = vec3(0.937, 0.910, 0.824);
  const vec3 COBALT = vec3(0.227, 0.322, 0.769);

  // Paper grain, so everything reads as pigment on a rough sheet
  float grain(vec2 x) { return noise(x * 0.75) * 0.6 + noise(x * 1.9) * 0.4; }

  vec3 water(vec2 uv) {
    vec3 L = normalize(LIGHT);
    vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
    float hl = texture(uSim, uv - vec2(uSimTexel.x, 0.0)).r;
    float hr = texture(uSim, uv + vec2(uSimTexel.x, 0.0)).r;
    float hd = texture(uSim, uv - vec2(0.0, uSimTexel.y)).r;
    float hu = texture(uSim, uv + vec2(0.0, uSimTexel.y)).r;
    vec3 n = normalize(vec3((hl - hr) * 1.6, (hd - hu) * 1.6, 1.0));
    vec3 col = texture(uGrad, uv + n.xy * 45.0 / uRes).rgb;
    float facing = dot(n.xy, normalize(L.xy));
    col *= 1.0 + clamp(facing * 1.2, -0.12, 0.14);
    // Rings painted as strokes: cream on the crests, a cobalt wash in the troughs
    float h = texture(uSim, uv).r;
    float dry = 0.5 + 0.5 * smoothstep(0.2, 0.8, noise(uv * uRes * 0.32));
    col = mix(col, CREAM, smoothstep(0.003, 0.022, h) * 0.75 * dry);
    col = mix(col, COBALT, smoothstep(0.003, 0.022, -h) * 0.3 * dry);
    float nh = max(dot(n, H), 0.0);
    col += WHITE * pow(nh, 1400.0) * 0.25;
    return col;
  }

  void main() {
    vec2 px = vUv * uRes;
    vec3 col = water(vUv);

    // ---------- Running stream ----------
    float impactY = uStreamA.y;
    if (uStreamB.z > 0.5 && px.y <= uStreamA.z && px.y >= uStreamA.w) {
      float span = max(1.0, uRes.y + 20.0 - impactY);
      float k = clamp((px.y - impactY) / span, 0.0, 1.0);   // 0 at the surface, 1 at the top
      // A falling stream speeds up and thins; near the bottom it starts to bead
      float hw = mix(uStreamB.y, uStreamB.x, sqrt(k));
      hw *= 1.0 + 0.13 * (1.0 - k) * (1.0 - k) * sin(px.y * 0.32 + uTime * 52.0)
                + 0.04 * sin(px.y * 0.09 - uTime * 21.0);
      float xc = uStreamA.x + sin(px.y * 0.018 + uTime * 2.7) * 0.7 * (1.0 - k);
      float s = (px.x - xc) / hw;
      if (abs(s) < 1.0) {
        float z = sqrt(1.0 - s * s);
        // A cylinder of water shows the world behind it flipped and stretched
        vec3 sc = texture(uGrad, vec2(xc - s * hw * 5.0, px.y + 30.0) / uRes).rgb;
        sc *= mix(0.7, 1.0, pow(z, 0.7));
        float flowA = noise(vec2(s * 2.5 + 3.0, (px.y + uTime * 1400.0) * 0.012));
        float flowB = noise(vec2(s * 6.0, (px.y + uTime * 1750.0) * 0.035));
        sc *= 0.9 + 0.18 * flowA;
        sc += WHITE * exp(-pow((s + 0.45) / 0.11, 2.0)) * (0.4 + 0.6 * flowB) * 0.5;
        sc += WHITE * exp(-pow((s - 0.64) / 0.07, 2.0)) * 0.22;
        float edge = 1.0 - smoothstep(1.0 - 1.3 / hw, 1.0, abs(s));
        float ends = smoothstep(uStreamA.w, uStreamA.w + 5.0, px.y)
                   * (1.0 - smoothstep(uStreamA.z - 5.0, uStreamA.z, px.y));
        col = mix(col, sc, edge * ends);
      }
    }

    // ---------- Foam and air where the stream lands ----------
    float foamAmt = uStreamB.w;
    if (foamAmt > 0.001) {
      vec2 dv = (px - vec2(uStreamA.x, impactY)) * vec2(1.0, 1.6);
      float d2 = dot(dv, dv);
      float r = uStreamB.y * 3.6;
      float f1 = noise(dv * 0.42 + vec2(uTime * 13.0, -uTime * 9.0));
      float f2 = noise(dv * 0.95 + vec2(-uTime * 21.0, uTime * 17.0));
      float foam = smoothstep(0.5, 0.85, f1 * 0.6 + f2 * 0.5) * exp(-d2 / (r * r));
      col = mix(col, CREAM, foam * 0.85 * foamAmt);
      col += CREAM * exp(-d2 / (r * r * 0.5)) * 0.08 * foamAmt;
    }

    // ---------- Glass button ----------
    vec2 gv = px - uGlass.xy;
    float gd = length(gv);
    float R = uGlass.z;
    if (R > 0.0) {
      float sd = length(px - uGlass.xy - vec2(0.0, -7.0));
      float shadow = exp(-pow(max(sd - R * 0.82, 0.0) / 18.0, 2.0)) * smoothstep(R - 1.0, R + 3.0, gd);
      col *= 1.0 - shadow * 0.1;

      if (gd < R + 1.0) {
        float edge = R - gd;
        float tt = clamp(edge / (R * 0.42), 0.0, 1.0);
        float bend = pow(1.0 - tt, 2.2);
        vec2 dir = gd > 0.001 ? gv / gd : vec2(0.0);
        // Liquid-glass lens: strong bend at the rim, gentle magnification inside
        vec2 off = -dir * bend * R * 0.6 - gv * 0.12;
        vec3 g;
        g.r = water((px + off * 1.07) / uRes).r;
        g.g = water((px + off) / uRes).g;
        g.b = water((px + off * 0.93) / uRes).b;
        g = mix(g, WHITE, 0.05 + 0.07 * uGlass.w);
        g *= 1.04;

        vec3 gn = normalize(vec3(dir * bend * 1.7, 1.0));
        vec3 Lg = normalize(vec3(-0.5, 0.7, 0.9));
        g += WHITE * pow(max(dot(reflect(-Lg, gn), vec3(0.0, 0.0, 1.0)), 0.0), 48.0) * 0.4;
        float side = 0.5 + 0.5 * dot(dir, normalize(vec2(-0.6, 0.8)));
        g += WHITE * exp(-pow(edge / 1.0, 2.0)) * (0.12 + 0.5 * side);
        g += WHITE * exp(-pow((edge - 3.5) / 2.5, 2.0)) * 0.12 * (1.0 - side);
        float a = 1.0 - smoothstep(R - 1.0, R + 0.5, gd);
        col = mix(col, g, a);
      }
    }

    float g0 = grain(px);
    float relief = (grain(px + vec2(1.0, 0.0)) - g0) * -1.0 + (grain(px + vec2(0.0, 1.0)) - g0);
    col *= (0.96 + 0.07 * g0) * (1.0 + relief * 0.22);
    col += (hash(px + fract(uTime) * 91.0) - 0.5) * 0.01;
    outColor = vec4(col, 1.0);
  }`;

  // =====================================================================
  // Water renderer
  // =====================================================================

  const GRAVITY = 3200;      // px/s^2
  const POUR_SPEED = 380;    // px/s at the tap
  const HW_TOP = 7.5;        // stream half width at the top of the screen, px
  const HW_BOTTOM = 3.6;     // stream half width where it meets the water, px

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
      this.impulses = [];
      this.acc = 0;
      this.lastT = 0;
      this.impBuf = new Float32Array(8 * 4);
      this.stream = { on: false, start: -10, stop: -10, contact: false };
      this.foam = 0;
      this.flow = 1;
      this.glass = { x: 0, y: 0, r: 0, press: 0, target: 0 };

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
        uniforms[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name);
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

    // Where the stream lands, in css px from the top-left
    setImpact(x, y) {
      this.impactX = x;
      this.impactY = this.cssH - y;
    }

    pour(now) {
      if (this.stream.on) return;
      this.stream = { on: true, start: now, stop: -10, contact: false };
    }

    close(now) {
      if (!this.stream.on) return;
      this.stream.on = false;
      this.stream.stop = now;
    }

    // Top and bottom ends of the falling column, GL px
    streamEnds(now) {
      const top = this.cssH + 20;
      const st = this.stream;
      const fall = e => POUR_SPEED * e + 0.5 * GRAVITY * e * e;
      const bottom = Math.max(this.impactY, top - fall(now - st.start));
      if (st.on) return { top, bottom };
      const e = now - st.stop;
      // The tail leaves the tap and falls with the water; an unfinished head keeps falling too
      return { top: top - fall(e), bottom: Math.max(this.impactY, bottom - fall(e) * 0.2) };
    }

    setGlass(x, y, r, pressed) {
      this.glass.x = x;
      this.glass.y = this.cssH - y;
      this.glass.r = r;
      this.glass.target = pressed ? 1 : 0;
    }

    frame(now) {
      const gl = this.gl;
      const dt = Math.min(0.05, this.lastT ? now - this.lastT : 0.016);
      this.lastT = now;

      const ends = this.streamEnds(now);
      const visible = ends.top > ends.bottom + 1;
      const touching = visible && ends.bottom <= this.impactY + 0.5;
      if (touching && !this.stream.contact) {
        this.stream.contact = true;
        this.impulses.push([this.impactX / this.cssW, this.impactY / this.cssH, 9 / this.cssH, -0.5]);
      }
      if (touching) {
        const u = this.impactX / this.cssW;
        const v = this.impactY / this.cssH;
        for (let i = 0; i < 3; i++) {
          const jx = (Math.random() - 0.5) * HW_BOTTOM * 1.6 / this.cssW;
          const jy = (Math.random() - 0.5) * 3 / this.cssH;
          const r = (HW_BOTTOM * 1.2 + Math.random() * 2.5) / this.cssH;
          this.impulses.push([u + jx, v + jy, r, -(0.05 + Math.random() * 0.07) * this.flow]);
        }
      }
      this.foam += ((touching ? 1 : 0) - this.foam) * Math.min(1, dt * (touching ? 10 : 3));
      this.flow += (1 - this.flow) * Math.min(1, dt * 2.5);
      this.glass.press += (this.glass.target - this.glass.press) * Math.min(1, dt * 12);

      gl.bindVertexArray(this.vao);

      // 1. Colour field
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.grad.fbo);
      gl.viewport(0, 0, this.grad.w, this.grad.h);
      gl.useProgram(this.gradProg.p);
      gl.uniform1f(this.gradProg.u.uTime, now);
      gl.uniform1f(this.gradProg.u.uAspect, this.cssW / this.cssH);
      gl.uniform1f(this.gradProg.u.uSpeed, reduceMotion ? 0.02 : 0.07);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // 2. Wave simulation at a fixed rate
      this.acc += dt;
      const steps = Math.min(6, Math.floor(this.acc * 150));
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
          gl.uniform4fv(this.simProg.u.uImp, this.impBuf);
        }
        this.impulses.splice(0, n);
        gl.uniform1i(this.simProg.u.uCount, n);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.simB.fbo);
        gl.bindTexture(gl.TEXTURE_2D, this.simA.tex);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        [this.simA, this.simB] = [this.simB, this.simA];
      }
      if (this.impulses.length > 24) this.impulses.splice(0, this.impulses.length - 24);

      // 3. Composite
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
      const widen = 0.9 + 0.12 * this.flow;
      gl.uniform4f(r.u.uStreamA, this.impactX, this.impactY, ends.top, ends.bottom);
      gl.uniform4f(r.u.uStreamB, HW_TOP * widen, HW_BOTTOM * widen, visible ? 1 : 0, this.foam);
      const g = this.glass;
      gl.uniform4f(r.u.uGlass, g.x, g.y, g.r * (1 + 0.07 * g.press), g.press);
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
    document.body.classList.add('no-gl');
  }

  // The stream lands centred, just above the words
  const IMPACT_Y = 0.44;
  function layout() {
    if (!water) return;
    water.resize();
    water.setImpact(innerWidth / 2, innerHeight * IMPACT_Y);
  }
  layout();
  addEventListener('resize', layout);

  let holding = false;
  let meterTimer = null;
  let resetTimer = null;
  let heardTimer = null;
  let wordCount = 0;
  let session = 0;

  const t0 = performance.now();
  const now = () => (performance.now() - t0) / 1000;

  function loop() {
    if (water) {
      const rect = talk.getBoundingClientRect();
      water.setGlass(rect.left + rect.width / 2, rect.top + rect.height / 2, rect.width / 2, holding);
      water.frame(now());
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  const listener = new (DEMO ? DemoListener : Listener)({
    onText(text) {
      if (!holding) return;
      wordsEl.classList.remove('placeholder');
      wordsEl.textContent = text.length > 150 ? `…${text.slice(-150).replace(/^\S*\s/, '')}` : text;
      // Each new word swells the stream a little
      const count = text.split(/\s+/).filter(Boolean).length;
      if (water && count > wordCount) water.flow = Math.min(1.8, water.flow + 0.25 * (count - wordCount));
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
    if (water) water.pour(now());
    // Without speech-to-text, the voice level sets how hard the water runs
    if (!listener.SR) {
      meterTimer = setInterval(() => {
        if (holding && water) water.flow = Math.max(water.flow, 0.7 + listener.level);
      }, 90);
    }
  }

  function release() {
    if (!holding) return;
    holding = false;
    clearInterval(meterTimer);
    if (water) water.close(now());
    setState('releasing');
    const mine = session;
    listener.stop().then(text => {
      if (mine !== session || holding) return;
      if (text) wordsEl.textContent = text.length > 150 ? `…${text.slice(-150).replace(/^\S*\s/, '')}` : text;
      wordsEl.classList.add('sink');
      // Let the last water land and the words sink before answering
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
