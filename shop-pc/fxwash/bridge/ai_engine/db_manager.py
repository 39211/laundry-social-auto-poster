"""Safe read-only db_manager for eHank MDB integration.

Strictly executes read-only SELECT queries via Windows 32-bit Jet 4.0 OLEDB.
Guarantees zero writes and zero modification to eHank database files.
"""

import base64
import json
import os
import subprocess
import sys
from pathlib import Path


class FakeCursor:
    def __init__(self, rows):
        self.rows = rows

    def fetchall(self):
        return self.rows


class EhankConnection:
    def __init__(self, mdb_path: str = "", password: str = "8899000"):
        if not mdb_path:
            live_path = Path(r"C:\FXwash\eHank.mdb")
            backup_path = Path(r"c:\Users\AN\Desktop\備份0904\eHank.mdb")
            default_path = str(live_path if live_path.exists() else backup_path)
            mdb_path = os.environ.get("EHANK_MDB_PATH", default_path)
        self.mdb_path = str(Path(mdb_path).resolve())
        self.password = password

        if not Path(self.mdb_path).exists():
            raise FileNotFoundError(f"eHank MDB file not found at: {self.mdb_path}")

    def execute(self, sql: str):
        cleaned_sql = sql.strip()
        if not cleaned_sql.upper().startswith("SELECT"):
            raise PermissionError("Security restriction: Only SELECT queries are permitted on eHank MDB.")

        # Execute read-only Jet 4.0 query via 32-bit PowerShell and return Base64-encoded UTF-8 JSON
        ps_script = f"""
$connStr = "Provider=Microsoft.Jet.OLEDB.4.0;Data Source={self.mdb_path};Jet OLEDB:Database Password={self.password};Mode=Read;"
$conn = New-Object System.Data.OleDb.OleDbConnection($connStr)
$conn.Open()
$cmd = $conn.CreateCommand()
$cmd.CommandText = @'
{cleaned_sql}
'@
$reader = $cmd.ExecuteReader()
$results = New-Object System.Collections.Generic.List[Object]
while ($reader.Read()) {{
    $item = New-Object System.Collections.Generic.List[Object]
    for ($i = 0; $i -lt $reader.FieldCount; $i++) {{
        $val = $reader.GetValue($i)
        if ($val -is [System.DBNull]) {{
            $item.Add($null)
        }} else {{
            $item.Add($val.ToString().Trim())
        }}
    }}
    $results.Add($item)
}}
$reader.Close()
$conn.Close()
if ($results.Count -eq 0) {{
    $json = "[]"
}} else {{
    $json = $results | ConvertTo-Json -Compress
}}
$bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
[Console]::Out.Write([System.Convert]::ToBase64String($bytes))
"""
        powershell_exe = r"C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe"
        if not Path(powershell_exe).exists():
            powershell_exe = "powershell.exe"

        cmd = [
            powershell_exe,
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            ps_script
        ]
        res = subprocess.run(
            cmd,
            capture_output=True,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
        )
        if res.returncode != 0:
            err_msg = res.stderr.decode("utf-8", errors="ignore") or res.stdout.decode("utf-8", errors="ignore")
            raise RuntimeError(f"Database query failed: {err_msg}")

        b64_output = res.stdout.strip()
        if not b64_output:
            return FakeCursor([])

        decoded_json = base64.b64decode(b64_output).decode("utf-8")
        data = json.loads(decoded_json)

        if isinstance(data, list):
            if data and not isinstance(data[0], list):
                data = [data]
        else:
            data = [[data]]

        return FakeCursor(data)

    def close(self):
        pass


def get_conn():
    return EhankConnection()
