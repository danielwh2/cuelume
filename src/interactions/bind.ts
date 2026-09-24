/**
 * Declarative binding — one call to `bind()` wires up every element
 * carrying a `data-cuelume-*` attribute:
 *
 *   data-cuelume-tap       → plays on click
 *   data-cuelume-type      → plays on eligible keydown (rate-limited)
 *   data-cuelume-select    → plays on change for a native <select>, otherwise on click
 *   data-cuelume-toggle    → plays on click
 *   data-cuelume-open      → plays on click
 *   data-cuelume-close     → plays on click
 *   data-cuelume-navigate  → plays on click
 *
 * Kept for one migration release:
 *
 *   data-cuelume-hover     → plays on pointerenter (fine mouse, throttled)
 *   data-cuelume-press     → plays on pointerdown
 *   data-cuelume-release   → plays on pointerup
 *
 * Delegated listeners resolve attributes when each event fires, so later
 * DOM additions, removals, and clones work without rescanning.
 */

import { play } from "../audio/engine.js";
import { isSoundName, type SoundName } from "../sounds/recipes.js";

const HOVER_GAP_MS = 150;
const TYPE_GAP_MS = 35;
/** Non-printable keys that still count as typing. */
const EDIT_KEYS = new Set(["Backspace", "Delete", "Enter"]);
const CLICK_CUES: readonly SoundName[] = ["tap", "select", "toggle", "open", "close", "navigate"];

const boundRoots = new WeakSet<ParentNode>();
const handledEvents = new WeakSet<Event>();

let lastHoverTime = -Infinity;
let lastTypeTime = -Infinity;

function resolve(el: HTMLElement, attr: string, fallback: SoundName): SoundName {
  const requested = el.getAttribute(attr);
  return isSoundName(requested) ? requested : fallback;
}

function isMouse(event: PointerEvent): boolean {
  return (
    event.pointerType === "mouse" && window.matchMedia("(hover: hover) and (pointer: fine)").matches
  );
}

function isNativeSelect(target: EventTarget | null): boolean {
  return target instanceof Element && target.tagName === "SELECT";
}

function findTarget(root: ParentNode, event: Event, attr: string): HTMLElement | null {
  if (!(event.target instanceof Element)) return null;
  const element = event.target.closest<HTMLElement>(`[${attr}]`);
  return element && (root as Node).contains(element) ? element : null;
}

function listen(
  root: ParentNode,
  eventName: string,
  attr: string,
  fallback: SoundName,
  accept: (event: Event, element: HTMLElement) => boolean = () => true,
): void {
  (root as EventTarget).addEventListener(
    eventName,
    (event) => {
      const element = findTarget(root, event, attr);
      if (!element || handledEvents.has(event) || !accept(event, element)) return;
      handledEvents.add(event);
      play(resolve(element, attr, fallback));
    },
    true,
  );
}

function acceptHover(event: Event, element: HTMLElement): boolean {
  const pointer = event as PointerEvent;
  if (!isMouse(pointer)) return false;
  if (pointer.relatedTarget instanceof Node && element.contains(pointer.relatedTarget)) return false;

  const now = performance.now();
  if (now - lastHoverTime < HOVER_GAP_MS) return false;
  lastHoverTime = now;
  return true;
}

function acceptType(event: Event): boolean {
  const key = event as KeyboardEvent;
  if (key.isComposing || key.repeat || key.metaKey || key.ctrlKey || key.altKey) return false;
  if (key.key.length !== 1 && !EDIT_KEYS.has(key.key)) return false;
  if ((key.target as HTMLInputElement | null)?.type === "password") return false;

  const now = performance.now();
  if (now - lastTypeTime < TYPE_GAP_MS) return false;
  lastTypeTime = now;
  return true;
}

/**
 * Delegates `data-cuelume-*` interactions under `root` (default: the whole
 * document). Safe during SSR and safe to call repeatedly for the same root.
 */
export function bind(root?: ParentNode): void {
  if (typeof document === "undefined") return;
  const scope = root ?? document;
  if (boundRoots.has(scope)) return;
  boundRoots.add(scope);

  for (const cue of CLICK_CUES) {
    // A native <select> plays on change (below), never when merely opened.
    listen(scope, "click", `data-cuelume-${cue}`, cue, (event) => !isNativeSelect(event.target));
  }
  listen(scope, "change", "data-cuelume-select", "select", (event) => isNativeSelect(event.target));
  listen(scope, "keydown", "data-cuelume-type", "type", acceptType);

  listen(scope, "pointerenter", "data-cuelume-hover", "select", acceptHover);
  listen(scope, "pointerdown", "data-cuelume-press", "tap");
  listen(scope, "pointerup", "data-cuelume-release", "select");
}
