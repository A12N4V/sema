import { useEffect, useRef } from "react";
import { paint } from "../../lib/plot/paint";
import { useStore } from "../../store/store";

/**
 * A slow field of drifting EEG-like traces, drawn behind the launcher.
 *
 * The only decorative canvas in the app, and it earns its place by being the
 * thing the app is about: it is not an abstract particle mesh, it is sixteen
 * channels of band-limited noise with the occasional alpha burst, drawn the
 * same way the real waveform is drawn. Someone who has looked at EEG will
 * recognise it before they read a word of the page.
 *
 * Kept honest: very low contrast so it never competes with the buttons in
 * front of it, and it stops dead under `prefers-reduced-motion` (drawing one
 * static frame rather than nothing, so the texture survives).
 */
export function SignalField({ rows = 16 }: { rows?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const themeTick = useStore((s) => s.themeTick);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const p = paint(themeTick);

    // Per-row oscillator bank. Each row sums a few sines at EEG-ish rates with
    // its own phases, so no two rows ever line up and the field never loops
    // visibly. Frozen at mount: the animation is the phase advance, not this.
    const bank = Array.from({ length: rows }, (_, r) => ({
      parts: Array.from({ length: 4 }, (_, k) => ({
        // 1-12 Hz mapped to something readable at this scale
        w: 0.6 + k * 1.5 + (r % 5) * 0.35,
        a: (1.1 - k * 0.2) * (0.6 + ((r * 37) % 11) / 22),
        ph: (r * 1.7 + k * 2.3) % (Math.PI * 2),
      })),
      // an alpha-burst envelope, off-phase per row
      burstPh: (r * 0.9) % (Math.PI * 2),
      speed: 0.55 + ((r * 13) % 7) / 14,
    }));

    let raf = 0;
    let t0 = performance.now();

    const frame = (now: number) => {
      const t = (now - t0) / 1000;
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      if (w > 2 && h > 2) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
        if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        const gap = h / (rows + 1);
        const amp = Math.min(gap * 0.46, 26);
        ctx.lineWidth = 1;
        ctx.lineJoin = "round";

        for (let r = 0; r < rows; r++) {
          const b = bank[r];
          const y0 = gap * (r + 1);
          // rows fade out toward the bottom, so the text sitting low on the
          // page always has the quietest ground under it
          const fade = 0.45 + 0.55 * Math.cos((r / rows) * Math.PI);
          const burst = 0.55 + 0.45 * Math.sin(t * 0.5 * b.speed + b.burstPh);
          ctx.strokeStyle = p.accent;
          ctx.globalAlpha = 0.2 * fade + 0.13 * burst * fade;
          ctx.beginPath();
          const step = 3;
          for (let x = 0; x <= w; x += step) {
            const u = x / 60 + t * b.speed;
            let v = 0;
            for (const q of b.parts) v += q.a * Math.sin(u * q.w + q.ph);
            v *= 0.5 + 0.8 * burst;
            const y = y0 + v * amp * 0.6;
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      if (!reduced) raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    // one late repaint so the first frame is not drawn into a zero-size box
    const late = setTimeout(() => {
      t0 = performance.now();
      frame(performance.now());
    }, 120);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(late);
    };
  }, [rows, themeTick]);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
}
