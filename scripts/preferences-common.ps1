function Get-DwbPreferences {
  $defaults=@{startWithWindows=$false;connectOnStartup=$false;closeAction='tray';minimizeToTray=$true}
  $path=Join-Path (Get-DwbDataDirectory) 'preferences.json'
  if(Test-Path -LiteralPath $path){
    try{$saved=Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json}catch{$defaults.readError='อ่านค่าการเปิดและปิดแอปไม่ได้ ใช้ค่าเริ่มต้นชั่วคราว กรุณาบันทึกตัวเลือกอีกครั้ง';return $defaults}
    foreach($key in @('startWithWindows','connectOnStartup','minimizeToTray')){if($saved.$key -is [bool]){$defaults[$key]=$saved.$key}}
    if($saved.closeAction -in @('tray','exit')){$defaults.closeAction=$saved.closeAction}
  }
  return $defaults
}
function Set-DwbWindowsStartup([bool]$Enabled,[string]$RegistryPath='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run',[string]$StartupTaskName='N3zuui Studio Startup') {
  $name='N3zuui Studio'
  $legacyName='DWB MCP Studio'
  if($Enabled){
    $exe=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\N3zuui Studio.exe'))
    if(-not(Test-Path -LiteralPath $exe)){throw 'N3zuui launcher is missing.'}
    if(-not(Test-Path -Path $RegistryPath)){$null=New-Item -Path $RegistryPath -Force}
    $dataDirectory=Get-DwbDataDirectory
    $identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name
    $trigger=New-ScheduledTaskTrigger -AtLogOn -User $identity
    $trigger.Delay='PT30S'
    $action=New-ScheduledTaskAction -Execute $exe -Argument ('--startup --data-dir '+(ConvertTo-DwbArgument $dataDirectory)) -WorkingDirectory (Split-Path -Parent $exe)
    $principal=New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
    $settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero)
    $task=New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings
    Register-ScheduledTask -TaskName $StartupTaskName -InputObject $task -Force | Out-Null
    $command='"'+$exe+'" --startup --data-dir "'+$dataDirectory+'"'
    $null=New-ItemProperty -Path $RegistryPath -Name $name -Value $command -PropertyType String -Force
    if((Get-Item -Path $RegistryPath).GetValue($legacyName,$null) -ne $null){Remove-ItemProperty -Path $RegistryPath -Name $legacyName -ErrorAction Stop}
  }else{
    if(Get-ScheduledTask -TaskName $StartupTaskName -ErrorAction SilentlyContinue){Unregister-ScheduledTask -TaskName $StartupTaskName -Confirm:$false -ErrorAction Stop}
    if(Test-Path -Path $RegistryPath){
      foreach($entry in @($name,$legacyName)){
        if((Get-Item -Path $RegistryPath).GetValue($entry,$null) -ne $null){Remove-ItemProperty -Path $RegistryPath -Name $entry -ErrorAction Stop}
      }
    }
  }
}
function Save-DwbPreferences($Preferences,[string]$RegistryPath='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run',[string]$StartupTaskName='N3zuui Studio Startup') {
  $root=Get-DwbDataDirectory
  $null=New-Item -ItemType Directory -Path $root -Force
  $path=Join-Path $root 'preferences.json'
  $temp=$path+'.'+[Guid]::NewGuid().ToString('N')+'.tmp'
  $previous=Get-DwbPreferences
  [IO.File]::WriteAllText($temp,($Preferences | ConvertTo-Json),(New-Object Text.UTF8Encoding($false)))
  try{
    Set-DwbWindowsStartup ([bool]$Preferences.startWithWindows) $RegistryPath $StartupTaskName
    if(Test-Path -LiteralPath $path){[IO.File]::Replace($temp,$path,[NullString]::Value)}else{[IO.File]::Move($temp,$path)}
  }catch{
    Set-DwbWindowsStartup ([bool]$previous.startWithWindows) $RegistryPath $StartupTaskName
    throw
  }finally{if(Test-Path -LiteralPath $temp){Remove-Item -LiteralPath $temp}}
}
