# Accept the browser pane's download prompt at its default name and location.
#
# 2026-09-13. Downloads from chatgpt.com land in Downloads without asking;
# downloads from facebook.com raise a native Save dialog and wait. Since
# `<a download="name">` already puts the name I asked for into the dialog and
# the dialog already points at Downloads, there is nothing to fill in -- the
# whole job is to press Save.
#
# Press it with PostMessage, NOT SendMessage. SendMessage blocks until the
# target window procedure returns, and a modal dialog whose owner thread is
# waiting on it does not return promptly: three attempts at this using
# SendMessage each ran past the two-minute tool timeout while the file had, in
# fact, already been written.
#
# Only dialogs owned by claude.exe whose filename box matches -NameLike are
# touched, so this cannot answer a dialog somebody else opened.
#
# Usage: press-save-default.ps1 -NameLike 'fbref-*'

param(
    [Parameter(Mandatory = $true)][string]$NameLike
)

$sig = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class Prs {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr h, EnumWindowsProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessageTimeoutW(IntPtr h, uint m, IntPtr w, StringBuilder l, uint flags, uint timeout, out IntPtr res);
  [DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr h, uint m, IntPtr w, IntPtr l);
}
'@
if (-not ("Prs" -as [type])) { Add-Type -TypeDefinition $sig }

$hits = New-Object System.Collections.ArrayList
$find = [Prs+EnumWindowsProc] {
    param($h, $l)
    $cn = New-Object Text.StringBuilder 256
    [void][Prs]::GetClassNameW($h, $cn, 256)
    if ($cn.ToString() -ne '#32770') { return $true }
    $procId = 0
    [void][Prs]::GetWindowThreadProcessId($h, [ref]$procId)
    if ((Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName -ne 'claude') { return $true }

    $script:ok = [IntPtr]::Zero; $script:edit = [IntPtr]::Zero; $script:isSave = $false
    $kids = [Prs+EnumWindowsProc] {
        param($k, $l2)
        $kc = New-Object Text.StringBuilder 256
        [void][Prs]::GetClassNameW($k, $kc, 256)
        $id = [Prs]::GetDlgCtrlID($k)
        if ($kc.ToString() -eq 'Button' -and $id -eq 1) {
            $script:ok = $k
            $bt = New-Object Text.StringBuilder 128
            [void][Prs]::GetWindowTextW($k, $bt, 128)
            if ($bt.ToString() -like '*存檔*' -or $bt.ToString() -like '*Save*') { $script:isSave = $true }
        }
        if ($kc.ToString() -eq 'Edit' -and $id -eq 1001 -and $script:edit -eq [IntPtr]::Zero) { $script:edit = $k }
        return $true
    }
    [void][Prs]::EnumChildWindows($h, $kids, [IntPtr]::Zero)
    if (-not $script:isSave -or $script:edit -eq [IntPtr]::Zero) { return $true }

    # WM_GETTEXT with a timeout: GetWindowText returns empty across a process
    # boundary, and a plain SendMessage can hang on a modal dialog.
    $sb = New-Object Text.StringBuilder 1024
    $res = [IntPtr]::Zero
    [void][Prs]::SendMessageTimeoutW($script:edit, 0x000D, [IntPtr]1024, $sb, 2, 1500, [ref]$res)
    [void]$hits.Add([pscustomobject]@{ Ok = $script:ok; Name = $sb.ToString() })
    return $true
}
[void][Prs]::EnumWindows($find, [IntPtr]::Zero)

$mine = @($hits | Where-Object { $_.Name -like $NameLike })
Write-Host ("{0} save dialog(s) open, {1} named like '{2}'" -f $hits.Count, $mine.Count, $NameLike)
foreach ($m in $mine) {
    Write-Host ("  pressing Save for '{0}'" -f $m.Name)
    [void][Prs]::PostMessageW($m.Ok, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)   # BM_CLICK
    Start-Sleep -Milliseconds 400
}
Write-Host ("pressed {0}" -f $mine.Count)
if ($mine.Count -eq 0) { exit 1 }
exit 0
