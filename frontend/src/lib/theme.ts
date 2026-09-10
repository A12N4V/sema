// Theme = one of "system" | "light" | "dark", persisted in localStorage and
// reflected onto <html data-theme>. "system" removes the attribute so the
// @media (prefers-color-scheme) rules in index.css take over.

export type Theme = "system" | "light" | "dark";

const KEY = "sema:theme";

export function readTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* private mode / disabled storage */
  }
  return "system";
}

/** Apply to the document + persist. Returns the resolved "light"|"dark". */
export function applyTheme(theme: Theme): "light" | "dark" {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* ignore */
  }
  return resolved(theme);
}

export function resolved(theme: Theme): "light" | "dark" {
  if (theme !== "system") return theme;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}
