param([string]$Dir = 'C:\LaundryStores\B2-staging')
Get-ChildItem -Recurse -File -LiteralPath $Dir | ForEach-Object { $_.FullName.Replace($Dir + '\', '') + ' ' + (Get-FileHash -LiteralPath $_.FullName).Hash.Substring(0, 12) + ' ' + $_.LastWriteTime.ToString('MM-dd HH:mm') }
