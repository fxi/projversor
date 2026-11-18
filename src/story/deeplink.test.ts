import { describe, expect, it, vi } from "vitest";
import { hashFor, mountDeepLink, sceneFromHash, withHash } from "./deeplink";

const ids = ["home", "el_nino", "walker", "été"];

describe("sceneFromHash", () => {
  it("finds the scene named by the hash", () => {
    expect(sceneFromHash("#el_nino", ids)).toBe(1);
    expect(sceneFromHash("walker", ids)).toBe(2);
    expect(sceneFromHash("#%C3%A9t%C3%A9", ids)).toBe(3);
  });
  it("names no scene for an empty, unknown or broken hash", () => {
    expect(sceneFromHash("", ids)).toBe(-1);
    expect(sceneFromHash("#", ids)).toBe(-1);
    expect(sceneFromHash("#fires", ids)).toBe(-1);
    expect(sceneFromHash("#%E0%A4%A", ids)).toBe(-1);
  });
});

describe("hashFor", () => {
  it("names the scene, except the opening one", () => {
    expect(hashFor(ids, 1)).toBe("#el_nino");
    expect(hashFor(ids, 3)).toBe("#%C3%A9t%C3%A9");
    expect(hashFor(ids, 0)).toBe("");
    expect(hashFor(ids, -1)).toBe("");
    expect(hashFor(ids, 9)).toBe("");
  });
  it("round-trips through sceneFromHash", () => {
    ids.slice(1).forEach((_, i) => {
      expect(sceneFromHash(hashFor(ids, i + 1), ids)).toBe(i + 1);
    });
  });
});

describe("withHash", () => {
  it("keeps the path and the query", () => {
    const at = { pathname: "/fr/", search: "?lang=fr" };
    expect(withHash(at, "#walker")).toBe("/fr/?lang=fr#walker");
    expect(withHash(at, "")).toBe("/fr/?lang=fr");
  });
});

describe("mountDeepLink", () => {
  const fakeWindow = (hash: string) => {
    const location = { pathname: "/", search: "", hash };
    const listeners = new Map<string, () => void>();
    const replaceState = vi.fn((_: unknown, __: string, url: string) => {
      location.hash = url.includes("#") ? url.slice(url.indexOf("#")) : "";
    });
    const win = {
      location,
      history: { state: null, replaceState },
      setTimeout,
      clearTimeout,
      addEventListener: (type: string, fn: () => void) =>
        listeners.set(type, fn),
      removeEventListener: (type: string) => listeners.delete(type),
    } as unknown as Window;
    return { win, location, listeners, replaceState };
  };

  it("opens on the hashed scene and replaces the hash once it settles", () => {
    vi.useFakeTimers();
    const { win, replaceState } = fakeWindow("#walker");
    const link = mountDeepLink(win, ids, () => {});
    expect(link.start).toBe(2);
    link.set(1);
    link.set(2);
    link.set(3);
    expect(replaceState).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(replaceState).toHaveBeenLastCalledWith(null, "", "/#%C3%A9t%C3%A9");
    link.set(0);
    vi.runAllTimers();
    expect(replaceState).toHaveBeenLastCalledWith(null, "", "/");
    link.set(0);
    vi.runAllTimers();
    expect(replaceState).toHaveBeenCalledTimes(2);
    link.destroy();
    vi.useRealTimers();
  });

  it("follows a hash changed while open, and stops when destroyed", () => {
    const { win, location, listeners } = fakeWindow("");
    const onHash = vi.fn();
    const link = mountDeepLink(win, ids, onHash);
    expect(link.start).toBe(-1);
    location.hash = "#el_nino";
    listeners.get("hashchange")?.();
    location.hash = "#nowhere";
    listeners.get("hashchange")?.();
    expect(onHash).toHaveBeenCalledTimes(1);
    expect(onHash).toHaveBeenCalledWith(1);
    link.destroy();
    expect(listeners.has("hashchange")).toBe(false);
  });
});
