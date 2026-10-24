import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const launcherPath = join(root, "scripts", "run-hidden.vbs");
const registerPath = join(root, "scripts", "register-catchup-task.ps1");

/**
 * 店上的工作排程器不在 CI 裡。Linux 只驗證 run-hidden.vbs 的契約，
 * 並用同一個「等待 / Quit」規則跑真正的子行程。Windows CI 會再用
 * cscript 把同一支 vbs 跑過一次（結束碼與 wscript 相同）。
 * 排程實際啟動的是 wscript.exe，所以店上還要照下面的步驟看 Last Result。
 *
 * 探針用結束碼 7，而不是 1：cscript 自己語法錯誤時也常回 1，7 才能證明
 * 傳出去的是子行程的碼。daily-generate.ps1 真正失敗時仍是 exit 1。
 */
export const WINDOWS_MANUAL_VERIFICATION = `
1. 在 repo 根目錄重新註冊。合併程式不會改已經登錄的工作，不跑這步的話排程仍是舊動作：
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\\register-catchup-task.ps1
2. 不要用真正的 daily-generate.ps1 做強制失敗，那會跑完整生成與公開站。
   在暫存目錄放兩支探針，內容各只有一行：
   probe-fail.ps1    exit 7
   probe-ok.ps1      exit 0
3. 只暫時改 Laundry-Daily-Generate 的動作，觸發與其他設定不動
   （把 <repo> 與 <temp> 換成實際路徑）：
   $action = New-ScheduledTaskAction -Execute 'wscript.exe' \`
     -Argument '//B //Nologo "<repo>\\scripts\\run-hidden.vbs" "<temp>\\probe-fail.ps1"' \`
     -WorkingDirectory '<repo>'
   Set-ScheduledTask -TaskName 'Laundry-Daily-Generate' -Action $action
4. schtasks /run /tn Laundry-Daily-Generate
   先等到工作不再執行。執行中查到的上次結果是 267009（0x41301），那不是腳本結束碼。
   schtasks /query /tn Laundry-Daily-Generate /v /fo list
   「上次結果」應為 7（或 0x7），不可為 0。
5. 把 Arguments 裡的探針換成 probe-ok.ps1，再執行一次：
   schtasks /run /tn Laundry-Daily-Generate
   schtasks /query /tn Laundry-Daily-Generate /v /fo list
   「上次結果」應為 0。
6. 立刻再跑步驟 1，把動作改回 daily-generate.ps1。
   確認 Execute 是 wscript.exe，Arguments 含 //B //Nologo、run-hidden.vbs、daily-generate.ps1。
`;

type LauncherContract = {
  windowStyle: number;
  wait: boolean;
  quitsWithRunResult: boolean;
};

function readText(path: string): string {
  return readFileSync(path, "utf8").replace(/^\uFEFF/, "");
}

function parseLauncher(source: string): LauncherContract {
  const run = source.match(
    /exitCode\s*=\s*shell\.Run\(\s*command\s*,\s*(\d+)\s*,\s*(True|False)\s*\)/
  );
  if (!run) {
    throw new Error("run-hidden.vbs 沒有把 shell.Run 的回傳值放進 exitCode");
  }
  const windowStyleText = run[1];
  const waitText = run[2];
  if (windowStyleText === undefined || waitText === undefined) {
    throw new Error("shell.Run 的視窗樣式或 bWaitOnReturn 解析失敗");
  }
  return {
    windowStyle: Number(windowStyleText),
    wait: waitText === "True",
    quitsWithRunResult: /^WScript\.Quit exitCode\s*$/m.test(source)
  };
}

// WScript.Shell.Run 的結束碼規則：
// bWaitOnReturn 不是 True 時立刻回傳 0，不等子行程。
// 就算等到了，wscript 自己仍以 0 結束，除非 WScript.Quit 吃到那個回傳值。
function reportedExit(contract: LauncherContract, childExit: number): number {
  const child = spawnSync(process.execPath, ["-e", `process.exit(${childExit})`], {
    windowsHide: true
  });
  if (child.error) {
    throw child.error;
  }
  if (child.status !== childExit) {
    throw new Error(`子行程結束碼是 ${String(child.status)}，預期 ${childExit}`);
  }
  if (!contract.wait) {
    return 0;
  }
  if (!contract.quitsWithRunResult) {
    return 0;
  }
  return childExit;
}

describe("排程隱藏啟動器要交回腳本結束碼", () => {
  it("文件裡留有店上 schtasks 的手動驗證步驟", () => {
    expect(WINDOWS_MANUAL_VERIFICATION).toContain(
      "schtasks /run /tn Laundry-Daily-Generate"
    );
    expect(WINDOWS_MANUAL_VERIFICATION).toContain(
      "schtasks /query /tn Laundry-Daily-Generate /v /fo list"
    );
    expect(WINDOWS_MANUAL_VERIFICATION).toContain("probe-fail.ps1");
    expect(WINDOWS_MANUAL_VERIFICATION).toContain("exit 7");
  });

  it("失敗探針經啟動器得到 7，成功探針得到 0", () => {
    const contract = parseLauncher(readText(launcherPath));
    expect(contract).toEqual({
      windowStyle: 0,
      wait: true,
      quitsWithRunResult: true
    });
    expect(reportedExit(contract, 7)).toBe(7);
    expect(reportedExit(contract, 0)).toBe(0);
  });

  it("舊的外層寫法會把失敗看成 0", () => {
    const didNotWait = { windowStyle: 0, wait: false, quitsWithRunResult: false };
    const waitedButDidNotQuit = { windowStyle: 0, wait: true, quitsWithRunResult: false };
    expect(reportedExit(didNotWait, 7)).toBe(0);
    expect(reportedExit(waitedButDidNotQuit, 7)).toBe(0);
  });

  it("vbs 隱藏 powershell、等待、並把參數傳進去", () => {
    const source = readText(launcherPath);
    expect(source).toContain(
      'command = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File " & QuoteArg(scriptPath)'
    );
    expect(source).toContain("For index = 1 To WScript.Arguments.Count - 1");
    expect(source).toContain('command = command & " " & QuoteArg(WScript.Arguments(index))');
    expect(source).toMatch(/If WScript\.Arguments\.Count < 1 Then\s+WScript\.Quit 1/s);
    expect(source).not.toMatch(/shell\.Run\(\s*command\s*,\s*0\s*,\s*False\s*\)/);
  });

  it("Laundry-Daily-Generate 改由 wscript 啟動，生成腳本的結束與日期邏輯沒被改掉", () => {
    const register = readText(registerPath);
    const generate = readText(join(root, "scripts", "daily-generate.ps1"));
    expect(register).toContain('-Execute "wscript.exe"');
    expect(register).toContain("//B //Nologo");
    expect(register).toContain("run-hidden.vbs");
    expect(register).toContain('Join-Path $PSScriptRoot "run-hidden.vbs"');
    expect(register).toContain("Join-Path $PSScriptRoot $Script");
    expect(register).not.toContain('-Execute "powershell.exe"');
    expect(register).toContain(
      'Register-LaundryTask -Name "Laundry-Daily-Generate" -Script "daily-generate.ps1"'
    );
    expect(generate).toContain("if (Publish-Site) { exit 0 } else { exit 1 }");
    expect(generate).toContain(
      '$date = if ($Date) { $Date } else { $now.AddDays(3).ToString("yyyy-MM-dd") }'
    );
  });

  it.runIf(process.platform === "win32")(
    "cscript 跑真正的 vbs：強制失敗是 7，成功是 0，沒有腳本路徑是 1",
    { timeout: 60000 },
    () => {
      const dir = mkdtempSync(join(tmpdir(), "run-hidden-"));
      const probe = join(dir, "probe.ps1");
      writeFileSync(probe, "param([int]$Code = 0)\r\nexit $Code\r\n", "utf8");

      const fail = spawnSync(
        "cscript.exe",
        ["//Nologo", "//B", launcherPath, probe, "-Code", "7"],
        { encoding: "utf8", windowsHide: true, timeout: 45000 }
      );
      const ok = spawnSync(
        "cscript.exe",
        ["//Nologo", "//B", launcherPath, probe, "-Code", "0"],
        { encoding: "utf8", windowsHide: true, timeout: 45000 }
      );
      const missing = spawnSync("cscript.exe", ["//Nologo", "//B", launcherPath], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 15000
      });

      expect(
        { status: fail.status, stdout: fail.stdout, stderr: fail.stderr },
        "失敗探針應原樣交回 7"
      ).toMatchObject({ status: 7 });
      expect(
        { status: ok.status, stdout: ok.stdout, stderr: ok.stderr },
        "成功探針應交回 0"
      ).toMatchObject({ status: 0 });
      expect(missing.status, "沒有腳本路徑時啟動器自己要以 1 結束").toBe(1);
    }
  );
});
