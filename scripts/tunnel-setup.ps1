param([string]$PreviewPath, [string]$TestRequestFile)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework,PresentationCore,WindowsBase
. (Join-Path $PSScriptRoot 'tunnel-common.ps1')
$reader = [Xml.XmlReader]::Create([IO.StringReader]::new([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'tunnel-setup.xaml'))))
try { $window = [Windows.Markup.XamlReader]::Load($reader) } finally { $reader.Dispose() }
if($global:DwbShell){Register-DwbWindow $window}
function Find([string]$Name) { return $window.FindName($Name) }
$tunnelInput = Find 'TunnelId'
$keyInput = Find 'ApiKey'
$remember = Find 'RememberKey'
$status = Find 'Status'
$startButton = Find 'StartMcp'
$stopButton = Find 'StopMcp'
$script:ClientExe = ''
$script:WasRunning = $false
$script:StartedAt = $null
$logo = [Windows.Media.Imaging.BitmapImage]::new([Uri][IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\assets\n3zuui-mark.png')))
(Find 'Logo').Source = $logo
$window.Icon = $logo
function Update-Client {
  (Find 'ClientPath').Text = 'external\tunnel-client\tunnel-client.exe'
  (Find 'ClientPath').ToolTip = $script:ClientExe
  (Find 'ClientStatus').Text = if ($script:ClientExe) { 'tunnel-client ประจำ N3zuui นี้ · พร้อมใช้' } else { 'ยังไม่มีส่วนประกอบใน N3zuui นี้ · กดติดตั้ง' }
}
function Set-TunnelInputs([bool]$Enabled) {
  foreach ($control in @($tunnelInput,$keyInput,$remember,(Find 'BrowseClient'),(Find 'MachineSetup'),$startButton)) { $control.IsEnabled=$Enabled }
  $stopButton.IsEnabled = -not $Enabled
}
function Update-TunnelState {
  try {
    $state = Get-DwbTunnelStatus
    if ($state.state -eq 'stopped') {
      Set-TunnelInputs $true
      if ($script:WasRunning) { $status.Text='tunnel-client หยุดแล้ว · ตรวจ API key และไฟล์โปรแกรม แล้วลอง Start อีกครั้ง'; $status.Foreground='#EDB77D' }
      $script:WasRunning=$false
      return
    }
    $script:WasRunning=$true
    Set-TunnelInputs $false
    $running = Read-DwbTunnelJson 'process.json'
    if ($state.ready) {
      $status.Text='MCP พร้อมตามการตรวจของ tunnel-client · ' + $running.tunnelId + "`nลองเรียก dwb_broker_status จากแชทที่เชื่อม tunnel นี้"
      $status.Foreground='#81D7B5'
    } else {
      $status.Text='กำลังเชื่อมต่อ OpenAI · ' + $running.tunnelId
      $status.Foreground='#EDB77D'
      if (-not $script:StartedAt) { $script:StartedAt=[DateTime]::UtcNow }
      if (([DateTime]::UtcNow - $script:StartedAt).TotalSeconds -gt 35) { $status.Text='ยังเชื่อมต่อไม่สำเร็จ · ตรวจ Tunnel ID, สิทธิ์ API key และอินเทอร์เน็ต กด Stop เพื่อแก้ไข' }
    }
  } catch { $status.Text='อ่านสถานะไม่ได้ · เปิดหน้านี้ใหม่เพื่อตรวจอีกครั้ง'; $status.Foreground='#EDB77D' }
}
$startButton.Add_Click({
  try {
    $status.Text='กำลังเตรียมการเชื่อมต่อ…'
    $null = Start-DwbTunnel $tunnelInput.Text $keyInput.SecurePassword ([bool]$remember.IsChecked) $script:ClientExe
    $keyInput.Clear()
    $script:StartedAt=[DateTime]::UtcNow
    $script:WasRunning=$true
    (Find 'KeyHint').Text=if ($remember.IsChecked) { 'จำ key ไว้แล้ว · เว้นว่างเพื่อใช้เดิม หรือกรอกใหม่เพื่อเปลี่ยน' } else { 'ไม่ได้จำ key · กรอกใหม่เมื่อ Start ครั้งถัดไป' }
    Update-TunnelState
  } catch { $status.Text=$_.Exception.Message; $status.Foreground='#EDB77D' }
})
$stopButton.Add_Click({
  try { Stop-DwbTunnel; $script:WasRunning=$false; $script:StartedAt=$null; Update-TunnelState; $status.Text='หยุด MCP แล้ว · กด Start MCP เมื่อพร้อม'; $status.Foreground='#9DB2C5' }
  catch { $status.Text='หยุดไม่สำเร็จ · ' + $_.Exception.Message; $status.Foreground='#EDB77D' }
})
(Find 'BrowseClient').Add_Click({ (Find 'MachineSetup').RaiseEvent((New-Object Windows.RoutedEventArgs([Windows.Controls.Button]::ClickEvent))) })
(Find 'Dashboard').Add_Click({
  if($global:DwbShell){Set-DwbPage 'dashboard';return}
  $arguments='-NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File ' + (ConvertTo-DwbArgument (Join-Path $PSScriptRoot 'dashboard.ps1'))
  Start-Process -FilePath powershell.exe -ArgumentList $arguments -WindowStyle Hidden | Out-Null
  $window.Close()
})
(Find 'MachineSetup').Add_Click({
  if($global:DwbShell){Set-DwbPage 'setup-config';return}
  $arguments='-NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File ' + (ConvertTo-DwbArgument (Join-Path $PSScriptRoot 'setup.ps1')) + ' -ConfigureOnly'
  Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -WindowStyle Hidden | Out-Null
  $window.Close()
})
try {
  $saved=Read-DwbTunnelJson 'settings.json'
  if ($saved) { $tunnelInput.Text=$saved.tunnelId; $remember.IsChecked=[bool]$saved.rememberKey }
  $script:ClientExe=Find-DwbTunnelClient
  if (Test-Path -LiteralPath (Join-Path (Get-DwbTunnelDirectory) 'key.dpapi')) { (Find 'KeyHint').Text='จำ key ไว้แล้ว · เว้นว่างเพื่อใช้เดิม หรือกรอกใหม่เพื่อเปลี่ยน' }
} catch { $status.Text='อ่านค่าที่บันทึกไว้ไม่ได้ · เลือกโปรแกรมและกรอกข้อมูลใหม่' }
Update-Client
Update-TunnelState
$timer=New-Object Windows.Threading.DispatcherTimer
$timer.Interval=[TimeSpan]::FromSeconds(2)
$timer.Add_Tick({ Update-TunnelState })
$window.Add_Closed({ $timer.Stop() })
if ($PreviewPath -or $TestRequestFile) {
  $window.ShowInTaskbar=$false
  $window.WindowStartupLocation='Manual'
  $window.Left=-20000; $window.Top=-20000
  $window.Show(); $window.UpdateLayout()
  $window.Dispatcher.Invoke([Action]{},[Windows.Threading.DispatcherPriority]::Background)
  if ($TestRequestFile) {
    $test=Get-Content -LiteralPath $TestRequestFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $script:ClientExe=$test.executable
    $tunnelInput.Text=$test.tunnelId
    $keyInput.Password=$test.testKey
    $remember.IsChecked=$false
    Update-Client
    $startButton.RaiseEvent((New-Object Windows.RoutedEventArgs([Windows.Controls.Button]::ClickEvent)))
    $deadline=[DateTime]::UtcNow.AddSeconds(10)
    while (-not (Get-DwbTunnelStatus).ready -and [DateTime]::UtcNow -lt $deadline) { $window.Dispatcher.Invoke([Action]{},[Windows.Threading.DispatcherPriority]::Background); Start-Sleep -Milliseconds 100 }
    Update-TunnelState
    if (-not $stopButton.IsEnabled -or $startButton.IsEnabled -or -not (Get-DwbTunnelStatus).ready) { Stop-DwbTunnel; throw ('GUI Start failed: ' + $status.Text) }
    $stopButton.RaiseEvent((New-Object Windows.RoutedEventArgs([Windows.Controls.Button]::ClickEvent)))
    if (-not $startButton.IsEnabled -or $stopButton.IsEnabled -or (Get-DwbTunnelProcess)) { Stop-DwbTunnel; throw 'GUI Stop failed.' }
    Write-Output 'TUNNEL_GUI_PASS: real WPF Start/Stop actions and status'
  }
  if ($PreviewPath) {
  $render=New-Object Windows.Media.Imaging.RenderTargetBitmap([int]$window.ActualWidth,[int]$window.ActualHeight,96,96,[Windows.Media.PixelFormats]::Pbgra32)
  $render.Render($window)
  $encoder=New-Object Windows.Media.Imaging.PngBitmapEncoder
  $encoder.Frames.Add([Windows.Media.Imaging.BitmapFrame]::Create($render))
  $stream=[IO.File]::Create([IO.Path]::GetFullPath($PreviewPath))
  try { $encoder.Save($stream) } finally { $stream.Dispose() }
  }
  $window.Close()
} else { $timer.Start(); if($global:DwbShell){Show-DwbWindow $window}else{$null=$window.ShowDialog()} }
