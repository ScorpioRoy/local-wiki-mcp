# Install or remove the current-user Startup shortcut for the shared local-wiki runtime.

param(
    [Parameter(Mandatory = $true)]
    [string]$Root,
    [switch]$Uninstall,
    [switch]$NoStart
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$KnowledgeRoot = (Resolve-Path -LiteralPath $Root).Path
$WatchScript = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "local-wiki-watch.ps1")).Path
$Startup = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $Startup "Local Wiki Runtime.lnk"
$LegacyShortcutPath = Join-Path $Startup "Local Wiki Watch.lnk"

if ($Uninstall) {
    if (Test-Path -LiteralPath $ShortcutPath) {
        Remove-Item -LiteralPath $ShortcutPath -Force
    }
    if (Test-Path -LiteralPath $LegacyShortcutPath) {
        Remove-Item -LiteralPath $LegacyShortcutPath -Force
    }
    Write-Host "Removed the current-user local-wiki runtime startup shortcut." -ForegroundColor Green
    exit 0
}

Get-Command "node" -ErrorAction Stop | Out-Null
$PowerShellCandidates = @()
if ($env:SystemRoot) {
    $PowerShellCandidates += (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe')
}
foreach ($CommandName in @('powershell.exe', 'pwsh.exe')) {
    $Command = Get-Command $CommandName -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($Command) { $PowerShellCandidates += $Command.Source }
}
$PowerShell = $PowerShellCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -Unique | Select-Object -First 1
if (-not $PowerShell) {
    throw 'No usable Windows PowerShell or pwsh executable was found.'
}
if ((Test-Path -LiteralPath $LegacyShortcutPath) -and ($LegacyShortcutPath -ne $ShortcutPath)) {
    Remove-Item -LiteralPath $LegacyShortcutPath -Force
}
$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $PowerShell
$Shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$WatchScript`" -Root `"$KnowledgeRoot`""
$Shortcut.WorkingDirectory = $KnowledgeRoot
$Shortcut.WindowStyle = 7
$Shortcut.Description = "Local Wiki shared search runtime and index watcher"
$Shortcut.Save()

Write-Host "Installed the current-user startup shortcut: $ShortcutPath" -ForegroundColor Green

if (-not $NoStart) {
    Start-Process -FilePath $PowerShell `
        -ArgumentList @(
            "-NoProfile",
            "-ExecutionPolicy", "Bypass",
            "-WindowStyle", "Hidden",
            "-File", $WatchScript,
            "-Root", $KnowledgeRoot
        ) `
        -WorkingDirectory $KnowledgeRoot `
        -WindowStyle Hidden
    Write-Host "Started the local-wiki runtime." -ForegroundColor Green
}
