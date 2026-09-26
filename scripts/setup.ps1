param([string]$PreviewPath, [string]$TestRequestFile, [switch]$ConfigureOnly)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework,PresentationCore,WindowsBase,System.Windows.Forms
. (Join-Path $PSScriptRoot 'setup-common.ps1')
. (Join-Path $PSScriptRoot 'external-common.ps1')
$script:IsUpgrade=Test-Path -LiteralPath (Get-DwbConfigPath)
$managedConfigured=$false
$installationCurrent=$false
try {
  $node=Get-DwbNode
  if ($node) { $installationCurrent=(Invoke-DwbNode $node @((Join-Path $PSScriptRoot 'upgrade.mjs'), 'check') (Split-Path -Parent $PSScriptRoot)).Trim() -eq 'true' }
} catch {}
try { $managedConfigured=(Get-Content -LiteralPath (Get-DwbConfigPath) -Raw | ConvertFrom-Json).workerEntry -eq (Get-DwbExternalPaths).Worker } catch {}
if (-not $PreviewPath -and -not $TestRequestFile -and -not $ConfigureOnly -and $installationCurrent -and $managedConfigured -and (Get-DwbManagedWorkerState).Ready -and (Get-DwbManagedTunnelState).Ready -and (Test-Path -LiteralPath (Join-Path $PSScriptRoot '..\node_modules\@modelcontextprotocol\sdk\package.json'))) {
  & (Join-Path $PSScriptRoot 'dashboard.ps1')
  return
}
function Open-DwbTunnelSetup {
  if($global:DwbShell){Set-DwbPage 'dashboard';return}
  $arguments = '-NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File ' + (ConvertTo-DwbArgument (Join-Path $PSScriptRoot 'dashboard.ps1'))
  Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -WindowStyle Hidden | Out-Null
}
$script:Running = $null
$script:JobDirectory = $null
$script:ClientConfig = $null
$script:Cancelled = $false
$script:Machine = $null
$script:CapacityValue = 4
$Muted = [Windows.Media.BrushConverter]::new().ConvertFromString('#8499AD')
$Green = [Windows.Media.BrushConverter]::new().ConvertFromString('#81D7B5')
$Orange = [Windows.Media.BrushConverter]::new().ConvertFromString('#EDB77D')

$markup = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'setup.xaml'))
$reader = [Xml.XmlReader]::Create([IO.StringReader]::new($markup))
try { $window = [Windows.Markup.XamlReader]::Load($reader) } finally { $reader.Dispose() }
if($global:DwbShell){Register-DwbWindow $window}
function Find([string]$Name) { return $window.FindName($Name) }
$workerInput = Find 'WorkerInput'
$workspaceInput = Find 'WorkspaceInput'
$workerStatus = Find 'WorkerStatus'
$machineLabel = Find 'MachineLabel'
$npmLabel = Find 'NpmLabel'
$refresh = Find 'Refresh'
$downloadNode = Find 'DownloadNode'
$workerBrowse = Find 'WorkerBrowse'
$workspaceBrowse = Find 'WorkspaceBrowse'
$workerHelp = Find 'WorkerHelp'
$save = Find 'Save'
$copy = Find 'Copy'
$showFile = Find 'ShowFile'
$progress = Find 'Progress'
$resultLabel = Find 'ResultLabel'
$increase = Find 'Increase'
$decrease = Find 'Decrease'

$logoPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\assets\n3zuui-mark.png'))
$logo = New-Object Windows.Media.Imaging.BitmapImage
$logo.BeginInit()
$logo.CacheOption = [Windows.Media.Imaging.BitmapCacheOption]::OnLoad
$logo.UriSource = New-Object Uri($logoPath)
$logo.EndInit()
$logo.Freeze()
(Find 'BrandImage').ImageSource = $logo
$window.Icon = $logo

function Set-Capacity([int]$Value) {
  $script:CapacityValue = [Math]::Min(64,[Math]::Max(1,$Value))
  (Find 'Capacity').Text = [string]$script:CapacityValue
  $decrease.IsEnabled = $script:CapacityValue -gt 1
  $increase.IsEnabled = $script:CapacityValue -lt 64
}
function Update-Placeholders {
  (Find 'WorkerPlaceholder').Visibility = 'Visible'
  (Find 'WorkspacePlaceholder').Visibility = if ($workspaceInput.Text) { 'Collapsed' } else { 'Visible' }
}
function Update-WorkerStatus {
  $workerInput.Text=(Get-DwbExternalPaths).Worker
  $dc=Get-DwbManagedWorkerState
  $tunnel=Get-DwbManagedTunnelState
  $workerStatus.Text='Desktop Commander 0.2.50: ' + $(if($dc.Ready){'พร้อม'}else{'รอติดตั้ง'}) + '  ·  Tunnel 0.0.11: ' + $(if($tunnel.Ready){'พร้อม'}else{'รอติดตั้ง'})
  if ($script:IsUpgrade -and (-not $dc.Ready -or -not $tunnel.Ready)) { $workerStatus.Text='ตรวจและนำส่วนประกอบจาก N3zuui เดิมมาใช้เมื่อกดอัปเดต · ติดตั้งเพิ่มเฉพาะที่ขาด' }
  $workerStatus.Foreground=if($dc.Ready -and $tunnel.Ready){$Green}else{$Muted}
}
function Update-Machine {
  $script:Machine = Get-DwbMachineState
  if ($script:Machine.NodeReady) {
    $machineLabel.Text = 'Windows พร้อมใช้  ·  Node.js ' + $script:Machine.Version
    $machineLabel.Foreground = $Green
    (Find 'MachineDot').Background = $Green
    $downloadNode.Visibility = 'Collapsed'
  } else {
    $machineLabel.Text = 'ต้องมี Node.js 22.16 ขึ้นไป'
    $machineLabel.Foreground = $Orange
    (Find 'MachineDot').Background = $Orange
    $downloadNode.Visibility = 'Visible'
  }
  if ($script:Machine.NpmReady) { $npmLabel.Text = 'npm พร้อมติดตั้งส่วนประกอบ N3zuui'; $npmLabel.Foreground = $Muted }
  else { $npmLabel.Text = 'ติดตั้ง npm พร้อม Node.js แล้วตรวจซ้ำ'; $npmLabel.Foreground = $Orange }
  Update-WorkerStatus
}
function Stop-Setup {
  if ($script:Running -and -not $script:Running.HasExited) {
    $script:Cancelled = $true
    $null = Start-Process -FilePath 'taskkill.exe' -ArgumentList @('/PID', [string]$script:Running.Id, '/T', '/F') -WindowStyle Hidden -Wait -PassThru
  }
}
function Set-Busy([bool]$Value) {
  foreach ($control in @((Find 'DashboardHome'),$workerInput,$workspaceInput,$increase,$decrease,$workerBrowse,$workspaceBrowse,$refresh,$workerHelp,$downloadNode)) { $control.IsEnabled = -not $Value }
  $progress.Visibility = if ($Value) { 'Visible' } else { 'Collapsed' }
  if ($Value) { $save.Content = 'ยกเลิกการติดตั้ง'; $copy.IsEnabled = $false; $showFile.IsEnabled = $false }
  else { $save.Content = if($script:IsUpgrade){'อัปเดตและใช้การตั้งค่าเดิม  →'}else{'ติดตั้งและเตรียมใช้งาน  →'}; Set-Capacity $script:CapacityValue }
}

(Find 'TitleBar').Add_MouseLeftButtonDown({ if ($_.OriginalSource -isnot [Windows.Controls.Button]) { try { $window.DragMove() } catch {} } })
(Find 'DashboardHome').Add_Click({if($script:Running){return};Open-DwbTunnelSetup;if(-not $global:DwbShell){$window.Close()}})
(Find 'Minimize').Add_Click({ $window.WindowState = 'Minimized' })
(Find 'CloseWindow').Add_Click({ $window.Close() })
$refresh.Add_Click({ Update-Machine })
$downloadNode.Add_Click({ [Diagnostics.Process]::Start('https://nodejs.org/en/download') | Out-Null })
$increase.Add_Click({ Set-Capacity ($script:CapacityValue + 1) })
$decrease.Add_Click({ Set-Capacity ($script:CapacityValue - 1) })
$workerInput.Add_TextChanged({ Update-Placeholders })
$workspaceInput.Add_TextChanged({ Update-Placeholders })
$workerInput.Add_LostFocus({ Update-WorkerStatus })
$workspaceBrowse.Add_Click({
  $dialog = New-Object Windows.Forms.FolderBrowserDialog
  $dialog.Description = 'เลือกโฟลเดอร์งานที่ต้องการให้ MCP ใช้'
  if ($workspaceInput.Text -and (Test-Path -LiteralPath $workspaceInput.Text -PathType Container)) { $dialog.SelectedPath = $workspaceInput.Text }
  if ($dialog.ShowDialog() -eq 'OK') { $workspaceInput.Text = $dialog.SelectedPath; $workspaceInput.CaretIndex = $workspaceInput.Text.Length }
  $dialog.Dispose()
})
(Find 'WorkspaceHelp').Add_Click({
  $guidePath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\docs\workspaces.html'))
  $startInfo = New-Object Diagnostics.ProcessStartInfo
  $startInfo.FileName = $guidePath
  $startInfo.UseShellExecute = $true
  [Diagnostics.Process]::Start($startInfo) | Out-Null
})

$timer = New-Object Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds(250)
$timer.Add_Tick({
  if (-not $script:Running) { return }
  $phasePath = Join-Path $script:JobDirectory 'phase.txt'
  if (Test-Path -LiteralPath $phasePath) {
    try {
      $phase = [IO.File]::ReadAllText($phasePath)
      $messages = @{ runtime='กำลังตรวจและปิด broker เดิมที่จบงานแล้ว · อาจใช้เวลาประมาณ 75 วินาที…'; checking='กำลังตรวจเครื่องและโฟลเดอร์งาน…'; migrating='กำลังนำส่วนประกอบจาก DWB รุ่นเดิมมาใช้…'; external='กำลังติดตั้ง Desktop Commander และ tunnel-client ลง external ของ DWB…'; installing='กำลังดาวน์โหลดส่วนประกอบ DWB จาก npm…'; building='กำลังเตรียมโปรแกรมจาก source…'; saving='กำลังบันทึกการตั้งค่า…'; verifying='กำลังตรวจการตั้งค่าครั้งสุดท้าย…' }
      if ($messages.ContainsKey($phase)) { $resultLabel.Text = $messages[$phase] }
    } catch {}
  }
  if (-not $script:Running.HasExited) { return }
  $timer.Stop()
  $script:Running.Dispose()
  $script:Running = $null
  Set-Busy $false
  $resultPath = Join-Path $script:JobDirectory 'result.json'
  try {
    if ($script:Cancelled) { throw 'Installation cancelled.' }
    if (-not (Test-Path -LiteralPath $resultPath)) { throw 'Setup stopped before creating a result. See the setup log.' }
    $result = Get-Content -LiteralPath $resultPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $result.ok) { throw $result.message }
    $script:ClientConfig = $result.clientConfig
    Update-Machine
    $resultLabel.Foreground = $Green
    $resultLabel.Text = if($script:IsUpgrade){'พร้อมใช้งาน · เปิด Dashboard แล้วกด Start MCP ด้วยการเชื่อมต่อที่บันทึกไว้ได้เลย'}else{'ตั้งค่าเครื่องเรียบร้อย · ขั้นต่อไปกรอก Tunnel ID และ API key แล้วกด Start MCP'}
    $copy.IsEnabled = $true
    $showFile.Content = 'เปิดไฟล์ ↗'
    $showFile.IsEnabled = $true
    $save.Content = 'บันทึกอีกครั้ง  →'
    if (-not $TestRequestFile -and -not $PreviewPath) { Open-DwbTunnelSetup; $window.Close() }
  } catch {
    $resultLabel.Foreground = $Orange
    if ($script:Cancelled) { $resultLabel.Text = 'ยกเลิกแล้ว กดบันทึกอีกครั้งเมื่อต้องการดำเนินการต่อ' }
    else { $resultLabel.Text = 'ตั้งค่ายังไม่สำเร็จ · เปิดบันทึกเพื่อดูสาเหตุ แล้วลองใหม่'; $resultLabel.ToolTip = $_.Exception.Message }
    $script:ClientConfig = $null
    $showFile.Content = 'ดูบันทึก ↗'
    $showFile.IsEnabled = $true
  }
})
$save.Add_Click({
  if ($script:Running) { Stop-Setup; return }
  try {
    Update-Machine
    if (-not $script:Machine.NodeReady -or -not $script:Machine.NpmReady) { throw 'ติดตั้ง Node.js พร้อม npm แล้วกดตรวจซ้ำก่อน' }
    $workspace = $workspaceInput.Text.Trim().Trim('"')
    if (-not $workspace -or -not [IO.Path]::IsPathRooted($workspace) -or -not (Test-Path -LiteralPath $workspace -PathType Container)) { throw 'เลือกโฟลเดอร์งานที่มีอยู่จริงก่อนบันทึก' }
    $script:JobDirectory = Join-Path (Get-DwbDataDirectory) ('logs\setup-' + [Guid]::NewGuid().ToString('N'))
    $null = New-Item -ItemType Directory -Path $script:JobDirectory -Force
    $requestPath = Join-Path $script:JobDirectory 'request.json'
    $request = @{ workspace=$workspace; workerCap=$script:CapacityValue }
    [IO.File]::WriteAllText($requestPath, ($request | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
    $launchArguments = '-NoProfile -ExecutionPolicy Bypass -File ' + (ConvertTo-DwbArgument (Join-Path $PSScriptRoot 'setup-install.ps1')) + ' -RequestFile ' + (ConvertTo-DwbArgument $requestPath)
    $script:Cancelled = $false
    $script:Running = Start-Process -FilePath 'powershell.exe' -ArgumentList $launchArguments -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $script:JobDirectory 'stdout.log') -RedirectStandardError (Join-Path $script:JobDirectory 'stderr.log')
    Set-Busy $true
    $resultLabel.Foreground = $Muted
    $resultLabel.Text = 'กำลังเริ่มติดตั้ง…'
    $timer.Start()
  } catch { $resultLabel.Foreground = $Orange; $resultLabel.Text = $_.Exception.Message }
})
$copy.Add_Click({
  try { [Windows.Clipboard]::SetText([IO.File]::ReadAllText($script:ClientConfig)); $resultLabel.Text = 'คัดลอกแล้ว · นำไปเพิ่มใน MCP client หรือ tunnel ของคุณได้เลย' }
  catch { $resultLabel.Text = 'คัดลอกไม่ได้ ลองเปิดไฟล์แล้วคัดลอกด้วยตัวเอง'; $resultLabel.Foreground = $Orange }
})
$showFile.Add_Click({
  if ($script:ClientConfig) { [Diagnostics.Process]::Start('explorer.exe', ('/select,"' + $script:ClientConfig + '"')) | Out-Null }
  elseif ($script:JobDirectory) { [Diagnostics.Process]::Start('explorer.exe', (ConvertTo-DwbArgument $script:JobDirectory)) | Out-Null }
})
$window.Add_Closing({ param($sender,$eventArgs) if(-not $eventArgs.Cancel){Stop-Setup; $timer.Stop()} })

try {
  $savedPath = Get-DwbConfigPath
  if (Test-Path -LiteralPath $savedPath) {
    $saved = Get-Content -LiteralPath $savedPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $workspaceInput.Text = [string]$saved.workspace
    (Find 'SetupHeading').Text = 'อัปเดต N3zuui ของคุณ'
    (Find 'SetupDescription').Text = 'ใช้ส่วนประกอบและการตั้งค่าเดิม · ไม่ต้องสร้าง Tunnel หรือผูก connector ใหม่'
    $save.Content = 'อัปเดตและใช้การตั้งค่าเดิม  →'
    $resultLabel.Text = 'Workspace, Tunnel ID และ key ที่เคยบันทึกไว้จะยังอยู่'
    if ($saved.workerCap -ge 1 -and $saved.workerCap -le 64) { Set-Capacity $saved.workerCap }
  }
} catch { $resultLabel.Text = 'อ่านการตั้งค่าเดิมไม่ได้ เลือกโปรแกรมและโฟลเดอร์เพื่อบันทึกใหม่' }
Update-Machine
Update-Placeholders

# Scale down as a complete layout on smaller screens, keeping every action reachable.
$available = [Windows.SystemParameters]::WorkArea
$scale = [Math]::Min(1,[Math]::Min(($available.Width-20)/$window.Width,($available.Height-20)/$window.Height))
if ($scale -lt 1 -and -not $PreviewPath) {
  $window.Content.LayoutTransform = New-Object Windows.Media.ScaleTransform($scale,$scale)
  $window.Width *= $scale
  $window.Height *= $scale
}
function Pump-Events { $window.Dispatcher.Invoke([Action]{}, [Windows.Threading.DispatcherPriority]::Background) }
if ($PreviewPath -or $TestRequestFile) {
  $window.ShowInTaskbar = $false
  $window.WindowStartupLocation = 'Manual'
  $window.Left = -20000
  $window.Top = -20000
  $window.Show()
  Pump-Events
  if ($TestRequestFile) {
    $test = Get-Content -LiteralPath $TestRequestFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $workspaceInput.Text = $test.workspace
    Set-Capacity $test.workerCap
    $save.RaiseEvent((New-Object Windows.RoutedEventArgs([Windows.Controls.Button]::ClickEvent)))
    if (-not $script:Running) { throw ('GUI did not start installation: ' + $resultLabel.Text) }
    $deadline = [DateTime]::UtcNow.AddMinutes(3)
    while ($script:Running -and [DateTime]::UtcNow -lt $deadline) { Pump-Events; Start-Sleep -Milliseconds 100 }
    if ($script:Running) { Stop-Setup; throw 'GUI setup test timed out.' }
    if (-not $script:ClientConfig -or -not $copy.IsEnabled -or -not $showFile.IsEnabled) { throw ('GUI setup did not reach success: ' + $resultLabel.Text + ' Logs: ' + $script:JobDirectory) }
    Write-Output 'GUI_SETUP_PASS'
  }
  if ($PreviewPath) {
    $window.UpdateLayout()
    Pump-Events
    $render = New-Object Windows.Media.Imaging.RenderTargetBitmap([int]$window.ActualWidth,[int]$window.ActualHeight,96,96,[Windows.Media.PixelFormats]::Pbgra32)
    $render.Render($window)
    $encoder = New-Object Windows.Media.Imaging.PngBitmapEncoder
    $encoder.Frames.Add([Windows.Media.Imaging.BitmapFrame]::Create($render))
    $stream = [IO.File]::Create([IO.Path]::GetFullPath($PreviewPath))
    try { $encoder.Save($stream) } finally { $stream.Dispose() }
  }
  $window.Close()
} else { if($global:DwbShell){Show-DwbWindow $window}else{$null = $window.ShowDialog()} }
$timer.Stop()
