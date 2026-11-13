#!/usr/bin/env node
/** Isolated browser/build fixture: synthetic data and throwaway keys only. */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { measureStaticBundles } from "./bundle-metrics.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2] ?? "dev";
if (!["dev", "build", "serve", "serve-built", "seed"].includes(mode))
  throw new Error("Use browser-fixture.mjs dev|build|serve|serve-built|seed");
if (Number(process.versions.node.split(".")[0]) !== 26)
  throw new Error("Use the repository Node26 runtime");
const distDir = process.env.SAMPOLIO_FIXTURE_DIST_DIR ?? ".next";
if (![".next", ".next-prod"].includes(distDir))
  throw new Error("SAMPOLIO_FIXTURE_DIST_DIR must be .next or .next-prod");
if (mode === "serve-built" && !existsSync(join(root, distDir, "BUILD_ID")))
  throw new Error("Build the selected synthetic fixture before serve-built");
const envFiles = readdirSync(root).filter(
  (name) => name.startsWith(".env") && name !== ".env.example",
);
if (envFiles.length)
  throw new Error(
    "Synthetic fixture refuses workspace .env files or symlinks. Use a clean worktree.",
  );
const fixtureDir = mkdtempSync(join(tmpdir(), "sampolio-browser-"));
const env = { ...process.env };
const token = randomBytes(24).toString("hex");
writeFileSync(join(fixtureDir, ".synthetic-fixture"), token, { mode: 0o600 });
for (const name of Object.keys(env)) {
  if (name.startsWith("ENABLE_BANKING_") || name.startsWith("HA_"))
    env[name] = "";
}
Object.assign(env, {
  DATA_DIR: fixtureDir,
  SAMPOLIO_SYNTHETIC_FIXTURE_DIR: fixtureDir,
  SAMPOLIO_SYNTHETIC_TOKEN: token,
  AUTH_URL: "http://localhost:4999",
  AUTH_SECRET: randomBytes(32).toString("hex"),
  ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  HA_WEBHOOK_URL: "",
  ENABLE_BANKING_APP_ID: "",
  ENABLE_BANKING_REDIRECT_URL: "",
  ENABLE_BANKING_PRIVATE_KEY_FILE: "",
  ENABLE_BANKING_BASE_URL: "",
  SAMPOLIO_DEV_EXTERNAL_APIS: "",
  DEV_AUTH_BYPASS: "",
  NEXT_DIST_DIR: distDir,
  NEXT_TELEMETRY_DISABLED: "1",
});
// Let Next choose its own NODE_ENV; never inherit a production environment.
delete env.NODE_ENV;
let child;
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    stopping = true;
    child?.kill(signal);
  });
async function run(args, seed = false) {
  return new Promise((resolveExit) => {
    child = spawn(
      process.execPath,
      seed
        ? ["--import", "tsx", join(root, "e2e/seed.ts")]
        : [join(root, "node_modules/next/dist/bin/next"), ...args],
      {
        cwd: root,
        env,
        stdio: "inherit",
      },
    );
    child.once("error", (error) => {
      console.error(error.message);
      resolveExit(1);
    });
    child.once("exit", (code, signal) => resolveExit(code ?? (signal ? 1 : 0)));
  });
}
try {
  let code = await run([], true);
  if (code === 0 && ["build", "serve"].includes(mode) && !stopping)
    code = await run(["build"]);
  if (code === 0 && ["build", "serve"].includes(mode)) {
    const metrics = measureStaticBundles(join(root, distDir, "static"));
    writeFileSync(
      join(root, "test-results/synthetic-bundle.json"),
      JSON.stringify(metrics, null, 2),
    );
    console.log(
      `[synthetic] aggregate static gzip: JS ${metrics[".js"].gzip_bytes}, CSS ${metrics[".css"].gzip_bytes} bytes (all chunks)`,
    );
  }
  if (code === 0 && !stopping && !["build", "seed"].includes(mode)) {
    code = await run([
      ["serve", "serve-built"].includes(mode) ? "start" : "dev",
      "-H",
      "127.0.0.1",
      "-p",
      "4999",
    ]);
  }
  process.exitCode = code;
} finally {
  rmSync(fixtureDir, { recursive: true, force: true });
}
