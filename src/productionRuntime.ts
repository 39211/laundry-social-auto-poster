import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

/**
 * Native media and paid-generation executors are not allowed to come from
 * PATH.  This mirrors scripts/_production-contract.ps1: production accepts an
 * absolute Program Files executable only when its hash is pinned in the
 * checked-in runtime allowlist.  Empty allowlists are intentionally blockers.
 */
const RUNTIME_DEFINITIONS = {
  ffmpeg: { leaf: "ffmpeg.exe", testEnvironmentVariable: "LAUNDRY_TRUSTED_FFMPEG_EXE" },
  ffprobe: { leaf: "ffprobe.exe", testEnvironmentVariable: "LAUNDRY_TRUSTED_FFPROBE_EXE" },
  python: { leaf: "python.exe", testEnvironmentVariable: "LAUNDRY_TRUSTED_PYTHON_EXE" },
  "generate-shot": { leaf: "generate-shot.ps1", testEnvironmentVariable: "LAUNDRY_TRUSTED_GENERATE_SHOT_PS1" }
} as const;

export type ProductionRuntimeName = keyof typeof RUNTIME_DEFINITIONS;

export type TrustedRuntimeResolver = (
  name: ProductionRuntimeName,
  root: string
) => Promise<string> | string;

export interface RuntimeResolverOptions {
  /**
   * A pure unit-test seam.  Production entry points never supply this; their
   * resolution always uses the immutable checked-in allowlist below.
   */
  runtimeResolver?: TrustedRuntimeResolver;
}

export class TrustedProductionRuntimeError extends Error {
  readonly code = "TRUSTED_PRODUCTION_RUNTIME_UNAVAILABLE";
  readonly runtime: ProductionRuntimeName;

  constructor(runtime: ProductionRuntimeName, detail?: string) {
    super(
      `Trusted allowlisted ${runtime} runtime could not be established` +
        (detail ? `: ${detail}` : ".")
    );
    this.name = "TrustedProductionRuntimeError";
    this.runtime = runtime;
  }
}

export function isTrustedProductionRuntimeError(error: unknown): error is TrustedProductionRuntimeError {
  return error instanceof TrustedProductionRuntimeError ||
    (typeof error === "object" &&
      error !== null &&
      (error as { code?: unknown }).code === "TRUSTED_PRODUCTION_RUNTIME_UNAVAILABLE");
}

function isPathContainedBy(candidate: string, container: string): boolean {
  const relativePath = relative(container, candidate);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function expectedLeaf(name: ProductionRuntimeName): string {
  return RUNTIME_DEFINITIONS[name].leaf;
}

function assertAbsoluteExpectedLeaf(name: ProductionRuntimeName, candidate: string): string {
  if (typeof candidate !== "string" || !isAbsolute(candidate)) {
    throw new TrustedProductionRuntimeError(name, "the configured path must be absolute");
  }
  const absolute = resolve(candidate);
  if (basename(absolute).toLowerCase() !== expectedLeaf(name).toLowerCase()) {
    throw new TrustedProductionRuntimeError(name, `expected ${expectedLeaf(name)}`);
  }
  return absolute;
}

function configuredProgramFilesRoot(): string {
  // The PowerShell contract uses Environment.SpecialFolder.ProgramFiles. The
  // process value is the matching Node surface on the Windows production host.
  const value = process.env.ProgramFiles;
  if (!value || !isAbsolute(value)) {
    throw new Error("Program Files root is unavailable");
  }
  return resolve(value);
}

async function sha256File(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

interface RuntimeAllowlistEntry {
  path?: unknown;
  sha256?: unknown;
}

interface RuntimeAllowlist {
  version?: unknown;
  executables?: Record<string, RuntimeAllowlistEntry>;
}

async function resolveTestOnlyRuntime(name: ProductionRuntimeName, root: string): Promise<string | undefined> {
  const definition = RUNTIME_DEFINITIONS[name];
  const injected = process.env[definition.testEnvironmentVariable];
  if (!injected?.trim()) return undefined;

  if (process.env.LAUNDRY_EXECUTABLE_CONTRACT_TEST_SEAM !== "allow-temp-production-runtime-shims-v1") {
    throw new TrustedProductionRuntimeError(name, "test runtime injection is not enabled");
  }

  const candidate = assertAbsoluteExpectedLeaf(name, injected);
  const temporaryRoot = resolve(tmpdir());
  const resolvedRoot = resolve(root);
  if (
    !temporaryRoot ||
    !isPathContainedBy(candidate, temporaryRoot) ||
    !isPathContainedBy(resolvedRoot, temporaryRoot) ||
    isPathContainedBy(candidate, resolvedRoot)
  ) {
    throw new TrustedProductionRuntimeError(name, "test runtime injection is outside the bounded temporary seam");
  }
  try {
    const details = await stat(candidate);
    if (!details.isFile()) throw new Error("not a file");
  } catch {
    throw new TrustedProductionRuntimeError(name, "test runtime file is missing");
  }
  return candidate;
}

async function resolveAllowlistedProductionRuntime(name: ProductionRuntimeName, root: string): Promise<string> {
  const testRuntime = await resolveTestOnlyRuntime(name, root);
  if (testRuntime) return testRuntime;

  try {
    const allowlistPath = join(root, "scripts", "production-runtime-allowlist.json");
    const parsed = JSON.parse(await readFile(allowlistPath, "utf8")) as RuntimeAllowlist;
    const entry = parsed.version === 1 ? parsed.executables?.[name] : undefined;
    const configuredPath = entry?.path;
    const configuredHash = entry?.sha256;
    if (
      typeof configuredPath !== "string" ||
      typeof configuredHash !== "string" ||
      !/^[a-f0-9]{64}$/iu.test(configuredHash)
    ) {
      throw new Error("the immutable allowlist entry is missing or malformed");
    }

    const candidate = assertAbsoluteExpectedLeaf(name, configuredPath);
    const programFiles = configuredProgramFilesRoot();
    const [realCandidate, realProgramFiles, realRoot] = await Promise.all([
      realpath(candidate),
      realpath(programFiles),
      realpath(resolve(root))
    ]);
    if (!isPathContainedBy(realCandidate, realProgramFiles) || isPathContainedBy(realCandidate, realRoot)) {
      throw new Error("the allowlisted runtime is outside immutable Program Files containment");
    }
    const details = await stat(realCandidate);
    if (!details.isFile()) throw new Error("the allowlisted runtime is not a file");
    if ((await sha256File(realCandidate)).toLowerCase() !== configuredHash.toLowerCase()) {
      throw new Error("the allowlisted runtime SHA-256 does not match");
    }
    return realCandidate;
  } catch (error) {
    if (isTrustedProductionRuntimeError(error)) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new TrustedProductionRuntimeError(name, detail);
  }
}

/**
 * Resolves a native executable at the call boundary. The default is strictly
 * the immutable production allowlist; a caller must explicitly inject a pure
 * resolver for a unit test.
 */
export async function resolveTrustedProductionRuntime(
  name: ProductionRuntimeName,
  root: string,
  options: RuntimeResolverOptions = {}
): Promise<string> {
  if (!options.runtimeResolver) return resolveAllowlistedProductionRuntime(name, root);
  try {
    return assertAbsoluteExpectedLeaf(name, await options.runtimeResolver(name, root));
  } catch (error) {
    if (isTrustedProductionRuntimeError(error)) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new TrustedProductionRuntimeError(name, detail);
  }
}
