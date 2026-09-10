import { useStore } from "../store/store";

/** One container the app filled in on its own, and the small print behind it. */
export interface Derivation {
  container: string;
  label: string;
  call: string;
  assumptions: string[];
  seconds: number;
}

/**
 * The auto-derivation record for a container, or undefined when the contents
 * are the user's own work. Lives outside the component file so fast refresh
 * still works on the components that use it.
 */
export function useDerivation(container?: string): Derivation | undefined {
  const auto = useStore((s) => s.autoDerived);
  return container ? auto?.[container] : undefined;
}
