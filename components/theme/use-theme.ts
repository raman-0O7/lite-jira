"use client";

import { useSyncExternalStore } from "react";

import { isThemePreference, THEME_STORAGE_KEY, type ThemePreference } from "@/lib/theme";

const listeners = new Set<() => void>();
const DARK_QUERY = "(prefers-color-scheme: dark)";

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : "dark";
  } catch {
    return "dark";
  }
}

function resolve(preference: ThemePreference): "dark" | "light" {
  if (preference !== "system") return preference;
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

function apply() {
  document.documentElement.classList.toggle("dark", resolve(readPreference()) === "dark");
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const media = window.matchMedia(DARK_QUERY);
  // Another tab changed the preference, or the OS theme flipped under "system".
  window.addEventListener("storage", apply);
  media.addEventListener("change", apply);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", apply);
    media.removeEventListener("change", apply);
  };
}

/** Encoded as "preference:resolved" so one snapshot carries both. */
function snapshot() {
  const preference = readPreference();
  return `${preference}:${resolve(preference)}`;
}

/** The viewer's theme preference and what it resolves to, plus a setter. */
export function useTheme() {
  const value = useSyncExternalStore(subscribe, snapshot, () => "dark:dark");
  const [preference, resolved] = value.split(":") as [ThemePreference, "dark" | "light"];

  function setTheme(next: ThemePreference) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private mode: the change still applies to this page.
    }
    apply();
    if (next !== readPreference()) {
      document.documentElement.classList.toggle("dark", resolve(next) === "dark");
    }
  }

  return {
    preference,
    resolved,
    setTheme,
    toggle: () => setTheme(resolved === "dark" ? "light" : "dark"),
  };
}
