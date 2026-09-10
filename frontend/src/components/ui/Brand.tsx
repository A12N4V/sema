/**
 * The mark: a real dSPM source estimate of a seizure.
 *
 * Not a drawing of one. `scripts/make_logo.py` puts a 3 Hz spike-and-wave
 * discharge on a left temporal cortical patch, projects it to a 10-20 montage
 * through the fsaverage forward model, and then recovers it with the same
 * `apply_inverse_raw` the Source workspace runs on real recordings. What you
 * are looking at is 20,484 dipoles solved from 24 simulated electrodes. It is
 * the picture the tool makes, made by the tool.
 *
 * Two renders come out of that one estimate. The full one keeps the gyral and
 * sulcal shading; the small one flattens the cortex to plain grey, because
 * curvature banding is high-frequency detail with no meaning at 22px and it
 * takes the activation down with it when the browser resamples. Same data,
 * same colours, less carrier. `size` picks between them.
 */
export function Mark({ size = 22, className }: { size?: number; className?: string }) {
  const src = size >= 72 ? "/mark-full.png" : "/mark.png";
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: "auto", display: "block" }}
    />
  );
}

/**
 * Mark + wordmark.
 *
 * The name is set in the mono face, uppercase, widely tracked: the app has two
 * voices, a grotesque for prose and a monospace for data, and the wordmark
 * belongs to the second. It should read as the label on an instrument rather
 * than as a sentence.
 */
export function Wordmark({ name = "Sema", tagline }: { name?: string; tagline?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <Mark size={26} className="text-fg-dim" />
      <span className="mono text-sm font-medium uppercase tracking-[0.28em] text-fg">{name}</span>
      {tagline && <span className="text-sm text-fg-faint max-[520px]:hidden">{tagline}</span>}
    </div>
  );
}
