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
$LocalWiki = Get-Command "local-wiki" -ErrorAction Stop
$MaxLogBytes = 5MB

New-Item -ItemType Directory -Path $StateDir -Force | Out-Null

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
    & $LocalWiki.Source daemon --root $KnowledgeRoot --watch 2>&1 | ForEach-Object {
        "[$(Get-Date -Format o)] $($_.ToString())" |
            Add-Content -LiteralPath $LogFile -Encoding utf8
    }
    exit $LASTEXITCODE
} catch {
    "[$(Get-Date -Format o)] Runtime failed: $($_.Exception.Message)" |
        Add-Content -LiteralPath $LogFile -Encoding utf8
    exit 1
}
