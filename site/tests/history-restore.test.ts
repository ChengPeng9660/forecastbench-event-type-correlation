import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useHistoryRestore } from "../src/lib/useHistoryRestore";

describe("URL history restoration", () => {
  it("reads the current query using the latest callback on popstate", () => {
    const first = vi.fn();
    const current = vi.fn();
    const { rerender, unmount } = renderHook(({ callback }) => useHistoryRestore(callback), { initialProps: { callback: first } });
    rerender({ callback: current });
    act(() => {
      window.history.replaceState(null, "", "/?gain_model=GPT-5-2025-08-07&near_bi=0#gain");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(first).not.toHaveBeenCalled();
    expect(current).toHaveBeenCalledTimes(1);
    expect(current.mock.calls[0][0].get("gain_model")).toBe("GPT-5-2025-08-07");
    expect(current.mock.calls[0][0].get("near_bi")).toBe("0");
    unmount();
    act(() => { window.dispatchEvent(new PopStateEvent("popstate")); });
    expect(current).toHaveBeenCalledTimes(1);
    window.history.replaceState(null, "", "/");
  });
});
