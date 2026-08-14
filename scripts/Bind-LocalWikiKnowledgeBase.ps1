# Preview or apply local-wiki knowledge-base bindings for Codex and Cursor.

param(
    [Parameter(Mandatory = $true)]
    [string]$Root,
    [ValidateSet("codex", "cursor")]
    [string[]]$Client = @("codex", "cursor"),
    [ValidateSet("agent-memory", "minimal")]
    [string]$Template = "agent-memory",
    [string]$CodexConfig,
    [string]$CursorConfig,
    [switch]$Initialize,
    [switch]$Refresh,
    [switch]$Daemon,
    [switch]$InstallRuntime,
    [switch]$NoStart,
    [switch]$Apply
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$Node = Get-Command "node" -ErrorAction Stop
$Cli = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\src\cli.js")).Path
$Arguments = @($Cli, "bind", "--root", $Root)
foreach ($Item in $Client) {
    $Arguments += @("--client", $Item)
}
if ($Initialize) { $Arguments += "--initialize" }
if ($Initialize) { $Arguments += @("--template", $Template) }
if ($CodexConfig) { $Arguments += @("--codex-config", $CodexConfig) }
if ($CursorConfig) { $Arguments += @("--cursor-config", $CursorConfig) }
if ($Refresh) { $Arguments += "--refresh" }
if ($Daemon) { $Arguments += "--daemon" }
if ($InstallRuntime) { $Arguments += "--install-runtime" }
if ($NoStart) { $Arguments += "--no-start" }
if ($Apply) { $Arguments += "--apply" }

& $Node.Source @Arguments
exit $LASTEXITCODE
