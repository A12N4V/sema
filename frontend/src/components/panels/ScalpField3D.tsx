import { useMemo, useRef, useState } from "react";
import { Panel } from "./Panel";
import { usePanelData } from "./usePanelData";
import { useCanvas } from "../../lib/plot/useCanvas";
import { diverging } from "../../lib/plot/scales";
import { paint } from "../../lib/plot/paint";
import { api, type FieldResult, type BandPowerResult } from "../../api/client";
import { useStore } from "../../store/store";
import { useSignatureKey } from "../../store/useSignatureKey";

const RINGS = 30;
const SEG = 56;
const RADIUS = 1.16;

/** IDW-interpolated polar grid over the scalp disc + precomputed weights. */
function buildGrid(pos2d: [number, number][]) {
  const nElec = pos2d.length;
  const pts: [number, number][] = [];
  for (let ri = 0; ri <= RINGS; ri++) {
    const r = (ri / RINGS) * RADIUS;
    for (let aj = 0; aj <= SEG; aj++) {
      const a = (aj / SEG) * Math.PI * 2;
      pts.push([r * Math.cos(a), r * Math.sin(a)]);
    }
  }
  const weights = new Float32Array(pts.length * nElec);
  for (let i = 0; i < pts.length; i++) {
    const [vx, vy] = pts[i];
    let sum = 0;
    for (let e = 0; e < nElec; e++) {
      const dx = vx - pos2d[e][0];
      const dy = vy - pos2d[e][1];
      const w = 1 / (dx * dx + dy * dy + 0.01);
      weights[i * nElec + e] = w;
      sum += w;
    }
    for (let e = 0; e < nElec; e++) weights[i * nElec + e] /= sum;
  }
  return { pts, weights, nElec };
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function FieldSurface({ pos2d, values }: { pos2d: [number, number][]; values: number[] }) {
  const grid = useMemo(() => buildGrid(pos2d), [pos2d]);
  const themeTick = useStore((s) => s.themeTick);
  const rot = useRef({ az: -0.5, el: 0.8, zoom: 1 });
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [nonce, setNonce] = useState(0);
  const force = () => setNonce((n) => n + 1);

  // per-vertex height (normalized) + colour
  const vz = useMemo(() => {
    const maxAbs = Math.max(1e-9, ...values.map((v) => Math.abs(v)));
    const z = new Float32Array(grid.pts.length);
    for (let i = 0; i < grid.pts.length; i++) {
      let val = 0;
      for (let e = 0; e < grid.nElec; e++) val += grid.weights[i * grid.nElec + e] * values[e];
      const [x, y] = grid.pts[i];
      const f = smoothstep(RADIUS, 0.7, Math.hypot(x, y));
      z[i] = (val / maxAbs) * f;
    }
    return z;
  }, [grid, values]);

  const canvasRef = useCanvas(({ ctx, width, height }) => {
    const pal = paint(themeTick);
    const { az, el, zoom } = rot.current;
    const ca = Math.cos(az), sa = Math.sin(az);
    const ce = Math.cos(el), se = Math.sin(el);
    const scale = Math.min(width * 0.62, height) * 0.62 * zoom;
    const cx = width / 2;
    const cy = height / 2 + scale * 0.18;
    const H = 0.6; // height exaggeration

    const project = (x: number, y: number, z: number) => {
      // rotate about vertical axis, then oblique-tilt: points further back
      // (+ry) and higher (+z) move up on screen.
      const rx = x * ca - y * sa;
      const ry = x * sa + y * ca;
      return {
        sx: cx + rx * scale,
        sy: cy - ry * ce * scale - z * H * scale,
        depth: ry * se + z * H,
      };
    };

    const cols = SEG + 1;
    type Quad = { path: [number, number][]; color: string; depth: number };
    const quads: Quad[] = [];
    const light = [0.35, 0.45, 0.82];
    const ln = Math.hypot(light[0], light[1], light[2]);

    for (let ri = 0; ri < RINGS; ri++) {
      for (let aj = 0; aj < SEG; aj++) {
        const i00 = ri * cols + aj;
        const i10 = i00 + 1;
        const i01 = i00 + cols;
        const i11 = i01 + 1;
        const idx = [i00, i10, i11, i01];
        const world = idx.map((k) => [grid.pts[k][0], grid.pts[k][1], vz[k]] as [number, number, number]);
        const proj = world.map((w) => project(w[0], w[1], w[2]));
        // normal from two edges
        const e1 = [world[1][0] - world[0][0], world[1][1] - world[0][1], world[1][2] - world[0][2]];
        const e2 = [world[3][0] - world[0][0], world[3][1] - world[0][1], world[3][2] - world[0][2]];
        const nx = e1[1] * e2[2] - e1[2] * e2[1];
        const ny = e1[2] * e2[0] - e1[0] * e2[2];
        const nz = e1[0] * e2[1] - e1[1] * e2[0];
        const nn = Math.hypot(nx, ny, nz) || 1;
        const lambert = Math.max(0.15, (nx * light[0] + ny * light[1] + nz * light[2]) / (nn * ln));
        const shade = 0.55 + 0.75 * lambert;
        const zc = (vz[i00] + vz[i10] + vz[i01] + vz[i11]) / 4;
        const [r, g, b] = diverging(zc);
        quads.push({
          path: proj.map((p) => [p.sx, p.sy] as [number, number]),
          color: `rgb(${Math.min(255, r * shade) | 0},${Math.min(255, g * shade) | 0},${Math.min(255, b * shade) | 0})`,
          depth: (proj[0].depth + proj[2].depth) / 2,
        });
      }
    }
    quads.sort((a, b) => a.depth - b.depth);
    for (const q of quads) {
      ctx.beginPath();
      ctx.moveTo(q.path[0][0], q.path[0][1]);
      for (let k = 1; k < 4; k++) ctx.lineTo(q.path[k][0], q.path[k][1]);
      ctx.closePath();
      ctx.fillStyle = q.color;
      ctx.fill();
      ctx.strokeStyle = q.color;
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }

    // electrodes
    const maxAbs = Math.max(1e-9, ...values.map((v) => Math.abs(v)));
    pos2d.forEach((p, i) => {
      const pr = project(p[0], p[1], (values[i] / maxAbs) * smoothstep(RADIUS, 0.7, Math.hypot(p[0], p[1])) + 0.02);
      ctx.beginPath();
      ctx.arc(pr.sx, pr.sy, 2, 0, Math.PI * 2);
      ctx.fillStyle = pal.bg;
      ctx.fill();
      ctx.strokeStyle = pal.textFaint;
      ctx.lineWidth = 0.75;
      ctx.stroke();
    });

    // head ring
    ctx.beginPath();
    for (let a = 0; a <= 64; a++) {
      const ang = (a / 64) * Math.PI * 2;
      const pr = project(1.1 * Math.cos(ang), 1.1 * Math.sin(ang), 0);
      if (a === 0) ctx.moveTo(pr.sx, pr.sy);
      else ctx.lineTo(pr.sx, pr.sy);
    }
    ctx.strokeStyle = pal.gridStrong;
    ctx.lineWidth = 1;
    ctx.stroke();
    // nose
    const n1 = project(-0.12, 1.09, 0), n2 = project(0, 1.26, 0), n3 = project(0.12, 1.09, 0);
    ctx.beginPath();
    ctx.moveTo(n1.sx, n1.sy);
    ctx.lineTo(n2.sx, n2.sy);
    ctx.lineTo(n3.sx, n3.sy);
    ctx.strokeStyle = pal.gridStrong;
    ctx.stroke();
  }, [vz, pos2d, values, nonce, themeTick]);

  return (
    <canvas
      ref={canvasRef}
      className="block h-full w-full cursor-grab active:cursor-grabbing"
      onPointerDown={(e) => {
        drag.current = { x: e.clientX, y: e.clientY };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        rot.current.az += (e.clientX - drag.current.x) * 0.01;
        rot.current.el = Math.max(0.15, Math.min(1.45, rot.current.el + (e.clientY - drag.current.y) * 0.006));
        drag.current = { x: e.clientX, y: e.clientY };
        force();
      }}
      onPointerUp={(e) => {
        drag.current = null;
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      }}
      onWheel={(e) => {
        rot.current.zoom = Math.max(0.6, Math.min(2, rot.current.zoom - e.deltaY * 0.001));
        force();
      }}
    />
  );
}

export function ScalpField3D() {
  const session = useStore((s) => s.session);
  const layout = useStore((s) => s.layout);
  const t = useStore((s) => s.t);
  const band = useStore((s) => s.band);
  const [mode, setMode] = useState<"cursor" | "band">("cursor");

  const id = session?.session_id;
  const tq = Math.round(t * 10) / 10;
  const sigKey = useSignatureKey();

  const field = usePanelData<FieldResult | null>(
    () => (id && layout?.has_montage ? api.field(id, tq, layout.channels) : Promise.resolve(null)),
    [id, tq, sigKey, layout?.channels.join(",")],
    { enabled: !!id && mode === "cursor" && !!layout?.has_montage, debounceMs: 50, label: "Scalp field" },
  );
  const bandData = usePanelData<BandPowerResult | null>(
    () => (id ? api.bandPower(id) : Promise.resolve(null)),
    [id, sigKey],
    { enabled: !!id && mode === "band" && !!layout?.has_montage, label: "Band field" },
  );

  const values = useMemo(() => {
    if (!layout?.has_montage) return null;
    if (mode === "cursor") return field.data?.values ?? null;
    const bd = bandData.data;
    if (!bd) return null;
    const idx = new Map(bd.channels.map((c, i) => [c, i]));
    const raw = layout.channels.map((c) => bd.bands[band]?.[idx.get(c) ?? -1] ?? 0);
    const mean = raw.reduce((a, b) => a + b, 0) / raw.length;
    return raw.map((v) => v - mean);
  }, [mode, field.data, bandData.data, band, layout]);

  const state = mode === "cursor" ? field.state : bandData.state;

  return (
    <Panel
      title="Scalp field" fkey="F2"
      state={layout?.has_montage ? state : "ready"}
      error={mode === "cursor" ? field.error : bandData.error}
      emptyHint="Computing field…"
      right={
        <div className="flex overflow-hidden rounded-xs border border-seam text-2xs">
          <button className={`px-1.5 py-0.5 transition-colors ${mode === "cursor" ? "bg-accent/15 text-accent" : "text-fg-faint hover:text-fg-dim"}`} onClick={() => setMode("cursor")}>at cursor</button>
          <button className={`border-l border-seam px-1.5 py-0.5 transition-colors ${mode === "band" ? "bg-accent/15 text-accent" : "text-fg-faint hover:text-fg-dim"}`} onClick={() => setMode("band")}>{band}</button>
        </div>
      }
    >
      {!layout?.has_montage ? (
        <div className="flex h-full items-center justify-center p-6 text-center text-xs text-fg-faint">
          No montage set — use the Montage control in the toolbar to place electrodes.
        </div>
      ) : !values ? (
        <div className="flex h-full items-center justify-center text-xs text-fg-faint">Computing field…</div>
      ) : (
        <FieldSurface pos2d={layout.pos2d} values={values} />
      )}
    </Panel>
  );
}
