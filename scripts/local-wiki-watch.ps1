# Run one shared local-wiki runtime and watcher for a knowledge-base root.

param(
    [Parameter(Mandatory = $true)]
    [string]$Root
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$KnowledgeRoot = (Resolve-Path -LiteralPath $Root).Path
$StateDir = Join-Path $KnowledgeRoot ".state"
$LogFile = Join-Path $StateDir "local-wiki-runtime.log"
$Node = Get-Command "node" -ErrorAction Stop
$LocalWikiCli = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\src\cli.js")).Path
$MaxLogBytes = 5MB
$RetryDelaySeconds = 5
$MaxRetryDelaySeconds = 60

New-Item -ItemType Directory -Path $StateDir -Force | Out-Null

while ($true) {
    $StartedAt = Get-Date
    try {
        if ((Test-Path -LiteralPath $LogFile) -and (Get-Item -LiteralPath $LogFile).Length -ge $MaxLogBytes) {
            $Archive = "$LogFile.1"
            if (Test-Path -LiteralPath $Archive) {
                Remove-Item -LiteralPath $Archive -Force
            }
            Move-Item -LiteralPath $LogFile -Destination $Archive
        }
        "[$(Get-Date -Format o)] Starting the single-instance local-wiki runtime." |
            Add-Content -LiteralPath $LogFile -Encoding utf8
        $PreviousErrorActionPreference = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        & $Node.Source $LocalWikiCli daemon --root $KnowledgeRoot --watch 2>&1 | ForEach-Object {
            "[$(Get-Date -Format o)] $($_.ToString())" |
                Add-Content -LiteralPath $LogFile -Encoding utf8
        }
        $RuntimeExitCode = $LASTEXITCODE
        $ErrorActionPreference = $PreviousErrorActionPreference
        if ($RuntimeExitCode -eq 0) {
            "[$(Get-Date -Format o)] Runtime stopped normally." |
                Add-Content -LiteralPath $LogFile -Encoding utf8
            exit 0
        }
        "[$(Get-Date -Format o)] Runtime exited unexpectedly with code $RuntimeExitCode." |
            Add-Content -LiteralPath $LogFile -Encoding utf8
    } catch {
        $ErrorActionPreference = "Stop"
        "[$(Get-Date -Format o)] Runtime failed: $($_.Exception.Message)" |
            Add-Content -LiteralPath $LogFile -Encoding utf8
    }

    if (((Get-Date) - $StartedAt).TotalSeconds -ge 300) {
        $RetryDelaySeconds = 5
    }
    "[$(Get-Date -Format o)] Restarting runtime in $RetryDelaySeconds seconds." |
        Add-Content -LiteralPath $LogFile -Encoding utf8
    Start-Sleep -Seconds $RetryDelaySeconds
    $RetryDelaySeconds = [Math]::Min($RetryDelaySeconds * 2, $MaxRetryDelaySeconds)
}
