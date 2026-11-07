// Vite's Windows realpath probe normally executes `net use`. Keep this run offline
// and compatible with the restricted process sandbox; no production code changes.
import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { EventEmitter } from "node:events";
const exec = cp.exec;
cp.exec = function (command, ...args) {
  if (command === "net use") {
    const callback = args.at(-1);
    queueMicrotask(() => callback(new Error("offline drive probe disabled"), "", ""));
    return new EventEmitter();
  }
  return exec.call(this, command, ...args);
};
syncBuiltinESMExports();
