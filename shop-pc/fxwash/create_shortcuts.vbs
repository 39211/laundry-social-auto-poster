Set WshShell = CreateObject("WScript.Shell")
strDesktop = WshShell.SpecialFolders("Desktop")
strStartup = WshShell.SpecialFolders("Startup")

Set oLink1 = WshShell.CreateShortcut(strDesktop & "\Start-FXwash-LINE-Bot.lnk")
oLink1.TargetPath = "C:\LaundryStores\fxwash\run_silent.vbs"
oLink1.WorkingDirectory = "C:\LaundryStores\fxwash"
oLink1.Save

Set oLink2 = WshShell.CreateShortcut(strStartup & "\FXwash-LINE-Bot.lnk")
oLink2.TargetPath = "C:\LaundryStores\fxwash\run_silent.vbs"
oLink2.WorkingDirectory = "C:\LaundryStores\fxwash"
oLink2.Save
WScript.Echo "Shortcuts successfully created!"
