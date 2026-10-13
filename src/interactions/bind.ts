/**
 * Declarative binding — one call to `bind()` wires up every element
 * carrying a `data-cuelume-*` attribute:
 *
 *   data-cuelume-tap       → click
 *   data-cuelume-type      → keydown that edits text (the marked field only)
 *   data-cuelume-select    → change on a native <select>/<input>, otherwise click
 *   data-cuelume-toggle    → click
 *   data-cuelume-open      → click
 *   data-cuelume-close     → click
 *   data-cuelume-navigate  → click
 *
 * A cue sounds as the gesture goes down and lets go as it lifts. A mouse
 * plays the press on pointerdown and the release on the click that follows;
 * touch and pen play both on lift, so a scroll that starts on a button stays
 * silent; keyboard activation plays both at once. A typed key presses on
 * keydown and lets go on keyup.
 *
 * Deprecated, kept for the v0.3 migration window and removed in 1.0:
 *
 *   data-cuelume-hover     → pointerenter (fine mouse, throttled), plays `select`
 *   data-cuelume-press     → pointerdown, plays `tap`
 *   data-cuelume-release   → pointerup, plays `tap` unless the element also has press
 *
 * Delegated listeners resolve attributes when each event fires, so later
 * DOM additions, removals, and clones work without rescanning. When
 * annotated elements nest, the innermost one decides the cue.
 *
 * Each binding also passes along what the event says about the interaction:
 * the key pressed, which way a selection moved, whether a toggle is switching
 * on or off, and what did the clicking. `data-cuelume-emphasis`, on the
 * element or any ancestor, sets how much the action matters, and
 * `data-cuelume-theme` sets the material the same way. Nothing is stored
 * beyond the page's memory.
 */

import { playInContext, type Part } from "../audio/engine.js";
import type { Context, Emphasis, InputMethod, KeyRole } from "../sounds/context.js";
import { resolveSound, type SoundName } from "../sounds/recipes.js";
import type { ThemeName } from "../sounds/themes.js";

const HOVER_GAP_MS = 150;
const TYPE_GAP_MS = 40;
/** Chrome reports keydowns that belong to an IME composition with this code. */
const IME_KEY_CODE = 229;

const CLICK_CUES: Record<string, SoundName> = {
  "data-cuelume-tap": "tap",
  "data-cuelume-select": "select",
  "data-cuelume-toggle": "toggle",
  "data-cuelume-open": "open",
  "data-cuelume-close": "close",
  "data-cuelume-navigate": "navigate",
};
const CLICK_SELECTOR = Object.keys(CLICK_CUES).map((attr) => `[${attr}]`).join();

/** Each bound root: how many callers hold it, and the signal that removes its listeners. */
const bound = new WeakMap<ParentNode, { holders: number; listeners: AbortController }>();
const handledEvents = new WeakSet<Event>();
const lastPlayed = { hover: -Infinity, type: -Infinity };
/** The last selected index per select group, so the next pick knows which way it moved. */
const lastSelected = new WeakMap<Element, number>();
/** The element a pointer pressed, waiting for its click to let go. */
let pressed: Element | null = null;
/** Keys whose keydown played `type`, waiting for their keyup. By code: lifting Shift first renames a key, "A" to "a". */
const typed = new Set<string>();

type Match = [element: HTMLElement, attr: string, fallback: SoundName, context?: Context, part?: Part] | null;

function throttled(kind: keyof typeof lastPlayed, gapMs: number): boolean {
  const now = performance.now();
  if (now - lastPlayed[kind] < gapMs) return true;
  lastPlayed[kind] = now;
  return false;
}

function isMouse(event: PointerEvent): boolean {
  return (
    event.pointerType === "mouse" && window.matchMedia("(hover: hover) and (pointer: fine)").matches
  );
}

/** Native controls report a new selection through `change`; clicking one only opens it. */
function isNativeControl(element: Element): boolean {
  return element.tagName === "SELECT" || element.tagName === "INPUT";
}

/** Whether Backspace or Delete would remove anything right now. */
function deletes(event: KeyboardEvent, field: HTMLElement): boolean {
  const { selectionStart: start, selectionEnd: end, value } = field as HTMLInputElement;
  // contenteditable, and inputs such as email that hide their caret, can't tell
  if (typeof start !== "number" || typeof end !== "number") return true;
  if (start !== end) return true;
  return event.key === "Backspace" ? start > 0 : end < value.length;
}

function keyRole(key: string): KeyRole {
  if (key === " ") return "space";
  if (key === "Enter") return "enter";
  return key === "Backspace" || key === "Delete" ? "delete" : "printable";
}

/** What activated a click. Keyboard activation (Enter, Space) reports detail 0. */
function inputMethod(event: Event): InputMethod | undefined {
  const { detail, pointerType } = event as PointerEvent;
  if (detail === 0) return "keyboard";
  return pointerType === "mouse" || pointerType === "touch" || pointerType === "pen" ? pointerType : undefined;
}

/** 1 when `index` is later in `group` than the last pick, -1 when earlier, else none. */
function moved(group: Element, index: number, keep = true): Context["direction"] {
  const previous = lastSelected.get(group);
  if (!(index >= 0)) return undefined;
  if (keep) lastSelected.set(group, index);
  if (previous === undefined || previous === index) return undefined;
  return index > previous ? 1 : -1;
}

/** Whether an option is marked chosen through ARIA. */
function isChosen(option: Element): boolean {
  return option.getAttribute("aria-checked") === "true" || option.getAttribute("aria-selected") === "true";
}

/**
 * Direction for a custom option, counted among its marked siblings. The first
 * pick in a group starts from the option ARIA marks as chosen: this listener
 * runs in the capture phase, before the app moves that state.
 */
function siblingDirection(option: HTMLElement, keep = true): Context["direction"] {
  const group = option.parentElement;
  if (!group) return undefined;
  const options = Array.from(group.children).filter((child) => child.hasAttribute("data-cuelume-select"));
  if (!lastSelected.has(group)) {
    const chosen = options.findIndex(isChosen);
    if (chosen >= 0) lastSelected.set(group, chosen);
  }
  return moved(group, options.indexOf(option), keep);
}

/**
 * Which way a toggle is switching: 1 on, -1 off. A native checkbox or radio
 * has already changed when its click is dispatched, but not on pointerdown,
 * when a radio can only switch on. ARIA state has changed in neither: the app
 * flips it in its own handler, after these capture listeners.
 */
function switched(element: HTMLElement, beforeClick = false): Context["direction"] {
  const { type, checked } = element as HTMLInputElement;
  if (type === "radio") return beforeClick || checked ? 1 : -1;
  if (type === "checkbox") return checked !== beforeClick ? 1 : -1;
  const state = element.getAttribute("aria-checked") ?? element.getAttribute("aria-pressed");
  if (state === "true") return -1;
  return state === "false" ? 1 : undefined;
}

function isTypingKey(event: KeyboardEvent, field: HTMLElement): boolean {
  if (event.isComposing || event.keyCode === IME_KEY_CODE) return false;
  if ((field as HTMLInputElement).type === "password") return false;
  // Deleting is an edit with any modifier (word, line) and keeps going while held.
  if (event.key === "Backspace" || event.key === "Delete") return deletes(event, field);
  if (event.repeat) return false;
  // AltGr reports as Ctrl+Alt and still types a character.
  if (event.metaKey || (event.ctrlKey && !event.altKey)) return false;
  // Enter submits a single-line input rather than editing it.
  if (event.key === "Enter") return field.tagName !== "INPUT";
  return event.key.length === 1;
}

function match(root: ParentNode, event: Event, attr: string, fallback: SoundName): Match {
  if (!(event.target instanceof Element)) return null;
  const element = event.target.closest<HTMLElement>(`[${attr}]`);
  return element && (root as Node).contains(element) ? [element, attr, fallback] : null;
}

function listen(root: ParentNode, signal: AbortSignal, eventName: string, find: (event: Event) => Match): void {
  (root as EventTarget).addEventListener(
    eventName,
    (event) => {
      if (handledEvents.has(event)) return;
      const found = find(event);
      if (!found) return;
      handledEvents.add(event);
      const [element, attr, fallback, context = {}, part] = found;
      const emphasis = element.closest("[data-cuelume-emphasis]")?.getAttribute("data-cuelume-emphasis");
      const theme = element.closest("[data-cuelume-theme]")?.getAttribute("data-cuelume-theme");
      playInContext(
        resolveSound(element.getAttribute(attr)) ?? fallback,
        { emphasis: emphasis as Emphasis, theme: theme as ThemeName },
        context,
        part,
        // a key holds its own press, so keys that overlap each let go; a pointer has no code
        (event as KeyboardEvent).code,
      );
    },
    { capture: true, signal },
  );
}

/**
 * Delegates `data-cuelume-*` interactions under `root` (default: the whole
 * document). Safe during SSR and safe to call repeatedly for the same root.
 *
 * Returns its undo, for a component that unmounts or a module that hot
 * reloads. A root stays bound until every caller that bound it has let go.
 */
export function bind(root?: ParentNode): () => void {
  if (typeof document === "undefined") return () => {};
  const scope = root ?? document;
  const binding = bound.get(scope) ?? { holders: 0, listeners: new AbortController() };
  let holding = true;
  const unbind = () => {
    if (!holding) return;
    holding = false;
    if (--binding.holders > 0) return;
    binding.listeners.abort();
    bound.delete(scope);
  };
  if (binding.holders++ > 0) return unbind;
  bound.set(scope, binding);
  const { signal } = binding.listeners;

  /** The marked element an event activates, its attribute, and the control inside a marked label. */
  const clicked = (event: Event) => {
    if (!(event.target instanceof Element)) return null;
    const element = event.target.closest<HTMLElement>(CLICK_SELECTOR);
    if (!element || !(scope as Node).contains(element)) return null;
    const control = element.tagName === "LABEL" ? (element as HTMLLabelElement).control : null;
    const inside = control && element.contains(control) ? control : null;
    // a disabled control gets pointer events but never the click that would let go
    if ((inside ?? element).matches(":disabled")) return null;
    const attr = Object.keys(CLICK_CUES).find((name) => element.hasAttribute(name))!;
    if (attr === "data-cuelume-select" && isNativeControl(element)) return null;
    return { element, attr, inside };
  };
  const direction = (element: HTMLElement, attr: string, inside: HTMLElement | null, beforeClick: boolean) =>
attr === "data-cuelume-select" ? siblingDirection(element, !beforeClick) : attr === "data-cuelume-toggle" ? switched(inside ?? element, beforeClick) : undefined;

  listen(scope, signal, "click", (event) => {
    const found = clicked(event);
    if (!found) return null;
    const { element, attr, inside } = found;
    // A label around its control gets two clicks, its own and the one it forwards
    // to the control. Only the forwarded one plays, and it reads the control's state.
    if (inside && event.target !== inside) return null;
    if (pressed === element) {
      pressed = null;
      // the press only read which way a select moved; this click makes the pick
      direction(element, attr, inside, false);
      return [element, attr, CLICK_CUES[attr], {}, "release"];
    }
    return [element, attr, CLICK_CUES[attr], { input: inputMethod(event), direction: direction(element, attr, inside, false) }];
  });

  listen(scope, signal, "pointerdown", (event) => {
    // a press abandoned without a click or a cancel is over once another pointer goes down
    pressed = null;
    // Only a mouse presses here. A finger or a pen may be starting a scroll, and neither's
    // pointerdown unlocks audio; both play whole on the click.
    const { pointerType, button } = event as PointerEvent;
    const found = pointerType === "mouse" && !(button > 0) ? clicked(event) : null;
    if (found) {
      const { element, attr, inside } = found;
      pressed = element;
      // pointerdown reports detail 0, so inputMethod would call this a keyboard
      return [element, attr, CLICK_CUES[attr], { input: "mouse", direction: direction(element, attr, inside, true) }, "press"];
    }
    const legacy = match(scope, event, "data-cuelume-press", "tap");
    return legacy && [legacy[0], legacy[1], legacy[2], { input: inputMethod(event) }];
  });

  (scope as EventTarget).addEventListener("pointercancel", () => (pressed = null), { capture: true, signal });

  listen(scope, signal, "change", (event) => {
    const found = match(scope, event, "data-cuelume-select", "select");
    if (!found || !isNativeControl(found[0])) return null;
    const [element, attr, fallback] = found;
    return [element, attr, fallback, { direction: moved(element, (element as HTMLSelectElement).selectedIndex) }];
  });

  listen(scope, signal, "keydown", (event) => {
    // a press abandoned without a click or a cancel is over once a key goes down
    pressed = null;
    const found = match(scope, event, "data-cuelume-type", "type");
    if (!found || found[0] !== event.target) return null;
    const key = event as KeyboardEvent;
    if (!isTypingKey(key, found[0]) || throttled("type", TYPE_GAP_MS)) return null;
    typed.add(key.code);
    const [element, attr, fallback] = found;
    return [element, attr, fallback, { key: keyRole(key.key) }, "press"];
  });

  listen(scope, signal, "keyup", (event) => {
    // the key is done wherever it lifts, even if focus left the field
    if (!typed.delete((event as KeyboardEvent).code)) return null;
    const found = match(scope, event, "data-cuelume-type", "type");
    return found && found[0] === event.target ? [found[0], found[1], found[2], {}, "release"] : null;
  });

  listen(scope, signal, "pointerenter", (event) => {
    const found = match(scope, event, "data-cuelume-hover", "select");
    if (!found || !isMouse(event as PointerEvent)) return null;
    const relatedTarget = (event as PointerEvent).relatedTarget;
    if (relatedTarget instanceof Node && found[0].contains(relatedTarget)) return null;
    return throttled("hover", HOVER_GAP_MS) ? null : found;
  });

  listen(scope, signal, "pointerup", (event) => {
    const found = match(scope, event, "data-cuelume-release", "tap");
    return found && !found[0].hasAttribute("data-cuelume-press") ? found : null;
  });

  return unbind;
}
