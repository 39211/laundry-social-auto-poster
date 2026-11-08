// OPS-L1-10: use with ops-l1-offline.config.ts; never load credentials or use sockets.
import { vi } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import net from "node:net";
import { resolve, relative, basename } from "node:path";

vi.mock("dotenv", () => ({ config: () => ({ parsed: {} }) }));
vi.mock("../../src/facebookLostAlert", async original => ({
  ...await original<object>(), existingStaffGroup: () => async () => false
}));
Object.assign(process.env, {
  PUBLIC_SITE_BASE_URL: "https://sixiangjialaundry.com",
  PUBLIC_IMAGE_BASE_URL: "https://assets.invalid",
  META_ACCESS_TOKEN: "offline-fixture",
  FB_PAGE_ID: "fb-fixture",
  IG_USER_ID: "ig-fixture",
  DRY_RUN: "true"
});
const root = resolve(process.cwd());
function guard(path: unknown): void {
  if (typeof path !== "string" && !(path instanceof URL)) return;
  const name = path instanceof URL ? path.pathname : path;
  const rel = relative(root, resolve(name)).replaceAll("\\", "/");
  if (basename(name) === ".env" || /^(?:data\/(?!posted-log\/|gates\/)|logs\/)/i.test(rel)) {
    throw new Error("OPS_L1_FORBIDDEN_READ");
  }
}
for (const name of ["readFileSync", "openSync"] as const) {
  const original = fs[name];
  vi.spyOn(fs, name).mockImplementation(((path: unknown, ...args: unknown[]) => {
    guard(path);
    return (original as Function)(path, ...args);
  }) as never);
}
for (const name of ["readFile", "open"] as const) {
  const original = fsp[name];
  vi.spyOn(fsp, name).mockImplementation(((path: unknown, ...args: unknown[]) => {
    guard(path);
    return (original as Function)(path, ...args);
  }) as never);
}
const connect = net.Socket.prototype.connect;
vi.spyOn(net.Socket.prototype, "connect").mockImplementation(function (this: net.Socket, ...args: unknown[]) {
  // Vitest IPC uses pipes; TCP, TLS and real HTTP are forbidden.
  const first = args[0] as { path?: string; port?: number } | string | number;
  if (typeof first === "number" || (typeof first === "object" && first?.port !== undefined)) {
    throw new Error("OPS_L1_NETWORK_DISABLED");
  }
  return (connect as Function).apply(this, args);
} as never);
globalThis.fetch = async () => { throw new Error("OPS_L1_NETWORK_DISABLED: supply a fake fetch"); };
