import { useEffect, useRef } from "react";
import styles from "./WindStreams.module.css";

// WindStreams: flytende vind-strømmer i Tesla-stil. Myke, bølgende hvite
// linjer som undulerer og flyter horisontalt, tegnet på canvas med glød og
// additiv blending så de overlapper som røyk.
export function WindStreams() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const STREAMS = 16;
    const streams = Array.from({ length: STREAMS }, (_, i) => {
      const t = STREAMS === 1 ? 0.5 : i / (STREAMS - 1); // 0..1 vertikalt
      const center = 1 - Math.abs(t - 0.5) * 2; // 1 i midten, 0 ved kant
      return {
        y: 0.12 + t * 0.76, // hold seg innenfor med margin
        amp: 5 + center * 16 + Math.random() * 6,
        f1: 0.8 + Math.random() * 1.2,
        f2: 1.8 + Math.random() * 1.8,
        phase: Math.random() * Math.PI * 2,
        undulate: 0.5 + Math.random() * 0.7,
        travel: 0.35 + Math.random() * 0.5, // horisontal flyt-fart
        width: 1 + center * 2 + Math.random() * 0.8,
        alpha: 0.05 + center * 0.14 + Math.random() * 0.04,
        glow: 6 + center * 12,
      };
    });

    let w = 0;
    let h = 0;
    function resize() {
      if (!canvas || !ctx) return;
      const r = canvas.getBoundingClientRect();
      w = r.width;
      h = r.height;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let raf = 0;
    let running = true;
    const start = performance.now();

    function frame(now: number) {
      if (!running || !ctx) return;
      const time = (now - start) / 1000;
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";

      const seg = Math.max(28, Math.floor(w / 8));
      for (const s of streams) {
        const y0 = s.y * h;
        ctx.beginPath();
        for (let j = 0; j <= seg; j++) {
          const xN = j / seg;
          const a = xN * Math.PI * 2;
          // To bølge-komponenter som reiser horisontalt (flyt) + undulasjon.
          const yy =
            y0 +
            Math.sin(a * s.f1 + s.phase - time * s.travel) * s.amp +
            Math.sin(a * s.f2 - time * s.undulate + s.phase) * s.amp * 0.4;
          const x = xN * w;
          if (j === 0) ctx.moveTo(x, yy);
          else ctx.lineTo(x, yy);
        }
        // Fade i begge ender så strømmene glir inn og ut (Tesla-look).
        const g = ctx.createLinearGradient(0, 0, w, 0);
        g.addColorStop(0, "rgba(255,255,255,0)");
        g.addColorStop(0.18, `rgba(255,255,255,${s.alpha})`);
        g.addColorStop(0.82, `rgba(255,255,255,${s.alpha})`);
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.strokeStyle = g;
        ctx.lineWidth = s.width;
        ctx.shadowColor = "rgba(255,255,255,0.6)";
        ctx.shadowBlur = s.glow;
        ctx.stroke();
      }
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
