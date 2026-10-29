param(
    [Parameter(Mandatory = $true)]
    [string]$ShopPath,

    [string]$Python = "",
    [switch]$ConfigureLine,
    [switch]$ConfigureLinePay,
    [string]$LineWebhookUrl = "",
    [switch]$ApplyWebhook,
    [switch]$VerifyLine,
    [switch]$TestWebhook,
    [ValidateSet("keep", "disabled", "merchant_qr", "line_pay_online")]
    [string]$LinePayMode = "keep",
    [ValidateSet("sandbox", "production")]
    [string]$LinePayEnvironment = "sandbox",
    [string]$LinePayQrUrl = "",
    [switch]$VerifyLinePay,
    [int]$LinePayReserveAmount = 0,
    [string]$LinePayOrderId = "sandbox-verify-001",
    [string]$LinePayProductName = "LINE Pay sandbox 驗證",
    [string]$LinePayConfirmUrl = "https://example.invalid/pay/confirm",
    [string]$LinePayCancelUrl = "https://example.invalid/pay/cancel",
    [switch]$AllowProduction,
    [switch]$ReplaceSecrets
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$shopFile = (Resolve-Path -LiteralPath $ShopPath).Path
$shopDir = Split-Path -Parent $shopFile
$env:PYTHONIOENCODING = "utf-8"

function Write-Utf8Json([string]$Path, [object]$Value) {
    $json = $Value | ConvertTo-Json -Depth 12
    [System.IO.File]::WriteAllText($Path, $json + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding($false)))
}

function Read-SecretText([string]$Prompt) {
    $secure = Read-Host $Prompt -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    }
}

function Protect-SecretFile([string]$Path) {
    $acl = Get-Acl -LiteralPath $Path
    $acl.SetAccessRuleProtection($true, $false)
    $accounts = @(
        [Security.Principal.WindowsIdentity]::GetCurrent().User,
        (New-Object Security.Principal.SecurityIdentifier([Security.Principal.WellKnownSidType]::LocalSystemSid, $null)),
        (New-Object Security.Principal.SecurityIdentifier([Security.Principal.WellKnownSidType]::BuiltinAdministratorsSid, $null))
    )
    foreach ($sid in $accounts) {
        $account = $sid.Translate([Security.Principal.NTAccount]).Value
        $rule = New-Object Security.AccessControl.FileSystemAccessRule($account, "FullControl", "Allow")
        $acl.SetAccessRule($rule)
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}

function Backup-Shop([string]$Path) {
    $backupDir = Join-Path $shopDir "backups"
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
    $name = "shop-before-connections-{0}.json" -f ([DateTime]::Now.ToString("yyyyMMdd-HHmmss-fff"))
    $dest = Join-Path $backupDir $name
    Copy-Item -LiteralPath $Path -Destination $dest
    return $dest
}

function Test-MerchantQrUrl([string]$Url) {
    if ([string]::IsNullOrWhiteSpace($Url)) { return $false }
    $prefix = "https://qrcodepay.line.me/"
    if (-not $Url.StartsWith($prefix)) { return $false }
    $rest = $Url.Substring($prefix.Length)
    $pathPart = ($rest -split '[?#]', 2)[0]
    $segments = @($pathPart.Split('/') | Where-Object { $_ -ne '' })
    return ($segments.Count -ge 1)
}

if ([string]::IsNullOrWhiteSpace($Python)) {
    $pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($null -eq $pythonCommand) {
        throw "找不到 Python；請用 -Python 指定完整路徑。"
    }
    $Python = $pythonCommand.Source
}
if (-not (Test-Path -LiteralPath $Python -PathType Leaf)) {
    throw "找不到指定的 Python：$Python"
}
if ($LinePayReserveAmount -lt 0) {
    throw "LinePayReserveAmount 不可小於 0。"
}
if ($LinePayReserveAmount -gt 0) {
    $VerifyLinePay = $true
}

$shop = Get-Content -LiteralPath $shopFile -Raw -Encoding UTF8 | ConvertFrom-Json
if ($null -eq $shop.server -or $null -eq $shop.payment) {
    throw "shop.json 缺少 server 或 payment 區塊；請使用商品包模板。"
}
$changed = $false
$qrSavedThisRun = $false
$patchArgs = [System.Collections.Generic.List[string]]::new()
$patchArgs.Add("-B")
$patchArgs.Add((Join-Path $root "patch_shop_json.py"))
$patchArgs.Add("--shop")
$patchArgs.Add($shopFile)

if ($LineWebhookUrl) {
    $uri = [Uri]$LineWebhookUrl
    if (-not $uri.IsAbsoluteUri -or $uri.Scheme -ne "https") {
        throw "LineWebhookUrl 必須是 HTTPS 完整網址。"
    }
    $patchArgs.Add("--server-webhook-url")
    $patchArgs.Add($LineWebhookUrl)
    $patchArgs.Add("--server-webhook-path")
    $patchArgs.Add($uri.AbsolutePath)
    $patchArgs.Add("--server-public-base")
    $patchArgs.Add($uri.GetLeftPart([UriPartial]::Authority))
    $shop.server.webhook_url = $LineWebhookUrl
    $shop.server.webhook_path = $uri.AbsolutePath
    $shop.server.public_base = $uri.GetLeftPart([UriPartial]::Authority)
    $changed = $true
}

$channelFile = Join-Path $shopDir "secrets\line-channel.json"
if ($ConfigureLine) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $channelFile) -Force | Out-Null
    if ((Test-Path -LiteralPath $channelFile) -and -not $ReplaceSecrets) {
        Write-Output "LINE 官方密鑰檔已存在，保留原檔；需要換密鑰請加 -ReplaceSecrets。"
    } else {
        $token = Read-SecretText "貼上 LINE Channel access token（輸入不會顯示）"
        $secret = Read-SecretText "貼上 LINE Channel secret（輸入不會顯示）"
        if ([string]::IsNullOrWhiteSpace($token) -or [string]::IsNullOrWhiteSpace($secret)) {
            throw "LINE 官方密鑰不可留白。"
        }
        Write-Utf8Json $channelFile ([ordered]@{ channel_access_token = $token; channel_secret = $secret })
        Protect-SecretFile $channelFile
        $token = $null
        $secret = $null
        Write-Output "LINE 官方密鑰已寫入門市 secrets，未顯示內容。"
    }
}

if ($LinePayMode -ne "keep") {
    $patchArgs.Add("--payment-mode")
    $patchArgs.Add($LinePayMode)
    $shop.payment.mode = $LinePayMode
    if ($LinePayMode -eq "merchant_qr") {
        if (-not (Test-MerchantQrUrl $LinePayQrUrl)) {
            throw "merchant_qr 必須用 -LinePayQrUrl 提供 qrcodepay.line.me 的 HTTPS 網址，且網域後至少要有一段店家路徑（不可只有 https://qrcodepay.line.me/）。"
        }
        $patchArgs.Add("--payment-url")
        $patchArgs.Add($LinePayQrUrl)
        $shop.payment.url = $LinePayQrUrl
        $qrSavedThisRun = $true
    } elseif ($LinePayMode -eq "line_pay_online") {
        $patchArgs.Add("--payment-url")
        $patchArgs.Add("")
        $patchArgs.Add("--payment-environment")
        $patchArgs.Add($LinePayEnvironment)
        $patchArgs.Add("--payment-currency")
        $patchArgs.Add("TWD")
        $orderPrefix = [string]$shop.payment.order_prefix
        if ([string]::IsNullOrWhiteSpace($orderPrefix)) {
            $orderPrefix = $shop.shop_id.ToUpperInvariant()
        }
        $patchArgs.Add("--payment-order-prefix")
        $patchArgs.Add($orderPrefix)
        $shop.payment.url = ""
        $shop.payment.environment = $LinePayEnvironment
        $shop.payment.currency = "TWD"
        $shop.payment.order_prefix = $orderPrefix
        $ConfigureLinePay = $true
    } else {
        $patchArgs.Add("--payment-url")
        $patchArgs.Add("")
        $shop.payment.url = ""
    }
    $changed = $true
}

$payFile = Join-Path $shopDir "secrets\line-pay.json"
if ($ConfigureLinePay -and $shop.payment.mode -eq "line_pay_online") {
    New-Item -ItemType Directory -Path (Split-Path -Parent $payFile) -Force | Out-Null
    if ((Test-Path -LiteralPath $payFile) -and -not $ReplaceSecrets) {
        Write-Output "LINE Pay 商戶密鑰檔已存在，保留原檔；需要換密鑰請加 -ReplaceSecrets。"
    } else {
        $payId = Read-SecretText "貼上 LINE Pay Channel ID（輸入不會顯示）"
        $paySecret = Read-SecretText "貼上 LINE Pay Channel Secret（輸入不會顯示）"
        if ([string]::IsNullOrWhiteSpace($payId) -or [string]::IsNullOrWhiteSpace($paySecret)) {
            throw "LINE Pay 商戶密鑰不可留白。"
        }
        Write-Utf8Json $payFile ([ordered]@{ channel_id = $payId; channel_secret = $paySecret })
        Protect-SecretFile $payFile
        $payId = $null
        $paySecret = $null
        Write-Output "LINE Pay 商戶密鑰已寫入門市 secrets，未顯示內容。"
    }
}

if ($changed) {
    $backupPath = Backup-Shop $shopFile
    $patchArgs.Add("--validate")
    & $Python @($patchArgs.ToArray())
    if ($LASTEXITCODE -ne 0) {
        Copy-Item -LiteralPath $backupPath -Destination $shopFile -Force
        throw "shop.json 欄位寫入或驗證失敗，已還原備份：$backupPath"
    }
    # Structural validate again via laundry (also restores on failure)
    & $Python -B (Join-Path $root "laundry.py") validate --shop $shopFile | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Copy-Item -LiteralPath $backupPath -Destination $shopFile -Force
        throw "shop.json 結構驗證失敗，已還原備份：$backupPath"
    }
    Write-Output "shop.json 已備份後以 Python 安全寫入（未使用 ConvertTo-Json 整檔回寫）。"
    if ($qrSavedThisRun) {
        Write-Output "已儲存 merchant_qr 付款網址（QR 設定已寫入 shop.json）。"
    }
}

$connections = Join-Path $root "connections.py"
$finalExit = 0
& $Python -B $connections validate --shop $shopFile
if ($LASTEXITCODE -ne 0) {
    if ($qrSavedThisRun) {
        Write-Output "LINE／連接仍未完成（缺少密鑰或其它連接項目），但本回合的 QR／付款欄位已寫入 shop.json。"
    } else {
        Write-Output "目前仍需要補齊連接資料；不會把這個結果當成已交機。"
    }
    $finalExit = 2
}
if ($VerifyLine) {
    & $Python -B $connections verify-line --shop $shopFile
    if ($LASTEXITCODE -ne 0) { $finalExit = 2 }
}
if ($ApplyWebhook) {
    & $Python -B $connections apply-webhook --shop $shopFile --confirm
    if ($LASTEXITCODE -ne 0) { $finalExit = 2 }
}
if ($TestWebhook) {
    & $Python -B $connections test-webhook --shop $shopFile
    if ($LASTEXITCODE -ne 0) { $finalExit = 2 }
}
if ($VerifyLinePay) {
    $payArgs = @("-B", $connections, "verify-linepay", "--shop", $shopFile)
    if ($LinePayReserveAmount -gt 0) {
        $payArgs += @(
            "--reserve-amount", [string]$LinePayReserveAmount,
            "--order-id", $LinePayOrderId,
            "--product-name", $LinePayProductName,
            "--confirm-url", $LinePayConfirmUrl,
            "--cancel-url", $LinePayCancelUrl
        )
    }
    if ($AllowProduction) { $payArgs += "--allow-production" }
    & $Python @payArgs
    if ($LASTEXITCODE -ne 0) { $finalExit = 2 }
}

Write-Output "完成：設定已分成 LINE 官方、LINE Pay 與平台回讀三個狀態；未顯示任何密鑰。"
exit $finalExit
