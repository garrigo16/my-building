# instalar.ps1 - deja un equipo listo para atender Slack y ver la oficina (Edificio de IAs).
# Uso (PowerShell, en la carpeta de este repo):   .\instalar.ps1 -Equipo casa
# Hace: comprueba lo necesario, guarda el nombre del equipo y crea las tareas programadas
param([Parameter(Mandatory=$true)][string]$Equipo)
$ErrorActionPreference = 'Stop'
$relevo = $PSScriptRoot   # la carpeta de este repo, este donde este
$cfg = Join-Path $env:USERPROFILE '.config'
New-Item -ItemType Directory -Force $cfg | Out-Null

Write-Host "1) Comprobaciones"
$falta = @()
$node = (Get-Command node -ErrorAction SilentlyContinue).Source; if (-not $node) { $falta += 'Node.js (nodejs.org, LTS)' }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { $falta += 'Git for Windows' }
# Git puede estar en otra unidad o carpeta: tambien se mira junto al git del PATH (sube desde cmd\git.exe o mingw64\bin\git.exe hasta la carpeta que tenga bin\bash.exe)
$gitExe = (Get-Command git -ErrorAction SilentlyContinue).Source
$bashJunto = ''; if ($gitExe) { $d = Split-Path $gitExe; for ($k = 0; $k -lt 3 -and $d -and -not $bashJunto; $k++) { $d = Split-Path $d; if ($d -and (Test-Path (Join-Path $d 'bin\bash.exe'))) { $bashJunto = Join-Path $d 'bin\bash.exe' } } }
if (-not (Test-Path "$env:LOCALAPPDATA\Programs\Git\bin\bash.exe") -and -not (Test-Path "$env:ProgramFiles\Git\bin\bash.exe") -and -not ($bashJunto -and (Test-Path $bashJunto))) { $falta += 'Git Bash' }
if (-not (Get-Command sf -ErrorAction SilentlyContinue)) { $falta += 'Salesforce CLI (sf) con login a QA, UAT y PRODOCA' }
if (-not (Get-ChildItem "$env:APPDATA\Claude\claude-code\*\*\claude.exe" -ErrorAction SilentlyContinue)) { $falta += 'Claude (app de escritorio, pestaña Code abierta al menos una vez)' }
if (-not (Test-Path (Join-Path $cfg 'canal-slack.env'))) { $falta += '~/.config/canal-slack.env (ver .env.example)' }
# v167: las claves que tiene que llevar canal-slack.env (solo se miran los NOMBRES, nunca los valores) y los otros ficheros
$envf = Join-Path $cfg 'canal-slack.env'
if (Test-Path $envf) {
  $hay = @(Get-Content $envf | ForEach-Object { if ($_ -match '^([A-Z_][A-Z0-9_]*)=') { $Matches[1] } })
  foreach ($k in 'SLACK_WEBHOOK_CANAL','SLACK_CURSOR_ID','CURSOR_API_KEY','CLAUDE_CODE_OAUTH_TOKEN','SLACK_HUMANO_ID','GROK_WEBHOOK_URL','GROK_WEBHOOK_KEY','SLACK_BOT_TOKEN','SLACK_APP_TOKEN','JIRA_EMAIL','JIRA_API_TOKEN','BITBUCKET_EMAIL','BITBUCKET_API_TOKEN') {
    if ($hay -notcontains $k) { $falta += "linea $k en ~/.config/canal-slack.env (ver .env.example)" }
  }
}
foreach ($f in 'oficina-slack.env','mulesoft.env','oficina-calendario.env') { if (-not (Test-Path (Join-Path $cfg $f))) { $falta += "~/.config/$f (ver .env.example; opcional)" } }
$repo = Join-Path $env:USERPROFILE 'Documents\Oca Global Repository\oca-salesforce'
if (-not (Test-Path $repo)) { $falta += "clon de oca-salesforce en $repo" }
# wt-canal-claude: el worktree de tu canal principal. (El de un segundo canal, wt-proyecto-claude, solo si lo pones en config.local.json.)
foreach ($wt in @('wt-canal-claude')) { if (-not (Test-Path (Join-Path $env:USERPROFILE $wt))) { $falta += "worktree $wt (SETUP.md, paso 4)" } }
if (-not (Test-Path (Join-Path $relevo 'config.local.json'))) { $falta += 'config.local.json (copia config.ejemplo.json y rellena tu nombre, tus IDs de Slack y tu rama del canal)' }
if ($falta.Count) { Write-Host "   Falta:" -ForegroundColor Yellow; $falta | ForEach-Object { Write-Host "   - $_" -ForegroundColor Yellow } } else { Write-Host "   Todo listo." -ForegroundColor Green }

Write-Host "2) Nombre de este equipo: $Equipo"
Set-Content -Path (Join-Path $cfg 'oficina-equipo.txt') -Value $Equipo.ToLower() -Encoding ascii

if (-not $node) { Write-Host "Sin Node no creo las tareas. Instálalo y vuelve a ejecutar." -ForegroundColor Red; exit 1 }
Write-Host "3) Tareas programadas"
$set = New-ScheduledTaskSettingsSet -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$tr = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$tareas = @{
  'Canal IAs - escucha Slack' = @{ js = Join-Path $relevo 'herramientas\escucha-slack.js'; wd = Join-Path $relevo 'herramientas' }
  'Canal IAs - oficina'       = @{ js = Join-Path $relevo 'oficina\server.js';             wd = Join-Path $relevo 'oficina' }
}
# v154: sin ventana (wscript + oculto-node.vbs). Con powershell -WindowStyle Hidden, Windows Terminal abría una pestaña visible.
$vbsNode = Join-Path $relevo 'herramientas\oculto-node.vbs'
foreach ($n in $tareas.Keys) {
  $a = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$vbsNode`" `"$($tareas[$n].js)`"" -WorkingDirectory $tareas[$n].wd
  Register-ScheduledTask -TaskName $n -Action $a -Trigger $tr -Settings $set -Force | Out-Null
  Write-Host "   $n creada"
}
$vbs = Join-Path $relevo 'herramientas\vigia-canal-oculto.vbs'
$aV = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$vbs`""
$tV = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 15) -RepetitionDuration (New-TimeSpan -Days 3650)
$sV = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
$nV = "Canal IAs - vig$([char]0xED)a"   # sin BOM, PowerShell 5.1 leería mal la «í»
Register-ScheduledTask -TaskName $nV -Action $aV -Trigger $tV -Settings $sV -Force | Out-Null
Write-Host "   $nV creada (cada 15 min)"
Write-Host ""
Write-Host "Listo. Para que ESTE equipo atienda Slack: doble clic en «Atender desde aqui.cmd»." -ForegroundColor Green
Write-Host "La oficina: http://127.0.0.1:4317 (arranca sola al iniciar sesión; ahora: Start-ScheduledTask 'Canal IAs - oficina')."
