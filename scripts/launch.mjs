import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lockPath = path.resolve(rootDir, ".buildtutor.lock");
const serverPath = path.resolve(rootDir, "build", "index.js");

async function readLock() {
  try {
    const raw = await readFile(lockPath, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed?.pid === "number") {
      return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function flushPrevious() {
  const lock = await readLock();
  if (!lock || lock.pid === process.pid) {
    return;
  }

  if (!isAlive(lock.pid)) {
    return;
  }

  try {
    process.kill(lock.pid, "SIGTERM");
  } catch {
    // ignore and try a harder stop below
  }

  await new Promise((resolve) => setTimeout(resolve, 1000));

  if (isAlive(lock.pid)) {
    try {
      process.kill(lock.pid, "SIGKILL");
    } catch {
      // ignore
    }
  }
}

async function main() {
  await flushPrevious();

  const child = spawn(process.execPath, [serverPath], {
    cwd: rootDir,
    env: process.env,
    stdio: "inherit",
  });

  process.on("SIGINT", () => {
    child.kill("SIGINT");
  });
  process.on("SIGTERM", () => {
    child.kill("SIGTERM");
  });

  child.on("exit", (code, signal) => {
    process.exit(signal ? 1 : code ?? 0);
  });
}

main().catch((error) => {
  console.error("buildtutor launcher failed:", error);
  process.exit(1);
});
