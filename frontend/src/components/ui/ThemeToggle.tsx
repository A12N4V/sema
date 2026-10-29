import { useId } from "react";
import { clsx } from "clsx";
import { useStore } from "../../store/store";

/**
 * Light/dark switch shared by every top bar. One SVG morphs between the two:
 * in light the disc is a sun with its rays out; in dark a second disc slides
 * over it through a mask to carve a crescent while the rays fold in and the
 * whole glyph turns. Pure CSS transitions, so reduced-motion just snaps.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const dark = useStore((s) => s.resolvedTheme) === "dark";
  const setTheme = useStore((s) => s.setTheme);
  const mask = useId();
  const label = dark ? "Switch to light theme" : "Switch to dark theme";
  const ease = "motion-safe:transition-all motion-safe:duration-500 motion-safe:ease-[cubic-bezier(.5,1.5,.5,1)]";

  return (
    <button onClick={() => setTheme(dark ? "light" : "dark")} aria-label={label} title={label}
            className={clsx("group flex shrink-0 items-center px-2 text-fg-faint transition-colors hover:text-fg", className)}>
      <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden
           className={clsx(ease, "origin-center group-active:scale-90", dark ? "rotate-[-40deg]" : "rotate-90")}>
        <mask id={mask}>
          <rect width="24" height="24" fill="white" />
          <circle r="7" fill="black" className={ease} style={{ cx: dark ? 17 : 32, cy: dark ? 7 : -8 }} />
        </mask>
        <circle cx="12" cy="12" fill="currentColor" mask={`url(#${mask})`} className={ease} style={{ r: dark ? 8.5 : 5 }} />
        <g stroke="currentColor" strokeWidth="2" strokeLinecap="round"
           className={clsx(ease, "origin-center", dark ? "scale-0 opacity-0" : "scale-100 opacity-100")}>
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
            <line key={a} x1="12" y1="2.5" x2="12" y2="4.5" transform={`rotate(${a} 12 12)`} />
          ))}
        </g>
      </svg>
    </button>
  );
}
