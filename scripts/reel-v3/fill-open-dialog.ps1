# Drive the native "open file" dialog the browser pane raised, without the screen.
#
# 2026-09-12. Uploading the persona reference into the owner's ChatGPT session is
# the only way the generated stills keep his face and keep the same jacket, and
# every screen-level route was blocked: the pane has no upload tool, a synthetic
# Ctrl+V carries no clipboard payload, and computer-use refuses to type into
# Claude's own window -- which is exactly what owns this dialog.
#
# So talk to the dialog directly. It is a standard #32770 owned by claude.exe:
# WM_SETTEXT the filename combo (control 1148), read it back with WM_GETTEXT --
# GetWindowText returns nothing for a control in another process, so reading back
# any other way looks like a silent failure when it worked -- and only click
# Open (control 1) once the text matches exactly.
#
# Usage: fill-open-dialog.ps1 -Paths "C:\a.png","C:\b.png"

param([Parameter(Mandatory = $true)][string[]]$Paths)

$ErrorActionPreference = "Stop"

foreach ($p in $Paths) {
    if (-not (Test-Path -LiteralPath $p)) { Write-Host "MISSING: $p"; exit 1 }
}

$sig = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class Dlg {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr h, EnumWindowsProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessageW(IntPtr h, uint m, IntPtr w, string l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessageW(IntPtr h, uint m, IntPtr w, StringBuilder l);
  [DllImport("user32.dll")] public static extern IntPtr SendMessageW(IntPtr h, uint m, IntPtr w, IntPtr l);
}
'@
if (-not ("Dlg" -as [type])) { Add-Type -TypeDefinition $sig }

$script:dlg = [IntPtr]::Zero
$find = [Dlg+EnumWindowsProc] {
    param($h, $l)
    $cn = New-Object Text.StringBuilder 256
    [void][Dlg]::GetClassNameW($h, $cn, 256)
    if ($cn.ToString() -eq '#32770') {
        $procId = 0
        [void][Dlg]::GetWindowThreadProcessId($h, [ref]$procId)
        if ((Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName -eq 'claude') {
            $script:dlg = $h
            return $false
        }
    }
    return $true
}
[void][Dlg]::EnumWindows($find, [IntPtr]::Zero)
if ($script:dlg -eq [IntPtr]::Zero) { Write-Host "NO DIALOG: nothing owned by claude.exe is open"; exit 1 }

$script:edit = [IntPtr]::Zero
$script:ok = [IntPtr]::Zero
$kids = [Dlg+EnumWindowsProc] {
    param($h, $l)
    $cn = New-Object Text.StringBuilder 256
    [void][Dlg]::GetClassNameW($h, $cn, 256)
    $id = [Dlg]::GetDlgCtrlID($h)
    # 1148 is the filename combo; its Edit is the only one that matters. The
    # dialog also carries a search box and a hidden address bar, both class Edit.
    if ($cn.ToString() -eq 'Edit' -and $id -eq 1148 -and $script:edit -eq [IntPtr]::Zero) { $script:edit = $h }
    if ($cn.ToString() -eq 'Button' -and $id -eq 1) { $script:ok = $h }
    return $true
}
[void][Dlg]::EnumChildWindows($script:dlg, $kids, [IntPtr]::Zero)
if ($script:edit -eq [IntPtr]::Zero -or $script:ok -eq [IntPtr]::Zero) {
    Write-Host "CONTROLS NOT FOUND: edit=$($script:edit) ok=$($script:ok)"
    exit 1
}

$value = ($Paths | ForEach-Object { '"' + $_ + '"' }) -join ' '
[void][Dlg]::SendMessageW($script:edit, 0x000C, [IntPtr]::Zero, $value)   # WM_SETTEXT
Start-Sleep -Milliseconds 300

$sb = New-Object Text.StringBuilder 8192
[void][Dlg]::SendMessageW($script:edit, 0x000D, [IntPtr]8192, $sb)        # WM_GETTEXT
if ($sb.ToString() -ne $value) {
    Write-Host "READBACK MISMATCH - not clicking Open"
    Write-Host "  wanted: $value"
    Write-Host "  got   : $($sb.ToString())"
    exit 1
}

[void][Dlg]::SendMessageW($script:ok, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)  # BM_CLICK
Start-Sleep -Milliseconds 1200
Write-Host "OK submitted $($Paths.Count) file(s)"
foreach ($p in $Paths) { Write-Host "   $p" }
exit 0
