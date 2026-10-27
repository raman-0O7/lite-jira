/** The app's public origin, for links that leave the app (invite emails). */
export function appUrl(): string {
  return (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}
