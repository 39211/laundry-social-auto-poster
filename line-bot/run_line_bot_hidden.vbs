Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "C:\Users\cyc39\laundry-repo\line-bot"
sh.Run "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""C:\Users\cyc39\laundry-repo\line-bot\run_line_bot.ps1""", 0, False
