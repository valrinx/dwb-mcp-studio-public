$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'setup-common.ps1')
. (Join-Path $PSScriptRoot 'preferences-common.ps1')
$env:DWB_DATA_DIR=Join-Path ([IO.Path]::GetTempPath()) ('dwb-preferences-'+[Guid]::NewGuid().ToString('N'))
$registry='HKCU:\Software\DWB-Preferences-Test-'+[Guid]::NewGuid().ToString('N')
try{
  $prefs=Get-DwbPreferences
  if($prefs.startWithWindows -or $prefs.closeAction -ne 'tray' -or -not $prefs.minimizeToTray){throw 'Wrong defaults'}
  $null=New-Item -Path $registry
  $null=New-ItemProperty -Path $registry -Name 'Another application' -Value 'preserve'
  $null=New-ItemProperty -Path $registry -Name 'DWB MCP Studio' -Value '"C:\legacy\DWB MCP Studio.exe" --startup --data-dir "C:\legacy-data"'
  $prefs.startWithWindows=$true;$prefs.closeAction='exit';$prefs.minimizeToTray=$false
  Save-DwbPreferences $prefs $registry
  $saved=Get-DwbPreferences
  if(-not $saved.startWithWindows -or $saved.closeAction -ne 'exit' -or $saved.minimizeToTray){throw 'Preferences did not round-trip'}
  $command=(Get-Item -Path $registry).GetValue('N3zuui Studio')
  if($command -notmatch '^".*N3zuui Studio.exe" --startup --data-dir "[^"\r\n]+"$'){throw 'Startup command quoting is wrong'}
  if(-not $command.Contains($env:DWB_DATA_DIR)){throw 'Custom data folder was lost'}
  if((Get-Item -Path $registry).GetValue('DWB MCP Studio',$null) -ne $null){throw 'Legacy DWB startup entry was not migrated'}
  $prefs.startWithWindows=$false
  Save-DwbPreferences $prefs $registry
  if((Get-Item -Path $registry).GetValue('N3zuui Studio',$null) -ne $null){throw 'Startup entry was not removed'}
  if((Get-Item -Path $registry).GetValue('Another application') -ne 'preserve'){throw 'Unrelated startup value was modified'}
  Add-Type -AssemblyName PresentationFramework,PresentationCore,WindowsBase
  . (Join-Path $PSScriptRoot 'preferences-ui.ps1')
  $global:DwbShell=@{Window=$null;Preferences=$null}
  $uiReport=Join-Path $env:DWB_DATA_DIR 'ui-test.txt'
  Show-DwbPreferences $registry $uiReport
  if([IO.File]::ReadAllText($uiReport) -ne 'PASS'){throw 'Preferences Save button failed'}
  $saved=Get-DwbPreferences
  if(-not $saved.startWithWindows -or $saved.closeAction -ne 'exit' -or $saved.minimizeToTray){throw 'Preferences UI choices were not saved'}
  $next=Join-Path $env:DWB_DATA_DIR 'new version'
  $null=New-Item -ItemType Directory -Path (Join-Path $next 'scripts') -Force
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot '..\N3zuui Studio.exe') -Destination $next
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'preferences-common.ps1') -Destination (Join-Path $next 'scripts')
  . (Join-Path $next 'scripts\preferences-common.ps1')
  Set-DwbWindowsStartup $true $registry
  if(-not (Get-Item -Path $registry).GetValue('N3zuui Studio').Contains($next)){throw 'Startup path did not update to the new release'}
  $global:DwbShell=$null
  Write-Output 'PREFERENCES_UI_PASS: actual WPF choices and Save button.'
  Write-Output 'PREFERENCES_PASS: safe defaults, saved choices, isolated registry on/off, quoted launcher/data path, unrelated values preserved.'
}finally{if(Test-Path -Path $registry){Remove-Item -Path $registry}}
