#!/usr/bin/env node
// Free a TCP port, on macOS/Linux and Windows alike.
//
// Port 4000 frequently holds a stale `tsx src/server.ts` from an earlier
// session; this replaces the two OS-specific recipes (lsof/kill vs.
// Get-NetTCPConnection/Stop-Process) with one command:
//
//   npm run kill-port          # defaults to 4000
//   npm run kill-port -- 4031  # any other port
//
// Exits 0 whether or not anything was listening -- "already free" is success.

import { execFileSync } from "node:child_process";

const port = Number(process.argv[2] ?? process.env.PORT ?? 4000);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`kill-port: "${process.argv[2]}" is not a valid port`);
  process.exit(1);
}

const run = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    // Non-zero exit just means "no matches" for both lsof and netstat.
    return "";
  }
};

/** @returns {number[]} pids listening on `port` */
function findPids() {
  if (process.platform === "win32") {
    // netstat rows: Proto  Local Address  Foreign Address  State  PID
    return [
      ...new Set(
        run("netstat", ["-ano"])
          .split(/\r?\n/)
          .filter((line) => /^\s*TCP\s/.test(line) && /LISTENING/i.test(line))
          .filter((line) => new RegExp(`[:.]${port}\\s`).test(line))
          .map((line) => Number(line.trim().split(/\s+/).pop()))
          .filter((pid) => Number.isInteger(pid) && pid > 0),
      ),
    ];
  }
  return [
    ...new Set(
      run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"])
        .split(/\s+/)
        .map(Number)
        .filter((pid) => Number.isInteger(pid) && pid > 0),
    ),
  ];
}

const pids = findPids();

if (pids.length === 0) {
  console.log(`port ${port}: already free`);
  process.exit(0);
}

for (const pid of pids) {
  if (process.platform === "win32") {
    run("taskkill", ["/PID", String(pid), "/F"]);
  } else {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone, or not ours to kill.
    }
  }
  console.log(`port ${port}: killed PID ${pid}`);
}

const remaining = findPids();
if (remaining.length > 0) {
  console.error(`port ${port}: STILL IN USE by ${remaining.join(", ")}`);
  process.exit(1);
}
console.log(`port ${port}: free`);
