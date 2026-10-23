import { execSync } from "node:child_process";

/** Bring the test database's schema up to date before any test file runs. */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ??
    "postgresql://postgres:postgres@localhost:5432/task_management_test?schema=public";
  const dbName = new URL(url).pathname.slice(1);
  if (!dbName.endsWith("_test")) {
    throw new Error(`Refusing to run tests against "${dbName}": name must end in _test`);
  }
  execSync("pnpm prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
    stdio: "ignore",
  });
}
