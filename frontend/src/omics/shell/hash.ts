/**
 * The selection spine in the URL: #g=<gene>&sets=<n1,n2>. Set *contents* live
 * in localStorage (they are bulky); the hash names them, so a link restores
 * which gene and which named sets are in front of a colleague. Read once on
 * load; written whenever the gene or the set list changes. Page and run state
 * stay out of the hash – the store already persists those per browser.
 */
import { useStore } from "../store";

export const readHash = () => {
  const h = new URLSearchParams(location.hash.replace(/^#/, ""));
  const g = h.get("g");
  if (g) useStore.getState().set({ gene: g });
};
