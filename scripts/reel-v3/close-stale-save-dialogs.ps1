# Cancel the orphaned save dialogs the browser pane left open.
#
# 2026-09-13. Thirteen of them had stacked up from earlier image downloads, and
# then seven more from canvas data: URLs. They matter because
# fill-open-dialog.ps1 takes the FIRST #32770 owned by claude.exe, and a Save
# dialog keeps its filename box under control id 1001 rather than 1148 -- so the
# helper reported "CONTROLS NOT FOUND" against a dialog that was never the one
# it wanted. They also swallow clicks meant for the page.
#
# Which dialogs are fair game, and why each condition is here:
#   * owned by claude.exe -- not some other application's dialog
#   * class #32770 whose IDOK button carries the Save verb -- a SAVE dialog
#     specifically, never an Open dialog that a flow is waiting on
#   * an EMPTY filename box (control 1001) -- nothing typed in, so nobody is
#     part-way through using it
#   * title empty, or starting with blob: / data: -- the shapes the browser's
#     own download prompt produces
#
# Cancel, never Save: whatever it was offering can be downloaded again.
#
# Usage: close-stale-save-dialogs.ps1 [-WhatIf]

param([switch]$WhatIf)

$sig = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class Cls {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr h, EnumWindowsProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessageW(IntPtr h, uint m, IntPtr w, StringBuilder l);
  [DllImport("user32.dll")] public static extern IntPtr SendMessageW(IntPtr h, uint m, IntPtr w, IntPtr l);
}
'@
if (-not ("Cls" -as [type])) { Add-Type -TypeDefinition $sig }

function Get-StaleSaveDialogs {
    $found = New-Object System.Collections.ArrayList
    $find = [Cls+EnumWindowsProc] {
        param($h, $l)
        $cn = New-Object Text.StringBuilder 256
        [void][Cls]::GetClassNameW($h, $cn, 256)
        if ($cn.ToString() -ne '#32770') { return $true }

        $procId = 0
        [void][Cls]::GetWindowThreadProcessId($h, [ref]$procId)
        if ((Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName -ne 'claude') { return $true }

        $t = New-Object Text.StringBuilder 512
        [void][Cls]::GetWindowTextW($h, $t, 512)
        $title = $t.ToString()
        $titleOk = ($title -eq '') -or $title.StartsWith('blob:') -or $title.StartsWith('data:')
        if (-not $titleOk) { return $true }

        $script:isSave = $false
        $script:cancel = [IntPtr]::Zero
        $script:nameEmpty = $false
        $script:sawName = $false
        $kids = [Cls+EnumWindowsProc] {
            param($k, $l2)
            $kc = New-Object Text.StringBuilder 256
            [void][Cls]::GetClassNameW($k, $kc, 256)
            $id = [Cls]::GetDlgCtrlID($k)
            if ($kc.ToString() -eq 'Button' -and $id -eq 1) {
                $bt = New-Object Text.StringBuilder 128
                [void][Cls]::GetWindowTextW($k, $bt, 128)
                if ($bt.ToString() -like '*存檔*' -or $bt.ToString() -like '*Save*') { $script:isSave = $true }
            }
            if ($kc.ToString() -eq 'Button' -and $id -eq 2) { $script:cancel = $k }
            if ($kc.ToString() -eq 'Edit' -and $id -eq 1001 -and -not $script:sawName) {
                $script:sawName = $true
                $sb = New-Object Text.StringBuilder 1024
                [void][Cls]::SendMessageW($k, 0x000D, [IntPtr]1024, $sb)
                $script:nameEmpty = ($sb.ToString().Trim() -eq '')
            }
            return $true
        }
        [void][Cls]::EnumChildWindows($h, $kids, [IntPtr]::Zero)

        if ($script:isSave -and $script:nameEmpty -and $script:cancel -ne [IntPtr]::Zero) {
            [void]$found.Add([pscustomobject]@{ Dialog = $h; Cancel = $script:cancel; Title = $title })
        }
        return $true
    }
    [void][Cls]::EnumWindows($find, [IntPtr]::Zero)
    return $found
}

$targets = Get-StaleSaveDialogs
Write-Host ("found {0} stale save dialog(s)" -f $targets.Count)
if ($WhatIf) {
    $targets | ForEach-Object { Write-Host ("  would cancel hwnd={0} title='{1}'" -f $_.Dialog, $_.Title) }
    exit 0
}

$closed = 0
foreach ($t in $targets) {
    [void][Cls]::SendMessageW($t.Cancel, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)
    $closed++
    Start-Sleep -Milliseconds 150
}
Write-Host ("cancelled {0}" -f $closed)

# Count again rather than assume. Closing is asynchronous: the first run of the
# original version reported 13 cancelled and 1 remaining, and only a second run
# saw zero.
Start-Sleep -Milliseconds 600
$left = Get-StaleSaveDialogs
Write-Host ("remaining after cancel: {0}" -f $left.Count)
if ($left.Count -gt 0) { exit 1 }
exit 0
