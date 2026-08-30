import { useEffect, useRef } from "react";

/** Restore URL-backed controls without remounting an experiment or losing unrelated UI state. */
export function useHistoryRestore(restore: (params: URLSearchParams) => void) {
  const latestRestore = useRef(restore);
  useEffect(() => { latestRestore.current = restore; });
  useEffect(() => {
    const onPopState = () => latestRestore.current(new URLSearchParams(window.location.search));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
}
