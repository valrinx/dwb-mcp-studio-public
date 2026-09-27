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
function Set-DwbWindowsStartup([bool]$Enabled,[string]$RegistryPath='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run') {
  $name='N3zuui Studio'
  $legacyName='DWB MCP Studio'
  if($Enabled){
    $exe=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\N3zuui Studio.exe'))
    if(-not(Test-Path -LiteralPath $exe)){throw 'N3zuui launcher is missing.'}
    if(-not(Test-Path -Path $RegistryPath)){$null=New-Item -Path $RegistryPath -Force}
    $command='"'+$exe+'" --startup --data-dir "'+(Get-DwbDataDirectory)+'"'
    $null=New-ItemProperty -Path $RegistryPath -Name $name -Value $command -PropertyType String -Force
    if((Get-Item -Path $RegistryPath).GetValue($legacyName,$null) -ne $null){Remove-ItemProperty -Path $RegistryPath -Name $legacyName -ErrorAction Stop}
  }elseif(Test-Path -Path $RegistryPath){
    foreach($entry in @($name,$legacyName)){
      if((Get-Item -Path $RegistryPath).GetValue($entry,$null) -ne $null){Remove-ItemProperty -Path $RegistryPath -Name $entry -ErrorAction Stop}
    }
  }
}
function Save-DwbPreferences($Preferences,[string]$RegistryPath='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run') {
  $root=Get-DwbDataDirectory
  $null=New-Item -ItemType Directory -Path $root -Force
  $path=Join-Path $root 'preferences.json'
  $temp=$path+'.'+[Guid]::NewGuid().ToString('N')+'.tmp'
  $previous=Get-DwbPreferences
  [IO.File]::WriteAllText($temp,($Preferences | ConvertTo-Json),(New-Object Text.UTF8Encoding($false)))
  try{
    Set-DwbWindowsStartup ([bool]$Preferences.startWithWindows) $RegistryPath
    if(Test-Path -LiteralPath $path){[IO.File]::Replace($temp,$path,[NullString]::Value)}else{[IO.File]::Move($temp,$path)}
  }catch{
    Set-DwbWindowsStartup ([bool]$previous.startWithWindows) $RegistryPath
    throw
  }finally{if(Test-Path -LiteralPath $temp){Remove-Item -LiteralPath $temp}}
}
