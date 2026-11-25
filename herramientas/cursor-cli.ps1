<#
.SYNOPSIS
  Lanza Cursor por CLI con la sesion OCA (apiKeySource "login") para atender-cursor-slack.sh.

.DESCRIPTION
  Equivalente a cursor-ticket.ps1 pero para hilos de Slack: una sesion de chat por hilo (slack:<Hilo>),
  guardada en -MappingPath. Escribe solo el texto final en -OutFile (UTF-8 sin BOM) y el session_id en -SessionOutFile.
  Codigos de salida: 0 ok, 20 no hay cursor-agent, 21 guardia anti-tormenta/actualizador, 22 fallo de Cursor, 2 parametros.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$PromptFile,
    [Parameter(Mandatory = $true)][string]$WorkDir,
    [string]$Hilo,
    [string]$MappingPath,
    [Parameter(Mandatory = $true)][string]$OutFile,
    [string]$SessionOutFile
)

$ErrorActionPreference = 'Stop'

function Write-Err([string]$Message) { [Console]::Error.WriteLine("cursor-cli: $Message") }

# La clave de prepago (sin saldo) NO debe llegar al CLI: se quiere la sesion de login.
Remove-Item Env:CURSOR_API_KEY -ErrorAction SilentlyContinue

if ([string]::IsNullOrWhiteSpace($MappingPath)) {
    $base = if ($env:USERPROFILE) { $env:USERPROFILE } else { $env:HOME }
    $MappingPath = Join-Path $base '.canal-logs\cursor-cli-chats.json'
}

# --- Guardia (como cursor-ticket-guardian.ps1) ---
$guardian = 'C:\Users\jgarrigo\.codex\skills\cursor-cross-review\scripts\cursor-ticket-guardian.ps1'
$stormReason = $null
try {
    if (Test-Path -LiteralPath $guardian) {
        . $guardian
        $stormReason = Get-UpdaterStormReason
    } else {
        $procs = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
        $replace = @($procs | Where-Object { $_.Name -eq 'cmd.exe' -and [string]$_.CommandLine -match 'pending\.replace\.cmd' })
        $openConsole = @($procs | Where-Object { $_.Name -eq 'OpenConsole.exe' }).Count
        $r = @()
        if ($replace.Count -gt 0) { $r += "cmd pending.replace.cmd vivos=$($replace.Count)" }
        if ($openConsole -gt 5) { $r += "OpenConsole=$openConsole (>5)" }
        $stormReason = ($r -join '; ')
    }
} catch {
    $stormReason = $null
}
if ($stormReason) {
    Write-Err "GUARDIAN: abortado, no se lanza cursor-agent: $stormReason"
    exit 21
}

# --- Resolver cursor-agent ---
function Resolve-CursorAgent {
    if ($env:CURSOR_CLI) { return $env:CURSOR_CLI }
    if ($env:LOCALAPPDATA) {
        $dir = Join-Path $env:LOCALAPPDATA 'Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Local\cursor-agent'
        foreach ($n in @('cursor-agent.ps1', 'cursor-agent.cmd')) {
            $p = Join-Path $dir $n
            if (Test-Path -LiteralPath $p) { return $p }
        }
    }
    foreach ($name in @('cursor-agent', 'cursor-agent.cmd')) {
        $cmd = Get-Command $name -ErrorAction SilentlyContinue
        if ($cmd -and $cmd.Source -and ($cmd.Source -notmatch '\\AppData\\Local\\cursor-agent\\')) { return $cmd.Source }
    }
    return $null
}
$cursorAgent = Resolve-CursorAgent
if (-not $cursorAgent) {
    Write-Err 'no encuentro cursor-agent (ni CURSOR_CLI, ni la cache del paquete Codex, ni PATH).'
    exit 20
}

if (-not (Test-Path -LiteralPath $PromptFile)) { Write-Err "PromptFile no existe: $PromptFile"; exit 2 }
if (-not (Test-Path -LiteralPath $WorkDir)) { Write-Err "WorkDir no existe: $WorkDir"; exit 2 }

$utf8 = New-Object System.Text.UTF8Encoding $false
$promptText = [System.IO.File]::ReadAllText((Resolve-Path -LiteralPath $PromptFile).ProviderPath)

# --- Prompt largo: puntero corto en argv ---
$maxArgvPrompt = 8000
if ($promptText.Length -gt $maxArgvPrompt) {
    $sidecar = Join-Path (Split-Path -Parent (Resolve-Path -LiteralPath $PromptFile).ProviderPath) 'prompt-full.md'
    [System.IO.File]::WriteAllText($sidecar, $promptText, $utf8)
    $promptArg = @"
INSTRUCCIONES_EN_ARCHIVO: $sidecar

Abre ese archivo con la herramienta de lectura y ejecuta exactamente su contenido. La respuesta final debe ser lo que el archivo pide. No expliques este envoltorio.
"@
    Write-Err "Prompt largo ($($promptText.Length) chars): se pasa por archivo $sidecar."
} else {
    $promptArg = $promptText
}

# --- Mapa hilo -> chatId ---
$mapKey = if ($Hilo) { "slack:$Hilo" } else { $null }
function Read-Map {
    $m = [ordered]@{}
    if (Test-Path -LiteralPath $MappingPath) {
        try {
            $raw = [System.IO.File]::ReadAllText($MappingPath)
            if (-not [string]::IsNullOrWhiteSpace($raw)) {
                $o = $raw | ConvertFrom-Json
                foreach ($p in $o.PSObject.Properties) { $m[$p.Name] = $p.Value }
            }
        } catch { Write-Err "mapa ilegible, se ignora: $($_.Exception.Message)" }
    }
    return $m
}
function Save-Chat([string]$chatId) {
    if (-not $mapKey -or -not $chatId) { return }
    try {
        $dir = Split-Path -Parent $MappingPath
        if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        $m = Read-Map
        $m[$mapKey] = [ordered]@{ chatId = $chatId; updatedAt = (Get-Date).ToUniversalTime().ToString('o') }
        $tmp = "$MappingPath.$([guid]::NewGuid().ToString('N')).tmp"
        [System.IO.File]::WriteAllText($tmp, (($m | ConvertTo-Json -Depth 10) + "`n"), $utf8)
        Move-Item -LiteralPath $tmp -Destination $MappingPath -Force
    } catch { Write-Err "no pude guardar el mapa: $($_.Exception.Message)" }
}

$prevChat = $null
if ($mapKey) {
    $map = Read-Map
    if ($map.Contains($mapKey)) {
        $e = $map[$mapKey]
        $c = if ($e -is [string]) { $e } else { [string]$e.chatId }
        if (-not [string]::IsNullOrWhiteSpace($c)) { $prevChat = $c }
    }
}

# --- Una invocacion: devuelve @{ ExitCode; Result; SessionId; IsError; Detalle } ---
function Invoke-Cursor([string]$resumeId) {
    $argv = New-Object System.Collections.Generic.List[string]
    $argv.Add('--disable-auto-update'); $argv.Add('-p')
    if ($resumeId) { $argv.Add('--resume'); $argv.Add($resumeId) }
    $argv.Add('--output-format'); $argv.Add('stream-json')
    $argv.Add('--trust')
    $argv.Add('--workspace'); $argv.Add($WorkDir)
    $argv.Add($promptArg)
    $invokeArgs = $argv.ToArray()

    $prevEap = $ErrorActionPreference
    $prevEnc = [Console]::OutputEncoding
    $ErrorActionPreference = 'Continue'
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $lines = @(); $code = 0
    Push-Location -LiteralPath $WorkDir
    try {
        $global:LASTEXITCODE = 0   # el guardian activa StrictMode: sin esto, leerlo tras un .ps1 sin exit da error
        $lines = @(& $cursorAgent @invokeArgs 2>&1)
        $code = $global:LASTEXITCODE
    } catch {
        $lines += "excepcion: $($_.Exception.Message)"; $code = 1
    } finally {
        Pop-Location
        [Console]::OutputEncoding = $prevEnc
        $ErrorActionPreference = $prevEap
    }
    if ($null -eq $code) { $code = 0 }

    $res = $null; $sid = $null; $isErr = $false; $otros = New-Object System.Collections.Generic.List[string]
    foreach ($l in $lines) {
        $s = ([string]$l).Trim()
        if (-not $s) { continue }
        $ev = $null
        if ($s.StartsWith('{')) { try { $ev = $s | ConvertFrom-Json } catch { $ev = $null } }
        if ($null -eq $ev) { $otros.Add($s); continue }
        $tipo = [string]$ev.type
        if ($ev.PSObject.Properties['session_id'] -and $ev.session_id) { $sid = [string]$ev.session_id }
        if ($tipo -eq 'result') {
            $res = [string]$ev.result
            $isErr = ($ev.PSObject.Properties['is_error'] -and $ev.is_error -eq $true)
            if ($ev.PSObject.Properties['session_id'] -and $ev.session_id) { $sid = [string]$ev.session_id }
        }
    }
    $detalle = ($otros | Select-Object -Last 8) -join ' | '
    return @{ ExitCode = $code; Result = $res; SessionId = $sid; IsError = $isErr; Detalle = $detalle }
}

function Test-Ok($r) { return ($r.ExitCode -eq 0 -and -not $r.IsError -and -not [string]::IsNullOrWhiteSpace($r.Result)) }

$r = Invoke-Cursor $prevChat
if (-not (Test-Ok $r) -and $prevChat) {
    Write-Err "fallo con --resume $prevChat (exit=$($r.ExitCode)): reintento en sesion nueva."
    $r = Invoke-Cursor $null
}

if (-not (Test-Ok $r)) {
    $why = if ($r.ExitCode -ne 0) { "exit=$($r.ExitCode)" } elseif ($r.IsError) { 'is_error=true' } elseif ($null -eq $r.Result) { 'sin evento result' } else { 'result vacio' }
    $extra = if ($r.IsError -and $r.Result) { " result=$($r.Result)" } else { '' }
    Write-Err "Cursor CLI fallo ($why):$extra $($r.Detalle)"
    exit 22
}

if ($r.SessionId) { Save-Chat $r.SessionId }
if ($SessionOutFile -and $r.SessionId) { [System.IO.File]::WriteAllText($SessionOutFile, $r.SessionId, $utf8) }
$texto = ($r.Result -replace "`r", '').Trim()
[System.IO.File]::WriteAllText($OutFile, $texto, $utf8)
exit 0
