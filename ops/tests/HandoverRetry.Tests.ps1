# Pester 3.4. Test-AiHandover polls "not yet" night states (11/01 00:17: checked 1 s before the PUT landed).
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path (Split-Path -Parent $here) 'deploy-ai-linebot.ps1')

Describe 'Test-AiHandover retry' {
    Mock Write-AiDeployLog { }
    Mock Start-Sleep { }

    It 'retries a not-yet night state and then passes' {
        $script:calls = 0
        Mock Test-AiHandoverOnce { $script:calls++; if ($script:calls -lt 3) { throw 'Nighttime LINE endpoint does not equal the AI endpoint.' } }
        { Test-AiHandover @{} } | Should Not Throw
        $script:calls | Should Be 3
    }

    It 'fails at once on a daytime PUT (not retryable)' {
        $script:calls = 0
        Mock Test-AiHandoverOnce { $script:calls++; throw 'A daytime PUT attempt was observed.' }
        { Test-AiHandover @{} } | Should Throw
        $script:calls | Should Be 1
    }

    It 'gives up after 12 attempts' {
        $script:calls = 0
        Mock Test-AiHandoverOnce { $script:calls++; throw 'Fresh verified night PUT/GET event is missing.' }
        { Test-AiHandover @{} } | Should Throw
        $script:calls | Should Be 12
    }
}
