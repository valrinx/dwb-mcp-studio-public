$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'setup-common.ps1')
. (Join-Path $PSScriptRoot 'preferences-common.ps1')
$env:DWB_DATA_DIR=Join-Path ([IO.Path]::GetTempPath()) ('dwb-preferences-'+[Guid]::NewGuid().ToString('N'))
$registry='HKCU:\Software\DWB-Preferences-Test-'+[Guid]::NewGuid().ToString('N')
$startupTaskName='N3zuui Studio Startup Test '+[Guid]::NewGuid().ToString('N')
try{
  $prefs=Get-DwbPreferences
  if($prefs.startWithWindows -or $prefs.closeAction -ne 'tray' -or -not $prefs.minimizeToTray){throw 'Wrong defaults'}
  $null=New-Item -Path $registry
  $null=New-ItemProperty -Path $registry -Name 'Another application' -Value 'preserve'
  $null=New-ItemProperty -Path $registry -Name 'DWB MCP Studio' -Value '"C:\legacy\DWB MCP Studio.exe" --startup --data-dir "C:\legacy-data"'
  $prefs.startWithWindows=$true;$prefs.closeAction='exit';$prefs.minimizeToTray=$false
  Save-DwbPreferences $prefs $registry $startupTaskName
  $saved=Get-DwbPreferences
  if(-not $saved.startWithWindows -or $saved.closeAction -ne 'exit' -or $saved.minimizeToTray){throw 'Preferences did not round-trip'}
  $command=(Get-Item -Path $registry).GetValue('N3zuui Studio')
  if($command -notmatch '^".*N3zuui Studio.exe" --startup --data-dir "[^"\r\n]+"$'){throw 'Startup command quoting is wrong'}
  if(-not $command.Contains($env:DWB_DATA_DIR)){throw 'Custom data folder was lost'}
  if((Get-Item -Path $registry).GetValue('DWB MCP Studio',$null) -ne $null){throw 'Legacy DWB startup entry was not migrated'}
  $task=Get-ScheduledTask -TaskName $startupTaskName -ErrorAction SilentlyContinue
  if(-not $task){throw 'Login startup task was not registered'}
  if($task.Actions[0].Execute -ne [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\N3zuui Studio.exe'))){throw 'Startup task targets the wrong launcher'}
  if($task.Actions[0].Arguments -ne ('--startup --data-dir "'+$env:DWB_DATA_DIR+'"')){throw 'Startup task lost its startup mode or data folder'}
  if($task.Triggers[0].Delay -ne 'PT30S'){throw 'Startup task is not delayed until the user session settles'}
  $prefs.startWithWindows=$false
  Save-DwbPreferences $prefs $registry $startupTaskName
  if((Get-Item -Path $registry).GetValue('N3zuui Studio',$null) -ne $null){throw 'Startup entry was not removed'}
  if(Get-ScheduledTask -TaskName $startupTaskName -ErrorAction SilentlyContinue){throw 'Login startup task was not removed'}
  if((Get-Item -Path $registry).GetValue('Another application') -ne 'preserve'){throw 'Unrelated startup value was modified'}
  Add-Type -AssemblyName PresentationFramework,PresentationCore,WindowsBase
  . (Join-Path $PSScriptRoot 'preferences-ui.ps1')
  $global:DwbShell=@{Window=$null;Preferences=$null}
  . (Join-Path $PSScriptRoot 'tunnel-common.ps1')
  $null=New-Item -ItemType Directory -Path (Get-DwbTunnelDirectory) -Force
  $testKey=ConvertTo-SecureString 'preferences-test-key' -AsPlainText -Force
  [IO.File]::WriteAllText((Join-Path (Get-DwbTunnelDirectory) 'key.dpapi'),(ConvertFrom-SecureString $testKey))
  $uiReport=Join-Path $env:DWB_DATA_DIR 'ui-test.txt'
  Show-DwbPreferences $registry $uiReport $startupTaskName
  if([IO.File]::ReadAllText($uiReport) -ne 'PASS'){throw 'Preferences Save button failed'}
  $saved=Get-DwbPreferences
  if($saved.startWithWindows -or -not $saved.connectOnStartup -or $saved.closeAction -ne 'exit' -or $saved.minimizeToTray){throw 'Preferences UI choices were not saved'}
  $next=Join-Path $env:DWB_DATA_DIR 'new version'
  $null=New-Item -ItemType Directory -Path (Join-Path $next 'scripts') -Force
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot '..\N3zuui Studio.exe') -Destination $next
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'preferences-common.ps1') -Destination (Join-Path $next 'scripts')
  . (Join-Path $next 'scripts\preferences-common.ps1')
  Set-DwbWindowsStartup $true $registry $startupTaskName
  if(-not (Get-Item -Path $registry).GetValue('N3zuui Studio').Contains($next)){throw 'Startup path did not update to the new release'}
  $global:DwbShell=$null
  Write-Output 'PREFERENCES_UI_PASS: actual WPF choices and Save button.'
  Write-Output 'PREFERENCES_PASS: safe defaults, saved choices, isolated registry on/off, quoted launcher/data path, unrelated values preserved.'
}finally{
  if(Get-ScheduledTask -TaskName $startupTaskName -ErrorAction SilentlyContinue){Unregister-ScheduledTask -TaskName $startupTaskName -Confirm:$false}
  if(Test-Path -Path $registry){Remove-Item -Path $registry}
}
