/** The suggested git branch for an issue: "web-42-fix-login-redirect" (max 60 chars). */
export function branchName(key: string, title: string) {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${key.toLowerCase()}-${slug}`.slice(0, 60).replace(/-+$/, "");
}
