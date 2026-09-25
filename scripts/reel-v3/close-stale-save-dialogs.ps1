# Cancel the orphaned "save this blob" dialogs the browser pane left open.
#
# 2026-09-13. Thirteen of them had stacked up from earlier image downloads in
# this session. They matter because fill-open-dialog.ps1 takes the FIRST #32770
# owned by claude.exe, and a Save dialog keeps its filename box under control id
# 1001 rather than 1148 -- so the helper reported "CONTROLS NOT FOUND" against a
# dialog that was never the one it wanted.
#
# Only dialogs whose title begins with "blob:" are touched: those are the
# browser's own download prompts. Anything the user opened is left alone.
# Cancel, never Save: the image is still in the conversation either way.

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
  [DllImport("user32.dll")] public static extern IntPtr SendMessageW(IntPtr h, uint m, IntPtr w, IntPtr l);
}
'@
if (-not ("Cls" -as [type])) { Add-Type -TypeDefinition $sig }

$targets = New-Object System.Collections.ArrayList
$find = [Cls+EnumWindowsProc] {
    param($h, $l)
    $cn = New-Object Text.StringBuilder 256
    [void][Cls]::GetClassNameW($h, $cn, 256)
    if ($cn.ToString() -eq '#32770') {
        $procId = 0
        [void][Cls]::GetWindowThreadProcessId($h, [ref]$procId)
        if ((Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName -eq 'claude') {
            $t = New-Object Text.StringBuilder 512
            [void][Cls]::GetWindowTextW($h, $t, 512)
            if ($t.ToString().StartsWith('blob:')) { [void]$targets.Add($h) }
        }
    }
    return $true
}
[void][Cls]::EnumWindows($find, [IntPtr]::Zero)

Write-Host ("found {0} stale blob save dialog(s)" -f $targets.Count)
$closed = 0
foreach ($h in $targets) {
    $script:cancel = [IntPtr]::Zero
    $kids = [Cls+EnumWindowsProc] {
        param($k, $l)
        $cn = New-Object Text.StringBuilder 256
        [void][Cls]::GetClassNameW($k, $cn, 256)
        if ($cn.ToString() -eq 'Button' -and [Cls]::GetDlgCtrlID($k) -eq 2) { $script:cancel = $k }
        return $true
    }
    [void][Cls]::EnumChildWindows($h, $kids, [IntPtr]::Zero)
    if ($script:cancel -ne [IntPtr]::Zero) {
        [void][Cls]::SendMessageW($script:cancel, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)  # BM_CLICK
        $closed++
        Start-Sleep -Milliseconds 150
    }
}
Write-Host ("cancelled {0}" -f $closed)

# Count again so the result is measured, not assumed.
$targets2 = New-Object System.Collections.ArrayList
$find2 = [Cls+EnumWindowsProc] {
    param($h, $l)
    $cn = New-Object Text.StringBuilder 256
    [void][Cls]::GetClassNameW($h, $cn, 256)
    if ($cn.ToString() -eq '#32770') {
        $procId = 0
        [void][Cls]::GetWindowThreadProcessId($h, [ref]$procId)
        if ((Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName -eq 'claude') {
            $t = New-Object Text.StringBuilder 512
            [void][Cls]::GetWindowTextW($h, $t, 512)
            if ($t.ToString().StartsWith('blob:')) { [void]$targets2.Add($h) }
        }
    }
    return $true
}
[void][Cls]::EnumWindows($find2, [IntPtr]::Zero)
Write-Host ("remaining after cancel: {0}" -f $targets2.Count)
if ($targets2.Count -gt 0) { exit 1 }
exit 0
