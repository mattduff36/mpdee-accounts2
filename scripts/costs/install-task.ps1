param([string]$StorageBase = $env:LOCALAPPDATA)
$ErrorActionPreference = 'Stop'
$taskName = 'MPDEE Accounts Cost Collector'
$taskDirectory = Join-Path $StorageBase 'mpdee-accounts\costs-automation'
$sourceDirectory = $PSScriptRoot
$nodePath = (Get-Command node).Source
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) { throw 'Task already exists; inspect it before updating.' }
New-Item -ItemType Directory -Path (Join-Path $taskDirectory 'collector') -Force | Out-Null
Get-ChildItem -LiteralPath $sourceDirectory -Filter '*.mjs' | Where-Object { $_.Name -notlike '*.test.mjs' } | Copy-Item -Destination (Join-Path $taskDirectory 'collector')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'scheduled-runner.cjs') -Destination (Join-Path $taskDirectory 'runner.cjs')
@{ uploadEnabled = $false; storageBase = $StorageBase; runtimeFile = (Join-Path $StorageBase 'mpdee-accounts\dev-ledger\runtime.json') } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskDirectory 'config.json') -Encoding UTF8
# Node accepts a BOM only for modules, so write configuration as UTF-8 without BOM.
$configPath = Join-Path $taskDirectory 'config.json'
$configText = Get-Content -LiteralPath $configPath -Raw
[IO.File]::WriteAllText($configPath, $configText, [Text.UTF8Encoding]::new($false))
$userId = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute $nodePath -Argument ('"' + (Join-Path $taskDirectory 'runner.cjs') + '"')
$hourly = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Hours 1)
$logon = New-ScheduledTaskTrigger -AtLogOn -User $userId
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 45) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($hourly,$logon) -Principal $principal -Settings $settings -Description 'Collects sanitized account-wide Cursor usage locally; upload disabled pending preview automation authorization. Independent of commits and pushes.' | Out-Null
$task = Get-ScheduledTask -TaskName $taskName
[pscustomobject]@{ TaskName=$task.TaskName; State=$task.State; TriggerCount=$task.Triggers.Count; RunLevel=$task.Principal.RunLevel; UploadEnabled=$false } | ConvertTo-Json
