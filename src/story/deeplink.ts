/**
 * The current scene in the url hash, `#el_nino`: a link opens the story on
 * that scene. The hash never reaches the server, so a CMS page is not
 * affected; `replaceState` keeps the back button for leaving the page, not
 * for stepping back through the scenes.
 */

/** Index of the scene named by the hash, or -1 when it names none. */
export function sceneFromHash(hash: string, ids: readonly string[]): number {
  let id = hash.replace(/^#/, "");
  try {
    id = decodeURIComponent(id);
  } catch {
    return -1;
  }
  return id ? ids.indexOf(id) : -1;
}

/** Hash for a scene: none on the opening scene, so the home url stays plain. */
export function hashFor(ids: readonly string[], index: number): string {
  return index > 0 && ids[index] ? `#${encodeURIComponent(ids[index])}` : "";
}

/** Url with its hash replaced, or removed when `hash` is empty. */
export function withHash(
  location: Pick<Location, "pathname" | "search">,
  hash: string,
): string {
  return `${location.pathname}${location.search}${hash}`;
}

/** Settle time before the hash follows the scene: a jump crosses many. */
const SETTLE_MS = 500;

export interface DeepLink {
  /** Scene to open on, from the hash at mount; -1 for none. */
  start: number;
  /** The active scene changed: the hash follows once it settles. */
  set(index: number): void;
  destroy(): void;
}

export function mountDeepLink(
  win: Window,
  ids: readonly string[],
  onHash: (index: number) => void,
): DeepLink {
  let timer = 0;
  // A hash typed or followed while the page is open.
  const onChange = () => {
    const index = sceneFromHash(win.location.hash, ids);
    if (index >= 0) {
      onHash(index);
    }
  };
  win.addEventListener("hashchange", onChange);
  return {
    start: sceneFromHash(win.location.hash, ids),
    set(index) {
      win.clearTimeout(timer);
      timer = win.setTimeout(() => {
        const hash = hashFor(ids, index);
        if (hash !== win.location.hash) {
          win.history.replaceState(
            win.history.state,
            "",
            withHash(win.location, hash),
          );
        }
      }, SETTLE_MS);
    },
    destroy() {
      win.clearTimeout(timer);
      win.removeEventListener("hashchange", onChange);
    },
  };
}
