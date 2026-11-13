import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, chmod, readFile, writeFile, access, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const wrapper = path.join(repo, "scripts/launchd-run.sh");
const service = path.join(repo, "scripts/prod-service.sh");

async function tempDir(prefix) {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

async function writeExecutable(file, contents) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, contents);
  await chmod(file, 0o755);
}

test("launchd wrapper waits at the hold before reading build artifacts and resumes with the promoted build", async (t) => {
  const root = await tempDir("sampolio-hold-wrapper-");
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, "home");
  const app = path.join(root, "app");
  const hold = path.join(home, ".sampolio/run/deploy-hold");
  const data = path.join(home, ".sampolio/data");
  const marker = path.join(root, "node-started");
  const envFile = path.join(root, "launchd.env");
  const fakeNode = path.join(root, "fake-node");
  await mkdir(path.join(home, ".sampolio/run"), { recursive: true });
  await mkdir(data, { recursive: true });
  await writeExecutable(fakeNode, `#!/bin/sh\nprintf '%s\n' "$NEXT_DIST_DIR" > "$SAMPOLIO_TEST_MARKER"\n`);
  await writeFile(hold, "held\n", { mode: 0o600 });
  await writeFile(envFile, [
    `ENCRYPTION_KEY=synthetic-key`,
    `AUTH_SECRET=synthetic-secret`,
    `AUTH_URL=http://localhost:4999`,
    `DATA_DIR=${data}`,
    `SAMPOLIO_NODE=${fakeNode}`,
    `NEXT_DIST_DIR=.next-prod`,
    `PORT=4999`,
    `HOSTNAME=127.0.0.1`,
    "",
  ].join("\n"), { mode: 0o600 });
  await chmod(envFile, 0o600);

  const child = spawn("/bin/bash", [wrapper], {
    env: {
      ...process.env,
      HOME: home,
      SAMPOLIO_ENV_FILE: envFile,
      SAMPOLIO_DEPLOY_HOLD_FILE: hold,
      SAMPOLIO_REPO_ROOT: app,
      SAMPOLIO_TEST_MARKER: marker,
    },
    stdio: "ignore",
  });
  t.after(() => child.kill("SIGTERM"));
  await delay(150);
  await assert.rejects(access(marker));

  await mkdir(path.join(app, "node_modules/next/dist/bin"), { recursive: true });
  await mkdir(path.join(app, ".next-prod"), { recursive: true });
  await writeFile(path.join(app, "node_modules/next/dist/bin/next"), "fixture\n");
  await writeFile(path.join(app, ".next-prod/BUILD_ID"), "fixture-build\n");
  await rm(hold);
  const result = await new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  assert.deepEqual(result, { code: 0, signal: null });
  assert.equal((await readFile(marker, "utf8")).trim(), ".next-prod");
});

test("launchd wrapper fails closed on invalid configuration even when a hold exists", async (t) => {
  const root = await tempDir("sampolio-hold-invalid-");
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = path.join(root, "app");
  const home = path.join(root, "home");
  const hold = path.join(root, "hold");
  const marker = path.join(root, "node-started");
  const envFile = path.join(root, "launchd.env");
  const fakeNode = path.join(root, "fake-node");
  await mkdir(path.join(app, "node_modules/next/dist/bin"), { recursive: true });
  await mkdir(path.join(app, ".next-prod"), { recursive: true });
  await mkdir(home, { recursive: true });
  await writeFile(path.join(app, "node_modules/next/dist/bin/next"), "fixture\n");
  await writeFile(path.join(app, ".next-prod/BUILD_ID"), "fixture-build\n");
  await writeExecutable(fakeNode, `#!/bin/sh\nprintf started > "$SAMPOLIO_TEST_MARKER"\n`);
  await writeFile(hold, "held\n", { mode: 0o600 });
  await writeFile(envFile, `AUTH_SECRET=missing-encryption-key\n`, { mode: 0o600 });
  await chmod(envFile, 0o600);

  const result = await run("/bin/bash", [wrapper], {
    env: { ...process.env, HOME: home, SAMPOLIO_ENV_FILE: envFile, SAMPOLIO_DEPLOY_HOLD_FILE: hold, SAMPOLIO_REPO_ROOT: app, SAMPOLIO_NODE: fakeNode, SAMPOLIO_TEST_MARKER: marker },
  });
  assert.equal(result.code, 78);
  assert.match(result.stderr, /ENCRYPTION_KEY is not set/);
  await assert.rejects(access(marker));
});

test("system hold and release isolate their flag and refuse GUI mode", async (t) => {
  const root = await tempDir("sampolio-hold-service-");
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = path.join(root, "bin");
  const hold = path.join(root, "private/run/deploy-hold");
  const state = path.join(root, "signaled");
  const pidFile = path.join(root, "pid");
  const fakeCurl = path.join(bin, "curl");
  const fakeLaunchctl = path.join(bin, "launchctl");
  const fakeLsof = path.join(bin, "lsof");
  const fakeSignal = path.join(bin, "signal");
  const failedSignal = path.join(bin, "signal-fails");
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    SAMPOLIO_DEPLOY_HOLD_FILE: hold,
    SAMPOLIO_RESTART_WAIT: "4",
    SAMPOLIO_PORT: "4999",
    MOCK_LAUNCHD_STATE: state,
    MOCK_PID_FILE: pidFile,
    MOCK_GUI: "0",
    SAMPOLIO_SIGNAL_COMMAND: fakeSignal,
  };
  await writeExecutable(fakeCurl, `#!/bin/sh\nprintf 200\n`);
  await writeExecutable(fakeLsof, `#!/bin/sh\nexit 0\n`);
  await writeExecutable(fakeLaunchctl, `#!/bin/sh\nif [ "$1" != print ]; then exit 0; fi\ncase "$2" in\n  gui/*) [ "$MOCK_GUI" = 1 ] && exit 0 || exit 1 ;;\n  system/*) if [ -f "$MOCK_LAUNCHD_STATE" ]; then echo 'pid = 424242'; else printf 'pid = '; cat "$MOCK_PID_FILE"; fi; exit 0 ;;\n  *) exit 1 ;;\nesac\n`);
  await writeExecutable(fakeSignal, `#!/bin/sh\n[ "$1" = -TERM ] || exit 2\nkill -TERM "$2"\ntouch "$MOCK_LAUNCHD_STATE"\n`);
  await writeExecutable(failedSignal, `#!/bin/sh\nexit 1\n`);

  const child = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>process.exit(0)); setInterval(()=>{},1000)"], { stdio: "ignore" });
  t.after(() => child.kill("SIGKILL"));
  await writeFile(pidFile, String(child.pid));
  const held = await run("/bin/bash", [service, "hold"], { env });
  assert.equal(held.code, 0, held.stderr);
  assert.match(held.stdout, /listener closed/);
  assert.equal((await readFile(hold, "utf8")).trim(), "");

  const released = await run("/bin/bash", [service, "release"], { env });
  assert.equal(released.code, 0, released.stderr);
  assert.match(released.stdout, /healthy/);
  await assert.rejects(access(hold));

  env.MOCK_GUI = "1";
  const refused = await run("/bin/bash", [service, "hold"], { env });
  assert.notEqual(refused.code, 0);
  assert.match(refused.stderr, /system-domain only/);
  await assert.rejects(access(hold));

  env.MOCK_GUI = "0";
  env.SAMPOLIO_SIGNAL_COMMAND = failedSignal;
  const failedHold = await run("/bin/bash", [service, "hold"], { env });
  assert.notEqual(failedHold.code, 0);
  assert.match(failedHold.stderr, /hold remains active/);
  await access(hold);
  await rm(hold);
});
