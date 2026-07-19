import { useEffect, useRef } from "react";
import styles from "./WindStreams.module.css";

// Fragment-shader: domenevridd fBm-noise som advekteres horisontalt → myk,
// volumetrisk vind (selve vind-feltet, ikke bare tråder). Lyse streker
// legger seg oppå tettheten som flagrende drag.
const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for(int i = 0; i < 6; i++){ v += a * noise(p); p *= 2.02; a *= 0.5; }
  return v;
}

void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  // Bredere i x enn y → strømmene strekkes horisontalt (vind-retning).
  vec2 p = vec2(uv.x * 3.2, uv.y * 2.4);
  float t = uTime * 0.16;

  // Domenevridning i to nivåer → virvlende, organisk flyt.
  vec2 q = vec2(
    fbm(p + vec2(0.0, 0.0) + vec2(t, 0.0)),
    fbm(p + vec2(5.2, 1.3) - vec2(t * 0.6, 0.0))
  );
  vec2 r = vec2(
    fbm(p + 1.7 * q + vec2(t * 1.4, 0.0) + vec2(1.7, 9.2)),
    fbm(p + 1.7 * q - vec2(t * 1.1, 0.0) + vec2(8.3, 2.8))
  );
  float f = fbm(p + 2.2 * r + vec2(t, 0.0));

  // Tetthet (vind-feltet) + lyse streker oppå.
  float dens = pow(clamp(f, 0.0, 1.0), 1.7);
  float streak = smoothstep(0.52, 0.86, f);

  // Vertikalt bånd: konsentrer i midten, mykt ut mot topp/bunn.
  float band = smoothstep(0.02, 0.4, uv.y) * (1.0 - smoothstep(0.6, 0.98, uv.y));
  // Horisontal ende-fade.
  float edge = smoothstep(0.0, 0.14, uv.x) * (1.0 - smoothstep(0.86, 1.0, uv.x));

  float bright = (dens * 0.55 + streak * 0.85) * band * edge;
  bright = clamp(bright, 0.0, 1.0);

  // Premultiplisert hvit glød.
  gl_FragColor = vec4(vec3(bright), bright);
}
`;

const VERT = `
attribute vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }
`;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  return sh;
}

export function WindStreams() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: true,
    });
    if (!gl) return;

    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    // Full-skjerm-trekant.
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW
    );
    const aPos = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, "uRes");
    const uTime = gl.getUniformLocation(prog, "uTime");

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;
    function resize() {
      if (!canvas || !gl) return;
      const r = canvas.getBoundingClientRect();
      w = Math.max(1, Math.floor(r.width * dpr));
      h = Math.max(1, Math.floor(r.height * dpr));
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let raf = 0;
    let running = true;
    const start = performance.now();
    function frame(now: number) {
      if (!running || !gl) return;
      gl.uniform2f(uRes, w, h);
      gl.uniform1f(uTime, (now - start) / 1000);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <div className={styles.streams}>
      <canvas ref={canvasRef} className={styles.canvas} />
    </div>
  );
}
