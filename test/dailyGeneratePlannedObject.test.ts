import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const oldPlan = JSON.parse(readFileSync("data/slot1-plan.json", "utf8")) as Record<string, string>;
const extension = JSON.parse(readFileSync("data/slot1-plan-ext.json", "utf8")) as Record<string, { object: string }>;
const afterExtensionDate = new Date(
  Date.parse(`${Object.keys(extension).sort().at(-1)!}T00:00:00Z`) + 86_400_000
).toISOString().slice(0, 10);

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "daily-planned-object-"));
  roots.push(root);
  mkdirSync(join(root, "data"));
  for (const name of ["slot1-plan.json", "slot1-plan-ext.json"]) copyFileSync(join("data", name), join(root, "data", name));
  return root;
}

const quotePS = (value: string) => `'${value.replace(/'/g, "''")}'`;

function runProductionLookup(root: string, date: string): { version: number; object: string } {
  // Parse the real script, load only its lookup function, then execute its actual caller assignment.
  // Running the complete scheduler script would enable tasks and start external generation.
  const script = `
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'
    [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
    $tokens = $null; $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile(${quotePS(resolve("scripts/daily-generate.ps1"))}, [ref]$tokens, [ref]$errors)
    if ($errors.Count -ne 0) { throw "Parse errors: $($errors.Count)" }
    $functions = @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-PlannedObject' }, $true))
    if ($functions.Count -ne 1) { throw 'Expected one production Get-PlannedObject function' }
    . ([scriptblock]::Create($functions[0].Extent.Text))
    $calls = @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -eq '$plannedObject' -and $node.Right.Extent.Text -match '^Get-PlannedObject ' }, $true))
    if ($calls.Count -ne 1) { throw 'Expected one production plannedObject caller' }
    $root = ${quotePS(root)}
    $date = ${quotePS(date)}
    . ([scriptblock]::Create($calls[0].Extent.Text))
    @{ version = $PSVersionTable.PSVersion.Major; object = [string]$plannedObject } | ConvertTo-Json -Compress
  `;
  const output = execFileSync("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")
  ], { encoding: "utf8", timeout: 20_000 });
  return JSON.parse(output.replace(/^\uFEFF/u, "").trim()) as { version: number; object: string };
}

describe("daily generation planned object", () => {
  it.each([
    ["2026-10-08", oldPlan["2026-10-08"]!],
    ["2026-10-23", extension["2026-10-23"]!.object],
    [afterExtensionDate, ""]
  ])("PowerShell 5.1 resolves the production lookup for %s", (date, object) => {
    const actual = runProductionLookup(fixtureRoot(), date);
    expect(actual.version).toBe(5);
    expect(actual.object).toBe(object);
  });

  it("keeps the old plan ahead of an overlapping extension row", () => {
    const root = fixtureRoot();
    writeFileSync(join(root, "data", "slot1-plan-ext.json"), JSON.stringify({ "2026-10-08": { object: "extension must not win" } }));
    expect(runProductionLookup(root, "2026-10-08").object).toBe(oldPlan["2026-10-08"]);
  });

  it.each(["missing", "malformed"])("returns empty when the extension is %s", (failure) => {
    const root = fixtureRoot();
    const path = join(root, "data", "slot1-plan-ext.json");
    if (failure === "missing") rmSync(path);
    else writeFileSync(path, "not json");
    expect(runProductionLookup(root, "2026-10-23").object).toBe("");
  });

  it("returns empty when both plan reads fail", () => {
    const root = fixtureRoot();
    for (const name of ["slot1-plan.json", "slot1-plan-ext.json"]) writeFileSync(join(root, "data", name), "not json");
    expect(runProductionLookup(root, "2026-10-23").object).toBe("");
  });
});
