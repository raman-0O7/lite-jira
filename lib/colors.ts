/**
 * Stable colors for things that have no color of their own (people, projects),
 * derived from an id or key so the same thing always gets the same color.
 * Every color carries white text in both themes.
 */

const PALETTE = [
  "#5E6AD2",
  "#B4610F",
  "#2B6CB0",
  "#2F855A",
  "#9B4DCA",
  "#C53D5E",
  "#0E7C86",
  "#8A6A12",
  "#4A5BBF",
  "#B5482A",
] as const;

function hash(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function colorFor(seed: string): string {
  return PALETTE[hash(seed) % PALETTE.length]!;
}
