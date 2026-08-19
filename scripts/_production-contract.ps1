# Shared fail-closed executable-contract gate for scheduled effectors.
# These workers execute checked-out source and dependency manifests directly.
# A dirty or unverifiable contract cannot authorize a lock, scheduler mutation,
# child task, post, or remote publishing/indexing path.
function Resolve-TrustedProductionGitExecutable {
    [CmdletBinding()]
    param()

    # There is deliberately no environment-variable Git seam.  A scheduled
    # production worker must use the inspected system binary, not a value a
    # caller or inherited task environment can replace.
    if (-not [string]::IsNullOrWhiteSpace([string]$env:LAUNDRY_TRUSTED_GIT_CMD) -or
        -not [string]::IsNullOrWhiteSpace([string]$env:LAUNDRY_TRUSTED_GIT_EXE)) {
        return $null
    }

    # Do not ask PATH (or the working directory) for `git`: a repo-local
    # git.cmd/git.exe would then be able to forge a clean contract. The system
    # Git installation is the only accepted inspector; absence is blocked.
    $programFiles = [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)
    if ([string]::IsNullOrWhiteSpace($programFiles)) { return $null }
    $candidate = [IO.Path]::GetFullPath((Join-Path $programFiles "Git\cmd\git.exe"))
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { return $null }
    return $candidate
}

function Test-PathContainedBy {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Path,
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Container
    )

    try {
        $fullPath = [IO.Path]::GetFullPath($Path)
        $fullContainer = [IO.Path]::GetFullPath($Container).TrimEnd('\') + '\'
        return $fullPath.StartsWith($fullContainer, [StringComparison]::OrdinalIgnoreCase)
    } catch {
        return $false
    }
}

function Test-ProductionContractRootBinding {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Root
    )

    try {
        $helperRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot)).TrimEnd('\')
        $contractRoot = [IO.Path]::GetFullPath($Root).TrimEnd('\')
        if ($helperRoot.Equals($contractRoot, [StringComparison]::OrdinalIgnoreCase)) {
            return [pscustomobject]@{ ok = $true; reason = "bound" }
        }

        # RootOverride is a test fixture seam only. A real scheduled worker may
        # never execute helper/script source from one checkout while validating
        # another; that split reopens every source-contract gate.
        $temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
        if ($env:LAUNDRY_EXECUTABLE_CONTRACT_TEST_SEAM -ceq "allow-temp-production-runtime-shims-v1" -and
            (Test-PathContainedBy -Path $contractRoot -Container $temporaryRoot)) {
            return [pscustomobject]@{ ok = $true; reason = "temporary test seam" }
        }
        return [pscustomobject]@{ ok = $false; reason = "contract root does not match the executing scripts checkout" }
    } catch {
        return [pscustomobject]@{ ok = $false; reason = "contract root binding could not be canonicalized" }
    }
}

function Resolve-TrustedProductionNpmExecutable {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Root
    )

    # Scheduled workers must never resolve npm from the repository working
    # directory: an untracked npm.cmd there wins command lookup before the
    # system executable and can turn a publish into an arbitrary local command.
    $rootNpm = Join-Path $Root "npm.cmd"
    if (Test-Path -LiteralPath $rootNpm -PathType Leaf) { return $null }

    # Test fixtures can exercise a successful child process through a shim,
    # but the seam is intentionally unavailable to real workers: it needs an
    # unmistakable opt-in, both fixture root and shim must be beneath the OS
    # temporary directory, and the shim must be outside the fixture root.
    # Any inherited LAUNDRY_TRUSTED_NPM_CMD that does not satisfy every one of
    # those conditions is a contract failure, never a production override.
    $injected = [string]$env:LAUNDRY_TRUSTED_NPM_CMD
    if (-not [string]::IsNullOrWhiteSpace($injected)) {
        try {
            $candidate = [IO.Path]::GetFullPath($injected)
            $temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
            if ($env:LAUNDRY_EXECUTABLE_CONTRACT_TEST_SEAM -cnotin @("allow-temp-npm-shim-v1", "allow-temp-production-runtime-shims-v1") -or
                -not [IO.Path]::IsPathRooted($candidate) -or
                -not (Test-PathContainedBy -Path $Root -Container $temporaryRoot) -or
                -not (Test-PathContainedBy -Path $candidate -Container $temporaryRoot) -or
                (Test-PathContainedBy -Path $candidate -Container $Root) -or
                -not ([IO.Path]::GetFileName($candidate).Equals("npm.cmd", [StringComparison]::OrdinalIgnoreCase)) -or
                -not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
                return $null
            }
            return $candidate
        } catch {
            return $null
        }
    }

    $programFiles = [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)
    if ([string]::IsNullOrWhiteSpace($programFiles)) { return $null }
    $candidate = [IO.Path]::GetFullPath((Join-Path $programFiles "nodejs\\npm.cmd"))
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { return $null }
    return $candidate
}

function Resolve-TrustedProductionNodeExecutable {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Root
    )

    foreach ($shadow in @("node.exe", "node.cmd", "node.ps1")) {
        if (Test-Path -LiteralPath (Join-Path $Root $shadow) -PathType Leaf) { return $null }
    }

    $injected = [string]$env:LAUNDRY_TRUSTED_NODE_EXE
    if (-not [string]::IsNullOrWhiteSpace($injected)) {
        try {
            $candidate = [IO.Path]::GetFullPath($injected)
            $temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
            if ($env:LAUNDRY_EXECUTABLE_CONTRACT_TEST_SEAM -cne "allow-temp-production-runtime-shims-v1" -or
                -not [IO.Path]::IsPathRooted($candidate) -or
                -not (Test-PathContainedBy -Path $Root -Container $temporaryRoot) -or
                -not (Test-PathContainedBy -Path $candidate -Container $temporaryRoot) -or
                (Test-PathContainedBy -Path $candidate -Container $Root) -or
                -not ([IO.Path]::GetFileName($candidate).Equals("node.exe", [StringComparison]::OrdinalIgnoreCase)) -or
                -not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
                return $null
            }
            return $candidate
        } catch {
            return $null
        }
    }

    $programFiles = [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)
    if ([string]::IsNullOrWhiteSpace($programFiles)) { return $null }
    $candidate = [IO.Path]::GetFullPath((Join-Path $programFiles "nodejs\\node.exe"))
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { return $null }
    return $candidate
}

function Resolve-TrustedProductionCodexExecutable {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Root
    )

    foreach ($shadow in @("codex.exe", "codex.cmd", "codex.ps1")) {
        if (Test-Path -LiteralPath (Join-Path $Root $shadow) -PathType Leaf) { return $null }
    }

    $injected = [string]$env:LAUNDRY_TRUSTED_CODEX_CMD
    if (-not [string]::IsNullOrWhiteSpace($injected)) {
        try {
            $candidate = [IO.Path]::GetFullPath($injected)
            $temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
            $leaf = [IO.Path]::GetFileName($candidate)
            if ($env:LAUNDRY_EXECUTABLE_CONTRACT_TEST_SEAM -cne "allow-temp-production-runtime-shims-v1" -or
                -not [IO.Path]::IsPathRooted($candidate) -or
                -not (Test-PathContainedBy -Path $Root -Container $temporaryRoot) -or
                -not (Test-PathContainedBy -Path $candidate -Container $temporaryRoot) -or
                (Test-PathContainedBy -Path $candidate -Container $Root) -or
                $leaf -cnotin @("codex.cmd", "codex.exe") -or
                -not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
                return $null
            }
            return $candidate
        } catch {
            return $null
        }
    }

    # APPDATA and PATH are both caller-controlled search surfaces.  The Codex
    # desktop package exposes the CLI from its immutable AppX install location;
    # accept only that absolute executable and fail closed when it is absent.
    try {
        $package = @(Get-AppxPackage -Name "OpenAI.Codex" -ErrorAction Stop | Sort-Object Version -Descending | Select-Object -First 1)
        if ($package.Count -ne 1 -or [string]::IsNullOrWhiteSpace([string]$package[0].InstallLocation)) { return $null }
        $programFiles = [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)
        $windowsApps = [IO.Path]::GetFullPath((Join-Path $programFiles "WindowsApps"))
        $candidate = [IO.Path]::GetFullPath((Join-Path ([string]$package[0].InstallLocation) "app\\resources\\codex.exe"))
        if (-not (Test-PathContainedBy -Path $candidate -Container $windowsApps) -or
            -not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            return $null
        }
        return $candidate
    } catch {
        return $null
    }
}

function Resolve-TrustedProductionPowerShellExecutable {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Root
    )

    foreach ($shadow in @("powershell.exe", "powershell.cmd", "powershell.ps1", "pwsh.exe", "pwsh.cmd", "pwsh.ps1")) {
        if (Test-Path -LiteralPath (Join-Path $Root $shadow) -PathType Leaf) { return $null }
    }

    $systemDirectory = [Environment]::GetFolderPath([Environment+SpecialFolder]::System)
    if ([string]::IsNullOrWhiteSpace($systemDirectory)) { return $null }
    $candidate = [IO.Path]::GetFullPath((Join-Path $systemDirectory "WindowsPowerShell\\v1.0\\powershell.exe"))
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { return $null }
    return $candidate
}

function Resolve-TrustedProductionCurlExecutable {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Root
    )

    foreach ($shadow in @("curl.exe", "curl.cmd", "curl.ps1")) {
        if (Test-Path -LiteralPath (Join-Path $Root $shadow) -PathType Leaf) { return $null }
    }
    $systemDirectory = [Environment]::GetFolderPath([Environment+SpecialFolder]::System)
    if ([string]::IsNullOrWhiteSpace($systemDirectory)) { return $null }
    $candidate = [IO.Path]::GetFullPath((Join-Path $systemDirectory "curl.exe"))
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { return $null }
    return $candidate
}

function Resolve-TrustedProductionAllowlistedRuntimeExecutable {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Root,
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Name,
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$ExpectedLeaf,
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$TestEnvironmentVariable
    )

    # Media and paid-generation executors are outside the checkout. Their
    # absolute path alone does not make them trusted, so production accepts
    # only a Program Files entry whose SHA-256 is committed in the checked
    # allowlist. An empty/missing entry is intentionally a deploy blocker.
    $injected = [string][Environment]::GetEnvironmentVariable($TestEnvironmentVariable, "Process")
    if (-not [string]::IsNullOrWhiteSpace($injected)) {
        try {
            $candidate = [IO.Path]::GetFullPath($injected)
            $temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
            if ($env:LAUNDRY_EXECUTABLE_CONTRACT_TEST_SEAM -cne "allow-temp-production-runtime-shims-v1" -or
                -not [IO.Path]::IsPathRooted($candidate) -or
                -not (Test-PathContainedBy -Path $Root -Container $temporaryRoot) -or
                -not (Test-PathContainedBy -Path $candidate -Container $temporaryRoot) -or
                (Test-PathContainedBy -Path $candidate -Container $Root) -or
                -not ([IO.Path]::GetFileName($candidate).Equals($ExpectedLeaf, [StringComparison]::OrdinalIgnoreCase)) -or
                -not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
                return $null
            }
            return $candidate
        } catch {
            return $null
        }
    }

    try {
        $allowlistPath = Join-Path $Root "scripts\production-runtime-allowlist.json"
        if (-not (Test-Path -LiteralPath $allowlistPath -PathType Leaf)) { return $null }
        $allowlist = ConvertFrom-Json ([IO.File]::ReadAllText($allowlistPath, [Text.UTF8Encoding]::new($false)))
        if ($null -eq $allowlist.executables -or -not ($allowlist.executables.PSObject.Properties.Name -contains $Name)) {
            return $null
        }
        $entry = $allowlist.executables.$Name
        $configuredPath = [string]$entry.path
        $configuredHash = ([string]$entry.sha256).ToLowerInvariant()
        if ([string]::IsNullOrWhiteSpace($configuredPath) -or $configuredHash -notmatch '^[a-f0-9]{64}$') {
            return $null
        }
        $candidate = [IO.Path]::GetFullPath($configuredPath)
        $programFiles = [IO.Path]::GetFullPath([Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles))
        if (-not (Test-PathContainedBy -Path $candidate -Container $programFiles) -or
            (Test-PathContainedBy -Path $candidate -Container $Root) -or
            -not ([IO.Path]::GetFileName($candidate).Equals($ExpectedLeaf, [StringComparison]::OrdinalIgnoreCase)) -or
            -not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            return $null
        }
        $actualHash = (Get-FileHash -LiteralPath $candidate -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant()
        if (-not $actualHash.Equals($configuredHash, [StringComparison]::Ordinal)) { return $null }
        return $candidate
    } catch {
        return $null
    }
}

function Resolve-TrustedProductionFfmpegExecutable {
    [CmdletBinding()]
    param([Parameter(Mandatory)][ValidateNotNullOrEmpty()][string]$Root)
    return Resolve-TrustedProductionAllowlistedRuntimeExecutable -Root $Root -Name "ffmpeg" -ExpectedLeaf "ffmpeg.exe" -TestEnvironmentVariable "LAUNDRY_TRUSTED_FFMPEG_EXE"
}

function Resolve-TrustedProductionFfprobeExecutable {
    [CmdletBinding()]
    param([Parameter(Mandatory)][ValidateNotNullOrEmpty()][string]$Root)
    return Resolve-TrustedProductionAllowlistedRuntimeExecutable -Root $Root -Name "ffprobe" -ExpectedLeaf "ffprobe.exe" -TestEnvironmentVariable "LAUNDRY_TRUSTED_FFPROBE_EXE"
}

function Resolve-TrustedProductionPythonExecutable {
    [CmdletBinding()]
    param([Parameter(Mandatory)][ValidateNotNullOrEmpty()][string]$Root)
    return Resolve-TrustedProductionAllowlistedRuntimeExecutable -Root $Root -Name "python" -ExpectedLeaf "python.exe" -TestEnvironmentVariable "LAUNDRY_TRUSTED_PYTHON_EXE"
}

function Resolve-TrustedProductionGenerateShotScript {
    [CmdletBinding()]
    param([Parameter(Mandatory)][ValidateNotNullOrEmpty()][string]$Root)
    return Resolve-TrustedProductionAllowlistedRuntimeExecutable -Root $Root -Name "generate-shot" -ExpectedLeaf "generate-shot.ps1" -TestEnvironmentVariable "LAUNDRY_TRUSTED_GENERATE_SHOT_PS1"
}

function Invoke-TrustedProductionAllowlistedRuntimeExecutable {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][ValidateNotNullOrEmpty()][string]$Root,
        [Parameter(Mandatory)][ValidateNotNullOrEmpty()][string]$Stage,
        [Parameter(Mandatory)][ValidateNotNullOrEmpty()][string]$Name,
        [Parameter(Mandatory)][ValidateNotNullOrEmpty()][string]$ExpectedLeaf,
        [Parameter(Mandatory)][ValidateNotNullOrEmpty()][string]$TestEnvironmentVariable,
        [Parameter(Mandatory, ValueFromRemainingArguments = $true)][string[]]$CommandArguments
    )

    # Resolve and hash-check at the action boundary, rather than caching a
    # path from worker startup. A lengthy Codex/TSX/media step can otherwise
    # race a replacement of an outside runtime between its initial check and
    # the next stateful invocation.
    if (-not (Assert-CleanProductionContractBeforeAction -Root $Root -Stage $Stage)) {
        throw "BLOCKED production contract before $Stage"
    }
    $executable = Resolve-TrustedProductionAllowlistedRuntimeExecutable -Root $Root -Name $Name -ExpectedLeaf $ExpectedLeaf -TestEnvironmentVariable $TestEnvironmentVariable
    if (-not $executable) {
        throw "trusted allowlisted $Name runtime could not be established"
    }
    & $executable @CommandArguments
}

function Invoke-TrustedProductionFfmpeg {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][ValidateNotNullOrEmpty()][string]$Root,
        [Parameter(Mandatory, ValueFromRemainingArguments = $true)][string[]]$CommandArguments
    )
    Invoke-TrustedProductionAllowlistedRuntimeExecutable -Root $Root -Stage "trusted ffmpeg invocation" -Name "ffmpeg" -ExpectedLeaf "ffmpeg.exe" -TestEnvironmentVariable "LAUNDRY_TRUSTED_FFMPEG_EXE" -CommandArguments $CommandArguments
}

function Invoke-TrustedProductionFfprobe {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][ValidateNotNullOrEmpty()][string]$Root,
        [Parameter(Mandatory, ValueFromRemainingArguments = $true)][string[]]$CommandArguments
    )
    Invoke-TrustedProductionAllowlistedRuntimeExecutable -Root $Root -Stage "trusted ffprobe invocation" -Name "ffprobe" -ExpectedLeaf "ffprobe.exe" -TestEnvironmentVariable "LAUNDRY_TRUSTED_FFPROBE_EXE" -CommandArguments $CommandArguments
}

function Invoke-TrustedProductionPython {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][ValidateNotNullOrEmpty()][string]$Root,
        [Parameter(Mandatory, ValueFromRemainingArguments = $true)][string[]]$CommandArguments
    )
    # Python's normal startup imports user-site and current-directory modules
    # even when python.exe itself is hash-pinned. Isolated mode rejects those
    # ambient module surfaces; a runtime without immutable dependencies must
    # fail rather than silently running a user-writable edge_tts/PIL package.
    Invoke-TrustedProductionAllowlistedRuntimeExecutable -Root $Root -Stage "trusted python invocation" -Name "python" -ExpectedLeaf "python.exe" -TestEnvironmentVariable "LAUNDRY_TRUSTED_PYTHON_EXE" -CommandArguments (@("-I") + $CommandArguments)
}

function Invoke-TrustedProductionGenerateShot {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][ValidateNotNullOrEmpty()][string]$Root,
        [Parameter(Mandatory, ValueFromRemainingArguments = $true)][string[]]$Arguments
    )

    if (-not (Assert-CleanProductionContractBeforeAction -Root $Root -Stage "trusted paid video generation")) {
        throw "BLOCKED production contract before trusted paid video generation"
    }
    $powerShell = Resolve-TrustedProductionPowerShellExecutable -Root $Root
    $scriptPath = Resolve-TrustedProductionGenerateShotScript -Root $Root
    if (-not $powerShell -or -not $scriptPath) {
        throw "trusted allowlisted paid video generator could not be established"
    }
    & $powerShell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $scriptPath @Arguments
}

function Resolve-TrustedProductionTsxEntryPoint {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Root
    )

    # `node_modules` is deliberately ignored by Git and cannot become trusted
    # merely because its path is absolute. A modified tsx loader can execute
    # before every TypeScript-side gate, so do not ever resolve it from the
    # checkout. Tests use a sharply bounded temp-only seam; real workers may
    # use only an administrator-installed immutable runtime below Program Files.
    $injected = [string]$env:LAUNDRY_TRUSTED_TSX_ENTRY
    if (-not [string]::IsNullOrWhiteSpace($injected)) {
        try {
            $candidate = [IO.Path]::GetFullPath($injected)
            $temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
            if ($env:LAUNDRY_EXECUTABLE_CONTRACT_TEST_SEAM -cne "allow-temp-production-runtime-shims-v1" -or
                -not [IO.Path]::IsPathRooted($candidate) -or
                -not (Test-PathContainedBy -Path $Root -Container $temporaryRoot) -or
                -not (Test-PathContainedBy -Path $candidate -Container $temporaryRoot) -or
                (Test-PathContainedBy -Path $candidate -Container $Root) -or
                -not ([IO.Path]::GetFileName($candidate).Equals("tsx.mjs", [StringComparison]::OrdinalIgnoreCase)) -or
                -not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
                return $null
            }
            return $candidate
        } catch {
            return $null
        }
    }

    try {
        $programFiles = [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)
        if ([string]::IsNullOrWhiteSpace($programFiles)) { return $null }
        $entryPoint = [IO.Path]::GetFullPath((Join-Path $programFiles "LaundryProductionRuntime\\tsx\\tsx.mjs"))
        if (Test-Path -LiteralPath $entryPoint -PathType Leaf) { return $entryPoint }
        return $null
    } catch {
        return $null
    }
}

function Resolve-TrustedProductionNpmRunTsxInvocation {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Root,
        [Parameter(Mandatory)]
        [string[]]$NpmArguments
    )

    # `npm run` prepends <root>\node_modules\.bin to PATH. That makes a
    # checked package.json still dispatch an ignored, replaceable `tsx.cmd`.
    # Scheduled workers therefore translate only a deliberately narrow class
    # of checked-in `tsx src/*.ts` package scripts into the trusted Node/TSX
    # bridge. They never invoke npm's script shell.
    if ($NpmArguments.Count -lt 2 -or $NpmArguments[0] -cne "run") { return $null }
    $scriptName = [string]$NpmArguments[1]
    if ($scriptName -notmatch '^[A-Za-z0-9][A-Za-z0-9:_-]*$') { return $null }

    try {
        $packagePath = Join-Path $Root "package.json"
        $package = ConvertFrom-Json ([IO.File]::ReadAllText($packagePath, [Text.UTF8Encoding]::new($false)))
        if ($null -eq $package.scripts -or -not ($package.scripts.PSObject.Properties.Name -contains $scriptName)) { return $null }
        $command = [string]$package.scripts.$scriptName
    } catch {
        return $null
    }

    if ($command -notmatch '^tsx\s+(.+)$') { return $null }
    $tokens = @($Matches[1] -split '\s+' | Where-Object { $_.Length -gt 0 })
    if ($tokens.Count -lt 1 -or $tokens[0] -notmatch '^src[\\/][A-Za-z0-9_.-]+(?:[\\/][A-Za-z0-9_.-]+)*\.ts$') { return $null }
    foreach ($token in $tokens) {
        # Static script tokens are arguments, never shell syntax. Dynamic
        # caller arguments remain safe because they are passed as native argv.
        if ($token -notmatch '^(?:src[\\/][A-Za-z0-9_.-]+(?:[\\/][A-Za-z0-9_.-]+)*\.ts|--?[A-Za-z0-9][A-Za-z0-9_.-]*(?:=[A-Za-z0-9_./:-]+)?|[A-Za-z0-9_./:-]+)$') {
            return $null
        }
    }
    try {
        $entryPath = [IO.Path]::GetFullPath((Join-Path $Root ($tokens[0] -replace '/', '\\')))
        if (-not (Test-PathContainedBy -Path $entryPath -Container $Root) -or
            -not (Test-Path -LiteralPath $entryPath -PathType Leaf)) {
            return $null
        }
    } catch {
        return $null
    }

    $callerArguments = if ($NpmArguments.Count -gt 2) { @($NpmArguments[2..($NpmArguments.Count - 1)]) } else { @() }
    return @($tokens + $callerArguments)
}

function Invoke-TrustedProductionNpm {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Root,
        [Parameter(Mandatory, ValueFromRemainingArguments = $true)]
        [string[]]$Arguments
    )

    if (-not (Assert-CleanProductionContractBeforeAction -Root $Root -Stage "trusted npm invocation")) {
        throw "BLOCKED production contract before trusted npm invocation"
    }

    $tsxInvocation = Resolve-TrustedProductionNpmRunTsxInvocation -Root $Root -NpmArguments $Arguments
    if ($Arguments.Count -gt 0 -and $Arguments[0] -ceq "run") {
        if ($null -eq $tsxInvocation -or $tsxInvocation.Count -eq 0) {
            throw "blocked npm run: scheduled workers accept only a checked-in simple tsx src/*.ts command through the trusted TSX bridge"
        }
        Invoke-TrustedProductionTsx -Root $Root @tsxInvocation
        return
    }

    $npmExecutable = Resolve-TrustedProductionNpmExecutable -Root $Root
    if (-not $npmExecutable) {
        throw "trusted npm.cmd could not be established (or root-local npm.cmd is present)"
    }

    $pushed = $false
    try {
        Push-Location -LiteralPath $Root -ErrorAction Stop
        $pushed = $true
        # PowerShell consumes a bare `--` when it binds remaining arguments.
        # Every caller here is an npm `run` invocation and deliberately supplied
        # that separator, so restore it before handing arguments to npm.  This
        # keeps `--date` and other script arguments out of npm's own parser.
        $npmArguments = @($Arguments)
        if ($npmArguments.Count -gt 2 -and $npmArguments[0] -ceq "run" -and $npmArguments[2] -cne "--") {
            $npmArguments = @($npmArguments[0], $npmArguments[1], "--") + @($npmArguments[2..($npmArguments.Count - 1)])
        }
        & $npmExecutable @npmArguments
    } finally {
        if ($pushed) { Pop-Location }
    }
}

function Get-ProductionContractPathspecs {
    [CmdletBinding()]
    param()

    # These are checked-in executable/configuration inputs. Dynamic content,
    # evidence and ledger files intentionally stay out of this list: their own
    # canonical validators decide their authority and production writes them.
    return @(
        "src",
        "scripts",
        "package.json",
        "package-lock.json",
        "tsconfig.json",
        ".agents/skills/daily-automation/SKILL.md",
        "data/slot1-plan.json",
        "data/hooks-bank.json",
        "data/ab-test-plan.json",
        "data/mid-treatment-plan.json",
        "data/rejected-concepts.json"
    )
}

function Get-ProductionRuntimeWorkspaceShadows {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Root
    )

    $shadows = @()
    foreach ($name in @(
        "git.exe", "git.cmd", "git.ps1",
        "npm.exe", "npm.cmd", "npm.ps1",
        "node.exe", "node.cmd", "node.ps1",
        "codex.exe", "codex.cmd", "codex.ps1",
        "curl.exe", "curl.cmd", "curl.ps1",
        "ffmpeg.exe", "ffmpeg.cmd", "ffmpeg.ps1",
        "ffprobe.exe", "ffprobe.cmd", "ffprobe.ps1",
        "python.exe", "python.cmd", "python.ps1", "py.exe", "py.cmd", "py.ps1",
        "powershell.exe", "powershell.cmd", "powershell.ps1",
        "pwsh.exe", "pwsh.cmd", "pwsh.ps1"
    )) {
        $candidate = Join-Path $Root $name
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { $shadows += $name }
    }
    return @($shadows)
}

function Get-ProductionGitEnvironmentOverrides {
    [CmdletBinding()]
    param()

    $names = @(
        "GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE",
        "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES",
        "GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM", "GIT_CONFIG_NOSYSTEM"
    )
    $found = @()
    foreach ($item in Get-ChildItem Env:) {
        if ([string]::IsNullOrWhiteSpace([string]$item.Value)) { continue }
        if ($item.Name -in $names -or $item.Name -match '^GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+)$') {
            $found += $item.Name
        }
    }
    return @($found | Sort-Object -Unique)
}

function Get-ProductionNodeEnvironmentOverrides {
    [CmdletBinding()]
    param()

    $names = @(
        "NODE_OPTIONS", "NODE_PATH",
        "PYTHONPATH", "PYTHONHOME", "PYTHONSTARTUP", "PYTHONUSERBASE", "VIRTUAL_ENV"
    )
    $found = @(
        $names | Where-Object { -not [string]::IsNullOrWhiteSpace([string][Environment]::GetEnvironmentVariable($_, "Process")) }
    )
    foreach ($item in Get-ChildItem Env:) {
        if (($item.Name -like "TSX_*" -or $item.Name -like "ESBUILD_*") -and -not [string]::IsNullOrWhiteSpace([string]$item.Value)) {
            $found += $item.Name
        }
    }
    return @($found | Sort-Object -Unique)
}

function Test-CleanProductionContract {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Root
    )

    $rootBinding = Test-ProductionContractRootBinding -Root $Root
    if (-not $rootBinding.ok) {
        return [pscustomobject]@{
            ok      = $false
            reason  = [string]$rootBinding.reason
            entries = @()
        }
    }

    $gitEnvironmentOverrides = @(Get-ProductionGitEnvironmentOverrides)
    if ($gitEnvironmentOverrides.Count -gt 0) {
        return [pscustomobject]@{
            ok      = $false
            reason  = "inherited Git repository/config override(s): $($gitEnvironmentOverrides -join ', ')"
            entries = @($gitEnvironmentOverrides)
        }
    }

    $nodeEnvironmentOverrides = @(Get-ProductionNodeEnvironmentOverrides)
    if ($nodeEnvironmentOverrides.Count -gt 0) {
        return [pscustomobject]@{
            ok      = $false
            reason  = "inherited Node runtime override(s): $($nodeEnvironmentOverrides -join ', ')"
            entries = @($nodeEnvironmentOverrides)
        }
    }

    $workspaceShadows = @(Get-ProductionRuntimeWorkspaceShadows -Root $Root)
    if ($workspaceShadows.Count -gt 0) {
        return [pscustomobject]@{
            ok      = $false
            reason  = "workspace runtime shadow(s): $($workspaceShadows -join ', ')"
            entries = @($workspaceShadows)
        }
    }

    $gitExecutable = Resolve-TrustedProductionGitExecutable
    if (-not $gitExecutable) {
        return [pscustomobject]@{
            ok      = $false
            reason  = "trusted system git.exe could not be established"
            entries = @()
        }
    }

    if (-not (Resolve-TrustedProductionNpmExecutable -Root $Root)) {
        return [pscustomobject]@{
            ok      = $false
            reason  = "trusted npm.cmd could not be established (or root-local npm.cmd is present)"
            entries = @()
        }
    }

    # Most scheduled state transitions eventually dispatch checked TypeScript.
    # Verify that dispatch anchor before even a harmless-looking task re-arm or
    # log directory is created; otherwise the worker discovers a missing or
    # shadowed runtime only after it has partially changed state.
    if (-not (Resolve-TrustedProductionNodeExecutable -Root $Root) -or
        -not (Resolve-TrustedProductionTsxEntryPoint -Root $Root)) {
        return [pscustomobject]@{
            ok      = $false
            reason  = "trusted node.exe or immutable tsx runtime could not be established"
            entries = @()
        }
    }

    $gitStatus = @()
    $gitStatusExit = $null
    $pushed = $false
    try {
        Push-Location -LiteralPath $Root -ErrorAction Stop
        $pushed = $true
        # `git status` can run a configured fsmonitor hook before it reports
        # porcelain.  The repository config itself is outside the checked
        # production inputs, so disable external status acceleration instead
        # of allowing an ambient hook to execute during our trust inspection.
        $gitStatus = @(& $gitExecutable -c core.fsmonitor=false -c core.untrackedCache=false status --porcelain=v1 --untracked-files=all -- @(Get-ProductionContractPathspecs) 2>$null)
        $gitStatusExit = $LASTEXITCODE
    } catch {
        return [pscustomobject]@{
            ok      = $false
            reason  = "git status invocation failed: $($_.Exception.Message)"
            entries = @()
        }
    } finally {
        if ($pushed) { Pop-Location }
    }

    if ($gitStatusExit -ne 0) {
        return [pscustomobject]@{
            ok      = $false
            reason  = "git status exited $gitStatusExit"
            entries = @($gitStatus)
        }
    }

    # Porcelain has no benign stdout. Fail closed on any unexpected output.
    $dirty = @($gitStatus | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
    if ($dirty.Count -gt 0) {
        return [pscustomobject]@{
            ok      = $false
            reason  = "$($dirty.Count) uncommitted production source/dependency change(s)"
            entries = @($dirty)
        }
    }

    return [pscustomobject]@{
        ok      = $true
        reason  = "clean"
        entries = @()
    }
}

function Assert-CleanProductionContractBeforeAction {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Root,
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Stage
    )

    $contract = Test-CleanProductionContract -Root $Root
    if ($contract.ok) { return $true }
    [Console]::Error.WriteLine("BLOCKED production contract before ${Stage}: $($contract.reason). No action at this boundary or any later boundary was run.")
    return $false
}

function Invoke-TrustedProductionTsx {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Root,
        [Parameter(Mandatory, ValueFromRemainingArguments = $true)]
        [string[]]$Arguments
    )

    # The checked contract root is also the only allowed execution root. Do
    # not offer a second runtime-root parameter: it made clean RootOverride
    # calls capable of executing source from an unchecked checkout.
    if (-not (Assert-CleanProductionContractBeforeAction -Root $Root -Stage "trusted tsx invocation")) {
        throw "BLOCKED production contract before trusted tsx invocation"
    }
    $nodeExecutable = Resolve-TrustedProductionNodeExecutable -Root $Root
    $tsxEntryPoint = Resolve-TrustedProductionTsxEntryPoint -Root $Root
    if (-not $nodeExecutable -or -not $tsxEntryPoint) {
        throw "trusted node.exe or tsx runtime could not be established"
    }

    $pushed = $false
    try {
        Push-Location -LiteralPath $Root -ErrorAction Stop
        $pushed = $true
        $tsxArguments = @($Arguments)
        # PowerShell strips a bare `--` while binding remaining arguments.
        # Restore the separator required by the inline bridge before its data
        # payload is handed to tsx/node.
        if ($tsxArguments.Count -gt 2 -and $tsxArguments[0] -ceq "--eval" -and $tsxArguments[2] -cne "--") {
            $tsxArguments = @($tsxArguments[0], $tsxArguments[1], "--") + @($tsxArguments[2..($tsxArguments.Count - 1)])
        }
        & $nodeExecutable $tsxEntryPoint @tsxArguments
    } finally {
        if ($pushed) { Pop-Location }
    }
}

function Invoke-TrustedProductionCodex {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Root,
        [AllowEmptyString()]
        [string]$StandardInput,
        [Parameter(Mandatory, ValueFromRemainingArguments = $true)]
        [string[]]$Arguments
    )

    if (-not (Assert-CleanProductionContractBeforeAction -Root $Root -Stage "trusted Codex invocation")) {
        throw "BLOCKED production contract before trusted Codex invocation"
    }
    $codexExecutable = Resolve-TrustedProductionCodexExecutable -Root $Root
    if (-not $codexExecutable) {
        throw "trusted Codex executable could not be established"
    }

    $pushed = $false
    try {
        Push-Location -LiteralPath $Root -ErrorAction Stop
        $pushed = $true
        if ($PSBoundParameters.ContainsKey("StandardInput")) {
            $StandardInput | & $codexExecutable @Arguments
        } else {
            & $codexExecutable @Arguments
        }
    } finally {
        if ($pushed) { Pop-Location }
    }
}

# A day lock preserves content integrity; it is never consent to expose that
# content through public Pages, SEO feeds, or IndexNow.  This bridge deliberately
# uses the same canonical TypeScript loaders, approval predicates, calendar
# tamper detection, slot fingerprints, and immutable image digest code as the
# publisher.  PowerShell must not reconstruct a weaker reading of those files.
function Invoke-CanonicalPublicPublicationApproval {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Root,
        [Parameter(Mandatory)]
        [ValidatePattern('^\d{4}-\d{2}-\d{2}$')]
        [string]$Date
    )

    $inline = @'
const { createHash } = await import("node:crypto");
const { readFile } = await import("node:fs/promises");
const { join } = await import("node:path");
const { pathToFileURL } = await import("node:url");
const runtimeModule = (relative) => pathToFileURL(join(process.cwd(), relative)).href;
const { hasPublishableApproval, loadApprovalLog, loadDailyContent } = await import(runtimeModule("src/logging.ts"));
const { imagesDifferFromApproval, inspectApprovedImageDigestFile, isApprovedSlotDigestMap } = await import(runtimeModule("src/imageStamp.ts"));
const { imageAssetsForSlot } = await import(runtimeModule("src/mediaAssets.ts"));

const [date, root] = process.argv.slice(2);
const gaps = [];
const slots = [];
const fail = (message) => gaps.push(message);

try {
  const content = await loadDailyContent(date, root, { today: date });
  if (!content) {
    fail("current calendar is missing");
  } else if (content.tampered) {
    fail("current calendar failed canonical integrity/tamper inspection");
  } else if (content.date !== date) {
    fail("current calendar date does not match requested publication date");
  } else {
    const seen = new Set();
    for (const slot of content.slots) {
      if (!Number.isSafeInteger(slot.slot) || slot.slot < 1) {
        fail("current calendar contains an invalid slot number");
        continue;
      }
      if (seen.has(slot.slot)) {
        fail(`current calendar contains duplicate slot ${slot.slot}`);
        continue;
      }
      seen.add(slot.slot);
      slots.push(slot.slot);
    }
    if (slots.length !== content.slots.length || slots.length === 0) fail("current calendar has no unique valid slots");

    const approvals = await loadApprovalLog(date, root);
    if (!Array.isArray(approvals)) {
      fail("approved-log must be a JSON array");
    } else {
      let fingerprints;
      try {
        fingerprints = JSON.parse(await readFile(join(root, "data", "approved-log", `${date}.fingerprints.json`), "utf8"));
      } catch {
        fail("approval fingerprint sidecar is missing or unreadable");
      }
      const digestFile = await inspectApprovedImageDigestFile(root, date);
      if (digestFile.kind !== "ready") fail("immutable approved image-digest sidecar is missing or unusable");

      for (const slot of content.slots) {
        if (!seen.has(slot.slot)) continue;
        for (const platform of ["facebook", "instagram"]) {
          const rows = approvals.filter((entry) => entry?.slot === slot.slot && entry?.platform === platform);
          const label = `slot ${slot.slot} ${platform}`;
          if (rows.length !== 1) {
            fail(`${label} requires exactly one approval tuple, found ${rows.length}`);
            continue;
          }
          const entry = rows[0];
          if (entry.date !== date) fail(`${label} has wrong approval date`);
          if (!hasPublishableApproval(rows, slot.slot, platform)) fail(`${label} is not a publishable non-forced approval`);
          if (typeof entry.approved_by !== "string" || !entry.approved_by.trim() || entry.approved_by !== entry.approved_by.trim()) {
            fail(`${label} approved_by is missing or malformed`);
          }
          if (Number.isNaN(Date.parse(entry.created_at))) fail(`${label} created_at is missing or invalid`);
        }

        if (!fingerprints || typeof fingerprints !== "object" || Array.isArray(fingerprints)) {
          fail(`slot ${slot.slot} approval fingerprints are unusable`);
        } else {
          const expected = fingerprints[String(slot.slot)];
          const actual = createHash("sha256").update(JSON.stringify(slot)).digest("hex");
          if (typeof expected !== "string" || !/^[a-f0-9]{64}$/u.test(expected) || expected !== actual) {
            fail(`slot ${slot.slot} content changed after approval (fingerprint mismatch)`);
          }
        }

        if (digestFile.kind === "ready") {
          const snapshot = digestFile.snapshot[String(slot.slot)];
          if (!isApprovedSlotDigestMap(snapshot)) {
            fail(`slot ${slot.slot} immutable approved image digest is missing or malformed`);
          } else {
            const changed = await imagesDifferFromApproval(root, slot, imageAssetsForSlot(slot), digestFile.snapshot);
            for (const problem of changed) fail(problem);
          }
        }
      }
    }
  }
} catch (error) {
  fail(`canonical public-approval bridge failed: ${error instanceof Error ? error.message : String(error)}`);
}

console.log(JSON.stringify({
  ok: gaps.length === 0,
  reason: gaps.length === 0 ? "all canonical calendar slots have strict two-platform approval, fingerprints, and immutable image digests" : `${gaps.length} approval proof gap(s)`,
  slots,
  gaps
}));
'@

    $payload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($inline))
    $bootstrap = '(async()=>{await import(`data:text/javascript;base64,${process.argv[1]}`)})()'
    $output = @(Invoke-TrustedProductionTsx -Root $Root --eval $bootstrap -- $payload $Date $Root 2>$null)
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) { throw "Canonical public-approval runner failed (exit $exitCode)." }
    $lines = @($output | Where-Object { ([string]$_).TrimStart().StartsWith("{") })
    if ($lines.Count -ne 1) { throw "Canonical public-approval runner returned an ambiguous JSON verdict." }
    try {
        $result = $lines[0] | ConvertFrom-Json
    } catch {
        throw "Canonical public-approval runner returned invalid JSON: $($lines[0])"
    }
    foreach ($property in "ok", "reason", "slots", "gaps") {
        if ($result.PSObject.Properties.Name -notcontains $property) {
            throw "Canonical public-approval result is missing $property."
        }
    }
    if ($null -eq $result.slots) { $result.slots = @() } elseif ($result.slots -isnot [array]) { $result.slots = @($result.slots) }
    if ($null -eq $result.gaps) { $result.gaps = @() } elseif ($result.gaps -isnot [array]) { $result.gaps = @($result.gaps) }
    return $result
}

function Test-PublicPublicationApproval {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Root,
        [Parameter(Mandatory)]
        [ValidatePattern('^\d{4}-\d{2}-\d{2}$')]
        [string]$Date
    )

    try {
        return Invoke-CanonicalPublicPublicationApproval -Root $Root -Date $Date
    } catch {
        return [pscustomobject]@{
            ok = $false
            reason = "canonical public-approval verification could not run"
            slots = @()
            gaps = @($_.Exception.Message)
        }
    }
}
