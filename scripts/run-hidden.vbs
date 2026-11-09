' Hidden launcher for Laundry scheduled tasks.
' Task Scheduler runs: wscript.exe //B //Nologo run-hidden.vbs <script.ps1> [args...]
'
' Window style 0 hides the PowerShell console (a visible console was closed
' mid-run on 2026-08-03, task result 0xC000013A). -WindowStyle Hidden is also
' passed because a console subsystem process can ignore the Run style.
' wscript.exe itself has no console, so //B does not leave a window to close.
'
' bWaitOnReturn must be True. False (or omitted) makes Run return 0
' immediately. WScript.Quit must receive that return value; otherwise
' wscript exits 0 even when the script did exit 1 (2026-10-24 / 2026-10-25).
' This file stays ASCII so cscript/wscript on a cp950 machine does not
' mis-parse a UTF-8 comment.
Option Explicit

If WScript.Arguments.Count < 1 Then
    WScript.Quit 1
End If

Function QuoteArg(value)
    QuoteArg = """" & Replace(value, """", """""") & """"
End Function

Dim scriptPath, command, index, shell, exitCode
scriptPath = WScript.Arguments(0)
command = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File " & QuoteArg(scriptPath)
For index = 1 To WScript.Arguments.Count - 1
    command = command & " " & QuoteArg(WScript.Arguments(index))
Next

Set shell = CreateObject("WScript.Shell")
exitCode = shell.Run(command, 0, True)
WScript.Quit exitCode
