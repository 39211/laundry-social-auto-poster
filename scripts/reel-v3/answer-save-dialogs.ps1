# Answer the browser pane's "save this download" dialogs, instead of cancelling
# them, when the file is actually wanted.
#
# 2026-09-13. A `<a download>` whose href is a canvas data: URL does NOT
# auto-download in this pane -- it raises a native Save dialog and waits. Four
# study contact sheets therefore never reached disk, and four dialogs piled up
# behind the window where nothing could see them.
#
# Each dialog arrives with the requested filename already typed into control
# 1001. That pre-filled name is the safe discriminator: this script only touches
# dialogs whose name matches -Pattern, so it cannot answer a dialog somebody
# else opened. It rewrites the box to a full path under -Directory and clicks
# Save (IDOK), then waits for the bytes to appear before moving on.
#
# Read the name back with WM_GETTEXT, never GetWindowText: across a process
# boundary GetWindowText returns empty, which makes a working dialog look blank.
#
# Usage: answer-save-dialogs.ps1 -Pattern 'fbref-sheet-*' -Directory 'C:\...\ref'

param(
    [Parameter(Mandatory = $true)][string]$Pattern,
    [Parameter(Mandatory = $true)][string]$Directory,
    [int]$MaxDialogs = 40
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path -LiteralPath $Directory)) { New-Item -ItemType Directory -Path $Directory -Force | Out-Null }

$sig = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class Ans {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr h, EnumWindowsProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessageW(IntPtr h, uint m, IntPtr w, string l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessageW(IntPtr h, uint m, IntPtr w, StringBuilder l);
  [DllImport("user32.dll")] public static extern IntPtr SendMessageW(IntPtr h, uint m, IntPtr w, IntPtr l);
}
'@
if (-not ("Ans" -as [type])) { Add-Type -TypeDefinition $sig }

function Get-SaveDialogs {
    $found = New-Object System.Collections.ArrayList
    $find = [Ans+EnumWindowsProc] {
        param($h, $l)
        $cn = New-Object Text.StringBuilder 256
        [void][Ans]::GetClassNameW($h, $cn, 256)
        if ($cn.ToString() -ne '#32770') { return $true }
        $procId = 0
        [void][Ans]::GetWindowThreadProcessId($h, [ref]$procId)
        if ((Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName -ne 'claude') { return $true }

        $script:ok = [IntPtr]::Zero
        $script:edit = [IntPtr]::Zero
        $script:isSave = $false
        $kids = [Ans+EnumWindowsProc] {
            param($k, $l2)
            $kc = New-Object Text.StringBuilder 256
            [void][Ans]::GetClassNameW($k, $kc, 256)
            $id = [Ans]::GetDlgCtrlID($k)
            if ($kc.ToString() -eq 'Button' -and $id -eq 1) {
                $script:ok = $k
                $bt = New-Object Text.StringBuilder 128
                [void][Ans]::GetWindowTextW($k, $bt, 128)
                if ($bt.ToString() -like '*存檔*' -or $bt.ToString() -like '*Save*') { $script:isSave = $true }
            }
            if ($kc.ToString() -eq 'Edit' -and $id -eq 1001 -and $script:edit -eq [IntPtr]::Zero) { $script:edit = $k }
            return $true
        }
        [void][Ans]::EnumChildWindows($h, $kids, [IntPtr]::Zero)
        if (-not $script:isSave -or $script:edit -eq [IntPtr]::Zero) { return $true }

        $sb = New-Object Text.StringBuilder 1024
        [void][Ans]::SendMessageW($script:edit, 0x000D, [IntPtr]1024, $sb)   # WM_GETTEXT
        [void]$found.Add([pscustomobject]@{ Dialog = $h; Edit = $script:edit; Ok = $script:ok; Name = $sb.ToString() })
        return $true
    }
    [void][Ans]::EnumWindows($find, [IntPtr]::Zero)
    return $found
}

$all = Get-SaveDialogs
$mine = @($all | Where-Object { $_.Name -like $Pattern })
Write-Host ("{0} save dialog(s) open, {1} match '{2}'" -f $all.Count, $mine.Count, $Pattern)
if ($mine.Count -eq 0) { exit 1 }

$saved = 0
foreach ($d in ($mine | Select-Object -First $MaxDialogs)) {
    if (-not [Ans]::IsWindow($d.Dialog)) { continue }
    $dest = Join-Path $Directory $d.Name
    if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Force }

    [void][Ans]::SendMessageW($d.Edit, 0x000C, [IntPtr]::Zero, $dest)       # WM_SETTEXT
    Start-Sleep -Milliseconds 250
    $back = New-Object Text.StringBuilder 4096
    [void][Ans]::SendMessageW($d.Edit, 0x000D, [IntPtr]4096, $back)         # WM_GETTEXT
    if ($back.ToString() -ne $dest) {
        Write-Host ("  READBACK MISMATCH for {0} - not clicking Save" -f $d.Name)
        Write-Host ("    wanted: {0}" -f $dest)
        Write-Host ("    got   : {0}" -f $back.ToString())
        continue
    }
    [void][Ans]::SendMessageW($d.Ok, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)  # BM_CLICK

    $deadline = (Get-Date).AddSeconds(15)
    $done = $false
    while ((Get-Date) -lt $deadline) {
        if (Test-Path -LiteralPath $dest) {
            $len = (Get-Item -LiteralPath $dest).Length
            if ($len -gt 0) {
                Start-Sleep -Milliseconds 300
                if ((Get-Item -LiteralPath $dest).Length -eq $len) {
                    Write-Host ("  OK {0}  {1} bytes" -f $d.Name, $len)
                    $saved++; $done = $true; break
                }
            }
        }
        Start-Sleep -Milliseconds 300
    }
    if (-not $done) { Write-Host ("  NOT CONFIRMED {0}" -f $d.Name) }
}

Write-Host ("saved {0} of {1}" -f $saved, $mine.Count)
if ($saved -ne $mine.Count) { exit 1 }
exit 0
