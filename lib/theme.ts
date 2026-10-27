/**
 * Theme preference: dark by default (Kanso is dark-first), light, or follow the
 * system. Stored per browser in localStorage and applied as the `.dark` class
 * on <html>. The root layout renders `.dark` and runs THEME_SCRIPT before first
 * paint, so a light-theme reload never flashes dark.
 */

export type ThemePreference = "dark" | "light" | "system";

export const THEME_STORAGE_KEY = "kanso-theme";

export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});var d=t==="light"?false:t==="system"?window.matchMedia("(prefers-color-scheme: dark)").matches:true;document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "dark" || value === "light" || value === "system";
}
