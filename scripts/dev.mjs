


import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

const portIndex = process.argv.indexOf("--port");
const port = (portIndex >= 0 ? process.argv[portIndex + 1] : process.env.PORT) || "3000";
const built = process.argv.includes("--built");
const env = {
  ...process.env,
  API_PORT: "4000",
  APP_ORIGIN: process.env.APP_ORIGIN || `http://localhost:${port}`,
};

// The demo uses an embedded PostgreSQL engine and fictional sample data.
// Regular development connects to the PostgreSQL URL in .env.
if (process.env.ACCOUNTS_PREVIEW === "1" || process.argv.includes("--demo")) {
  Object.assign(env, {
    DEV_EMBEDDED_DB: "1",
    DEMO_MODE: "true",
    SEED_DEMO: "true",
    ADMIN_EMAIL: "demo@ledgerdesk.local",
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || randomBytes(24).toString("hex"),
    DEV_DEMO_LOGIN: "1",
    COOKIE_SECURE: "false",
  });
}

// On Windows, npm is a .cmd script. Launch it through cmd.exe; POSIX shells
// can execute npm directly. windowsVerbatimArguments preserves cmd syntax.
const windows = process.platform === "win32";
const npmCommand = windows ? process.env.ComSpec || "cmd.exe" : "npm";
const npmArgs = (args) => windows
  ? ["/d", "/s", "/c", "npm", ...args]
  : args;
const childOptions = {
  env,
  stdio: "inherit",
  ...(windows ? { windowsVerbatimArguments: true } : {}),
};

const api = spawn(npmCommand, npmArgs(["run", built ? "start" : "dev", "-w", "@accounts/api"]), childOptions);
const web = spawn(npmCommand, npmArgs(["run", built ? "start" : "dev", "-w", "@accounts/web", "--", "--port", port]), childOptions);

let stopping = false;
let exitCode = 0;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  exitCode = code;
  if (!api.killed) api.kill("SIGTERM");
  if (!web.killed) web.kill("SIGTERM");
  setTimeout(() => process.exit(exitCode), 300).unref();
}

for (const child of [api, web]) {
  child.on("error", (error) => {
    console.error(`Could not start ${windows ? "npm.cmd" : "npm"}:`, error.message);
    stop(1);
  });
  child.on("exit", (code, signal) => {
    if (!stopping) stop(code ?? (signal ? 1 : 0));
  });
}

process.on("SIGTERM", () => stop());
process.on("SIGINT", () => stop());
