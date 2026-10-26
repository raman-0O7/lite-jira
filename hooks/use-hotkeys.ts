"use client";

import { useEffect, useRef } from "react";

/**
 * Keyboard shortcuts. Keys are written like "c", "/", "?", "escape", "enter",
 * "mod+k" (⌘ on macOS, Ctrl elsewhere), or two-key sequences like "g p".
 *
 * Shortcuts are ignored while the user types in a field, except "mod+…" and
 * "escape", and plain keys never fire with ⌘/Ctrl/Alt held. A handler that
 * returns `false` declines the key, which then keeps its default behaviour.
 */
export type Hotkeys = Record<string, (event: KeyboardEvent) => void | boolean>;

const SEQUENCE_TIMEOUT = 1000;

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  const type = (target as HTMLInputElement).type;
  return !["checkbox", "radio", "button", "submit", "reset"].includes(type);
}

function keyName(event: KeyboardEvent): string {
  const key = event.key.toLowerCase();
  return key === "esc" ? "escape" : key;
}

function run(handler: Hotkeys[string], event: KeyboardEvent) {
  if (handler(event) !== false) event.preventDefault();
}

export function useHotkeys(hotkeys: Hotkeys, enabled = true) {
  // Always call the latest handlers without re-subscribing on every render.
  const ref = useRef(hotkeys);
  useEffect(() => {
    ref.current = hotkeys;
  });

  useEffect(() => {
    if (!enabled) return;
    let pending: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing) return;
      const bindings = ref.current;
      const key = keyName(event);
      const mod = event.metaKey || event.ctrlKey;

      if (mod) {
        const handler = bindings[`mod+${key}`];
        if (handler && !event.altKey) run(handler, event);
        return;
      }
      if (event.altKey) return;
      if (isTypingTarget(event.target) && key !== "escape") return;

      if (pending) {
        const handler = bindings[`${pending} ${key}`];
        pending = null;
        clearTimeout(timer);
        if (handler) {
          run(handler, event);
          return;
        }
      }
      if (Object.keys(bindings).some((binding) => binding.startsWith(`${key} `))) {
        pending = key;
        clearTimeout(timer);
        timer = setTimeout(() => (pending = null), SEQUENCE_TIMEOUT);
        return;
      }
      const handler = bindings[key];
      if (handler) run(handler, event);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      clearTimeout(timer);
    };
  }, [enabled]);
}
