param([switch]$UiTest,[string]$UiTestReport)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName PresentationFramework,PresentationCore,WindowsBase
Add-Type -AssemblyName System.Windows.Forms
. (Join-Path $PSScriptRoot 'setup-common.ps1')
$reader=[Xml.XmlReader]::Create([IO.StringReader]::new([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'mcp-manager.xaml'))))
try{$window=[Windows.Markup.XamlReader]::Load($reader)}finally{$reader.Dispose()}
function Find([string]$Name){return $window.FindName($Name)}
function Preserve-McpManagedMetadata([System.Collections.IDictionary]$Definition,$ExistingServer){
  if(-not $ExistingServer){return $Definition}
  $fields=switch($ExistingServer.source){
    'catalog' {@('source','catalogId','packageName','packageVersion','installDirectory');break}
    'github' {@('source','repositoryUrl','repositoryRef','packageName','packageVersion','installDirectory');break}
    default {@()}
  }
  foreach($field in $fields){
    if($null -ne $ExistingServer.$field){$Definition[$field]=$ExistingServer.$field}
  }
  return $Definition
}
function Fit-McpManagerWindow([Windows.Rect]$WorkArea){
  $maxWidth=[Math]::Max(1.0,$WorkArea.Width);$maxHeight=[Math]::Max(1.0,$WorkArea.Height)
  $window.MinWidth=[Math]::Min([double]$window.MinWidth,$maxWidth)
  $window.MinHeight=[Math]::Min([double]$window.MinHeight,$maxHeight)
  $window.MaxWidth=$maxWidth;$window.MaxHeight=$maxHeight
  $window.Width=[Math]::Min([double]$window.Width,$maxWidth)
  $window.Height=[Math]::Min([double]$window.Height,$maxHeight)
}
Fit-McpManagerWindow ([Windows.SystemParameters]::WorkArea)
$script:Node=Get-DwbNode
$script:Servers=@()
$script:OriginalEnv=@{}
$script:SelectedId=''
$script:BrokerRunning=$false

function Invoke-McpManager([string]$Action,$Payload=@{},[int]$TimeoutMs=20000){
  if(-not $script:Node){throw 'Node.js was not found. Run machine setup first.'}
  $info=New-Object Diagnostics.ProcessStartInfo
  $info.FileName=$script:Node
  $info.Arguments=(ConvertTo-DwbArgument (Join-Path $PSScriptRoot 'external-mcp-client.mjs'))+' '+(ConvertTo-DwbArgument $Action)
  $info.WorkingDirectory=$PSScriptRoot
  $info.UseShellExecute=$false;$info.CreateNoWindow=$true
  $info.RedirectStandardInput=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
  $info.StandardOutputEncoding=[Text.Encoding]::UTF8;$info.StandardErrorEncoding=[Text.Encoding]::UTF8
  $process=[Diagnostics.Process]::Start($info)
  $stdoutTask=$process.StandardOutput.ReadToEndAsync();$stderrTask=$process.StandardError.ReadToEndAsync()
  $json=ConvertTo-Json -InputObject $Payload -Depth 24 -Compress
  $inputBytes=[Text.Encoding]::UTF8.GetBytes($json)
  # Windows PowerShell 5.1's .NET Framework has no ProcessStartInfo.StandardInputEncoding setter.
  $process.StandardInput.BaseStream.Write($inputBytes,0,$inputBytes.Length);$process.StandardInput.Close()
  if($Action -in @('install','install-github')){Wait-McpManagerProcess $process $TimeoutMs}
  elseif(-not $process.WaitForExit($TimeoutMs)){try{$process.Kill()}catch{};throw 'MCP management timed out.'}
  $stdout=$stdoutTask.GetAwaiter().GetResult();$stderr=$stderrTask.GetAwaiter().GetResult()
  if($process.ExitCode -ne 0){throw $(if($stderr){$stderr.Trim()}else{'MCP management failed.'})}
  if(-not $stdout){throw 'MCP manager returned no response.'}
  return $stdout | ConvertFrom-Json
}

function Wait-McpManagerProcess([Diagnostics.Process]$Process,[int]$TimeoutMs){
  if($Process.WaitForExit(0)){return}
  $frame=New-Object Windows.Threading.DispatcherFrame
  $timer=New-Object Windows.Threading.DispatcherTimer
  $timer.Interval=[TimeSpan]::FromMilliseconds(100)
  $watch=[Diagnostics.Stopwatch]::StartNew();$state=@{TimedOut=$false}
  $tick={
    if($Process.HasExited){$frame.Continue=$false;$timer.Stop();return}
    if($watch.ElapsedMilliseconds -ge $TimeoutMs){
      $state.TimedOut=$true
      try{$Process.Kill()}catch{}
      $frame.Continue=$false;$timer.Stop()
    }
  }.GetNewClosure()
  $timer.Add_Tick($tick)
  try{$timer.Start();[Windows.Threading.Dispatcher]::PushFrame($frame)}finally{
    $timer.Stop();$timer.Remove_Tick($tick);$watch.Stop()
  }
  if($state.TimedOut){$Process.WaitForExit(5000)|Out-Null;throw 'MCP management timed out.'}
}

function Update-ServerList($Data){
  $script:Servers=@($Data.servers)
  $script:BrokerRunning=[bool]$Data.brokerRunning
  $rows=@(foreach($server in $script:Servers){
    $status=@($Data.status | Where-Object {$_.id -eq $server.id}) | Select-Object -First 1
    $hasError=[bool]($status -and $status.error)
    if($hasError){$state='ต้องตรวจสอบ';$stateKey='error'}
    elseif(-not $server.enabled){$state='ปิดใช้งาน';$stateKey='disabled'}
    elseif($status -and $status.runningSessions -gt 0){$state='กำลังทำงาน';$stateKey='running'}
    else{$state='พร้อมใช้ · เริ่มเมื่อเรียก';$stateKey='ready'}
    [pscustomobject]@{Name=$server.name;Id=$server.id;Command=$server.command;State=$state;StateKey=$stateKey;Sessions=$(if($status){$status.runningSessions}else{0});Error=$(if($hasError){$status.error}else{''})}
  })
  (Find 'Servers').ItemsSource=$rows
  (Find 'ServerCount').Text=[string]$rows.Count
  (Find 'EnabledCount').Text=[string]@($script:Servers | Where-Object {$_.enabled}).Count
  (Find 'RunningCount').Text=[string]@($rows | Where-Object {$_.StateKey -eq 'running'}).Count
  (Find 'ProblemCount').Text=[string]@($rows | Where-Object {$_.StateKey -eq 'error'}).Count
  (Find 'EmptyState').Visibility=if($rows.Count){'Collapsed'}else{'Visible'}
  $brokerText=if($script:BrokerRunning){'Broker กำลังทำงาน'}else{'รอ MCP เชื่อมต่อ'}
  $brokerBrush=if($script:BrokerRunning){[Windows.Media.Brushes]::MediumSeaGreen}else{[Windows.Media.Brushes]::SlateGray}
  (Find 'BrokerDot').Fill=$brokerBrush
  (Find 'BrokerDot').ToolTip=$brokerText
  (Find 'BrokerStatusIndicator').ToolTip=$brokerText
  [System.Windows.Automation.AutomationProperties]::SetName((Find 'BrokerDot'),$brokerText)
  (Find 'ActionStatus').Text=if($script:BrokerRunning){'บันทึกแล้วและซิงก์กับ Broker ที่กำลังทำงาน'}else{'Broker ยังไม่ทำงาน · การเปลี่ยนแปลงจะเริ่มใช้เมื่อ MCP เชื่อมต่อ'}
}

function Refresh-Servers{
  try{
    $data=Invoke-McpManager 'list' @{}
    Update-ServerList $data
    if($script:SelectedId){Load-Server $script:SelectedId}
  }catch{(Find 'ActionStatus').Text=$_.Exception.Message}
}

function Update-CatalogInfo{
  $entry=(Find 'Catalog').SelectedItem
  if(-not $entry){(Find 'CatalogInfo').Text='ยังไม่มี package ใน Catalog';return}
  (Find 'CatalogInfo').Text=$entry.description+' '+$entry.permissionSummary
  (Find 'AllowedDirectory').IsEnabled=[bool]$entry.allowedDirectoryArg
  (Find 'ChooseDirectory').IsEnabled=[bool]$entry.allowedDirectoryArg
}

function Set-GitHubInstallStatus([string]$Message,[ValidateSet('info','working','success','error')][string]$State='info'){
  $status=Find 'GitHubStatus';$panel=Find 'GitHubStatusPanel';$progress=Find 'GitHubProgress'
  $palette=@{
    info=@{Foreground='#AFC1D2';Border='#34446F'}
    working=@{Foreground='#8DEAF2';Border='#3A8190'}
    success=@{Foreground='#8AF0B8';Border='#34765B'}
    error=@{Foreground='#FF9AAE';Border='#9B455B'}
  }
  $converter=New-Object Windows.Media.BrushConverter
  $status.Text=$Message
  $status.Foreground=$converter.ConvertFromString($palette[$State].Foreground)
  $panel.BorderBrush=$converter.ConvertFromString($palette[$State].Border)
  $progress.Visibility=if($State -eq 'working'){'Visible'}else{'Collapsed'}
}

function Refresh-Catalog{
  try{
    $data=Invoke-McpManager 'catalog' @{}
    $script:Catalog=@($data.catalog)
    (Find 'Catalog').ItemsSource=$script:Catalog
    if($script:Catalog.Count -gt 0){(Find 'Catalog').SelectedIndex=0;Update-CatalogInfo}
  }catch{(Find 'CatalogInfo').Text=$_.Exception.Message}
}

function Load-Server([string]$IdValue){
  $server=@($script:Servers | Where-Object {$_.id -eq $IdValue}) | Select-Object -First 1
  if(-not $server){return}
  $script:SelectedId=$server.id
  (Find 'EditorTitle').Text='การตั้งค่า · '+$server.name
  (Find 'Editor').IsExpanded=$true
  (Find 'Id').Text=$server.id;(Find 'Id').IsEnabled=$false
  (Find 'Name').Text=$server.name
  (Find 'Command').Text=$server.command
  (Find 'Cwd').Text=[string]$server.cwd
  (Find 'Args').Text=[string]::Join([Environment]::NewLine,@($server.args))
  $script:OriginalEnv=@{}
  if($server.env){foreach($property in $server.env.PSObject.Properties){$script:OriginalEnv[$property.Name]=[string]$property.Value}}
  (Find 'Environment').Text=[string]::Join([Environment]::NewLine,@($script:OriginalEnv.Keys | Sort-Object | ForEach-Object {$_+'='}))
  (Find 'Enabled').IsChecked=[bool]$server.enabled
  (Find 'Editor').BringIntoView()
}

function New-ServerForm{
  $script:SelectedId='';$script:OriginalEnv=@{}
  (Find 'EditorTitle').Text='เพิ่ม MCP server เอง'
  (Find 'Editor').IsExpanded=$true
  (Find 'AdvancedSettings').IsExpanded=$false
  (Find 'Id').Text='';(Find 'Id').IsEnabled=$true
  (Find 'Name').Text='';(Find 'Command').Text='';(Find 'Cwd').Text=''
  (Find 'Args').Text='';(Find 'Environment').Text='';(Find 'Enabled').IsChecked=$true
  (Find 'Servers').SelectedItem=$null
  (Find 'Editor').BringIntoView()
}

(Find 'Refresh').Add_Click({Refresh-Servers})
(Find 'Catalog').Add_SelectionChanged({Update-CatalogInfo})
(Find 'ChooseDirectory').Add_Click({
  $dialog=New-Object System.Windows.Forms.FolderBrowserDialog
  $dialog.Description='Choose the directory this MCP server may access.'
  $dialog.ShowNewFolderButton=$false
  if($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK){(Find 'AllowedDirectory').Text=$dialog.SelectedPath}
  $dialog.Dispose()
})
(Find 'InstallCatalog').Add_Click({
  try{
    $entry=(Find 'Catalog').SelectedItem
    if(-not $entry){throw 'Choose a catalog package first.'}
    $directory=([string](Find 'AllowedDirectory').Text).Trim()
    if($entry.allowedDirectoryArg){
      if(-not $directory){throw 'Choose an allowed directory before installing Filesystem.'}
      $item=Get-Item -LiteralPath $directory -ErrorAction Stop
      if(-not $item.PSIsContainer){throw 'The allowed path must be a directory.'}
    }
    $payload=@{catalogId=$entry.id}
    if($directory){$payload.allowedDirectory=$directory}
    $data=Invoke-McpManager 'install' $payload
    Update-ServerList $data
    $script:SelectedId=$entry.id;Load-Server $entry.id
    (Find 'ActionStatus').Text='Installed but disabled. Select Enabled and save when you are ready to run this server.'
  }catch{(Find 'ActionStatus').Text=$_.Exception.Message}
})
(Find 'InstallGitHub').Add_Click({
  try{
    $repositoryUrl=([string](Find 'GitHubRepository').Text).Trim()
    if(-not $repositoryUrl){throw 'Paste a GitHub repository URL first.'}
    $confirmation=[Windows.MessageBox]::Show(
      "DWB จะดาวน์โหลด repo และรันสคริปต์ติดตั้ง/สร้างโปรแกรมของ npm ด้วยสิทธิ์บัญชี Windows นี้`n`nทำต่อเมื่อเชื่อถือแหล่งที่มาเท่านั้น เมื่อติดตั้งเสร็จ server จะยังปิดใช้งานอยู่`n`n$repositoryUrl",
      'ยืนยันติดตั้ง MCP จาก GitHub',
      [Windows.MessageBoxButton]::OKCancel,
      [Windows.MessageBoxImage]::Warning)
    if($confirmation -ne [Windows.MessageBoxResult]::OK){return}
    Set-GitHubInstallStatus 'กำลังดาวน์โหลด repo และติดตั้ง dependencies… อาจใช้เวลาหลายนาที' 'working'
    (Find 'ActionStatus').Text='กำลังติดตั้งจาก GitHub… กรุณารอสักครู่'
    $busyStates=@()
    foreach($name in @('InstallGitHub','InstallCatalog','Refresh','NewServer','SaveServer','RemoveServer')){
      $control=Find $name
      if($control){$busyStates+=,[pscustomobject]@{Control=$control;WasEnabled=[bool]$control.IsEnabled};$control.IsEnabled=$false}
    }
    try{
      $data=Invoke-McpManager 'install-github' @{repositoryUrl=$repositoryUrl} 600000
      Update-ServerList $data
      $script:SelectedId=[string]$data.installedId
      Load-Server $script:SelectedId
      Set-GitHubInstallStatus 'เพิ่ม server ในรายการแล้ว · ตอนนี้ปิดใช้งานอยู่ เลือก “เปิดใช้งาน” แล้วกดบันทึกเมื่อต้องการใช้' 'success'
      (Find 'ActionStatus').Text='ติดตั้งเรียบร้อย · เปิดใช้งานและบันทึกเพื่อเริ่มใช้ server นี้'
    }finally{foreach($state in $busyStates){$state.Control.IsEnabled=$state.WasEnabled}}
  }catch{
    $message=$_.Exception.Message
    Set-GitHubInstallStatus ('ติดตั้งไม่สำเร็จ · '+$message) 'error'
    (Find 'ActionStatus').Text='ติดตั้งจาก GitHub ไม่สำเร็จ · ไม่มีการเพิ่ม server'
    [Windows.MessageBox]::Show("ติดตั้ง MCP จาก GitHub ไม่สำเร็จ`n`n$message",'ติดตั้งจาก GitHub ไม่สำเร็จ',[Windows.MessageBoxButton]::OK,[Windows.MessageBoxImage]::Error)|Out-Null
  }
})
(Find 'NewServer').Add_Click({New-ServerForm})
(Find 'Servers').Add_SelectionChanged({$selected=(Find 'Servers').SelectedItem;if($selected){Load-Server $selected.Id}})
(Find 'SaveServer').Add_Click({
  try{
    $id=([string](Find 'Id').Text).Trim();$name=([string](Find 'Name').Text).Trim();$command=([string](Find 'Command').Text).Trim()
    if(-not $id -or -not $name -or -not $command){throw 'Enter Server ID, name, and command.'}
    $envMap=@{};foreach($key in $script:OriginalEnv.Keys){$envMap[$key]=$script:OriginalEnv[$key]}
    foreach($line in ([string](Find 'Environment').Text -split "`r?`n")){
      if(-not $line.Trim()){continue}
      $split=$line.IndexOf('=');if($split -lt 1){throw "Environment entries must use KEY=VALUE: $line"}
      $key=$line.Substring(0,$split).Trim();$value=$line.Substring($split+1)
      if($value -eq '!clear'){$envMap.Remove($key);continue}
      if($value -ne '' -or -not $envMap.ContainsKey($key)){$envMap[$key]=$value}
    }
    $args=@([string](Find 'Args').Text -split "`r?`n" | Where-Object {$_ -ne ''})
    $existingServer=@($script:Servers | Where-Object {$_.id -eq $id}) | Select-Object -First 1
    $next=@($script:Servers | Where-Object {$_.id -ne $id})
    $definition=@{id=$id;name=$name;command=$command;args=$args;cwd=([string](Find 'Cwd').Text).Trim();env=$envMap;enabled=[bool](Find 'Enabled').IsChecked}
    $definition=Preserve-McpManagedMetadata $definition $existingServer
    $next+=$definition
    $data=Invoke-McpManager 'save' @{servers=$next}
    $script:SelectedId=$id;Update-ServerList $data;Load-Server $id
    (Find 'ActionStatus').Text='MCP server saved.'
  }catch{(Find 'ActionStatus').Text=$_.Exception.Message}
})
(Find 'RemoveServer').Add_Click({
  try{
    if(-not $script:SelectedId){throw 'Select a server to remove.'}
    $data=Invoke-McpManager 'remove' @{id=$script:SelectedId}
    $script:SelectedId='';Update-ServerList $data;New-ServerForm
    (Find 'ActionStatus').Text='MCP server removed.'
  }catch{(Find 'ActionStatus').Text=$_.Exception.Message}
})
$window.Add_ContentRendered({Refresh-Catalog;Refresh-Servers})
if($UiTest){
  foreach($name in @('Servers','Refresh','NewServer','SaveServer','RemoveServer','Enabled','Id','Name','Command','Cwd','Args','Environment','Catalog','AllowedDirectory','ChooseDirectory','InstallCatalog','CatalogInfo','GitHubRepository','InstallGitHub','GitHubStatus','GitHubStatusPanel','GitHubProgress','ActionStatus','Editor','AdvancedSettings','EditorTitle','ServerCount','EnabledCount','RunningCount','ProblemCount','BrokerStatusIndicator','BrokerDot','EmptyState')){
    if(-not (Find $name)){throw "MCP Manager is missing control: $name"}
  }
  if(Find 'BrokerState'){throw 'The MCP broker status should be displayed as a dot, not a text label.'}
  $managerProbe=Invoke-McpManager 'catalog' @{}
  if(@($managerProbe.catalog).Count -ne 1 -or $managerProbe.catalog[0].id -ne 'filesystem'){throw 'MCP Manager could not exchange a UTF-8 request with its Node helper.'}
  $testData=Join-Path $env:TEMP ('dwb-mcp-manager-stdin-'+[Guid]::NewGuid().ToString('N'))
  $oldData=$env:DWB_DATA_DIR;$oldPipe=$env:DWB_BROKER_PIPE
  try{
    $env:DWB_DATA_DIR=$testData
    $env:DWB_BROKER_PIPE='\\.\pipe\dwb-mcp-manager-test-'+[Guid]::NewGuid().ToString('N')
    $unicodeServer=[pscustomobject]@{id='utf8-roundtrip';name='ทดสอบ MCP';command=$script:Node;args=@();env=@{LABEL='ภาษาไทย'};enabled=$false}
    $null=Invoke-McpManager 'save' @{servers=@($unicodeServer)}
    $unicodeProbe=Invoke-McpManager 'list' @{}
    if($unicodeProbe.servers[0].name -ne 'ทดสอบ MCP' -or $unicodeProbe.servers[0].env.LABEL -ne 'ภาษาไทย'){throw 'MCP Manager corrupted UTF-8 data sent to its Node helper.'}
  }finally{
    if($null -eq $oldData){Remove-Item Env:DWB_DATA_DIR -ErrorAction SilentlyContinue}else{$env:DWB_DATA_DIR=$oldData}
    if($null -eq $oldPipe){Remove-Item Env:DWB_BROKER_PIPE -ErrorAction SilentlyContinue}else{$env:DWB_BROKER_PIPE=$oldPipe}
    if(Test-Path -LiteralPath $testData){Remove-Item -LiteralPath $testData -Recurse -Force}
  }
  $packageCombo=Find 'Catalog';$null=$packageCombo.ApplyTemplate()
  $packagePopup=$packageCombo.Template.FindName('PART_Popup',$packageCombo)
  if($packagePopup -isnot [Windows.Controls.Primitives.Popup]){throw 'The server package selector is missing its custom dropdown surface.'}
  $packageCombo.ItemsSource=@([pscustomobject]@{name='Filesystem'},[pscustomobject]@{name='Other MCP'})
  $packageCombo.SelectedIndex=0;$packageCombo.IsDropDownOpen=$true;$window.UpdateLayout()
  if($packagePopup.PopupAnimation -ne [Windows.Controls.Primitives.PopupAnimation]::Fade -or $packagePopup.Placement -ne [Windows.Controls.Primitives.PlacementMode]::Bottom -or -not $packagePopup.AllowsTransparency -or $packageCombo.SelectedItem.name -ne 'Filesystem'){throw 'The custom server package selector did not preserve its selection and designed dropdown surface.'}
  $packageCombo.IsDropDownOpen=$false;$packageCombo.ItemsSource=$null
  Set-GitHubInstallStatus 'GitHub install failed: test diagnostic' 'error'
  if((Find 'GitHubStatus').Text -ne 'GitHub install failed: test diagnostic' -or (Find 'GitHubStatus').Visibility -ne [Windows.Visibility]::Visible -or (Find 'GitHubProgress').Visibility -ne [Windows.Visibility]::Collapsed){throw 'GitHub installation feedback is not visible in the install panel.'}
  Set-GitHubInstallStatus 'GitHub install is running' 'working'
  if((Find 'GitHubProgress').Visibility -ne [Windows.Visibility]::Visible){throw 'GitHub installation progress is not shown while work is running.'}
  $githubServer=[pscustomobject]@{
    source='github';repositoryUrl='https://github.com/example/raven-mcp';repositoryRef='main'
    packageName='raven-mcp';packageVersion='1.2.3';installDirectory='C:\DWB\mcp-servers\raven-mcp'
  }
  $edited=Preserve-McpManagedMetadata @{id='raven-mcp'} $githubServer
  foreach($field in @('source','repositoryUrl','repositoryRef','packageName','packageVersion','installDirectory')){
    if($edited[$field] -ne $githubServer.$field){throw "Editing a GitHub server dropped its managed $field metadata."}
  }
  $uiProbeState=@{Responsive=$false}
  $uiProbeTimer=New-Object Windows.Threading.DispatcherTimer
  $uiProbeTimer.Interval=[TimeSpan]::FromMilliseconds(20)
  $uiProbeTick={ $uiProbeState.Responsive=$true;$uiProbeTimer.Stop() }.GetNewClosure()
  $uiProbeTimer.Add_Tick($uiProbeTick);$uiProbeTimer.Start()
  $uiProbeInfo=New-Object Diagnostics.ProcessStartInfo
  $uiProbeInfo.FileName='powershell.exe';$uiProbeInfo.Arguments='-NoProfile -Command Start-Sleep -Milliseconds 250'
  $uiProbeInfo.UseShellExecute=$false;$uiProbeInfo.CreateNoWindow=$true
  $uiProbeProcess=[Diagnostics.Process]::Start($uiProbeInfo)
  try{Wait-McpManagerProcess $uiProbeProcess 5000}finally{
    $uiProbeTimer.Stop();$uiProbeTimer.Remove_Tick($uiProbeTick)
    if(-not $uiProbeProcess.HasExited){$uiProbeProcess.Kill()}
    $uiProbeProcess.Dispose()
  }
  if(-not $uiProbeState.Responsive){throw 'The MCP Manager UI did not stay responsive while a server was installing.'}
  $fixture=@{
    servers=@(
      [pscustomobject]@{id='filesystem';name='Filesystem';command='node.exe';enabled=$true;cwd='';args=@();env=@{}}
      [pscustomobject]@{id='search';name='Search';command='node.exe';enabled=$true;cwd='';args=@();env=@{}}
      [pscustomobject]@{id='manual';name='Manual';command='server.exe';enabled=$false;cwd='';args=@();env=@{}}
    )
    status=@(
      [pscustomobject]@{id='filesystem';runningSessions=1;error=''}
      [pscustomobject]@{id='search';runningSessions=0;error='Process exited unexpectedly'}
      [pscustomobject]@{id='manual';runningSessions=0;error=''}
    )
    brokerRunning=$true
  }
  Update-ServerList $fixture
  if((Find 'BrokerDot').ToolTip -ne 'Broker กำลังทำงาน'){throw 'The connected broker dot is missing its status tooltip.'}
  $brokerIndicator=Find 'BrokerStatusIndicator'
  if($brokerIndicator.Width -gt 34 -or $brokerIndicator.Height -gt 34){throw 'The MCP broker status indicator is larger than a compact dot control.'}
  $rows=@((Find 'Servers').ItemsSource)
  if((Find 'ServerCount').Text -ne '3' -or (Find 'EnabledCount').Text -ne '2' -or (Find 'RunningCount').Text -ne '1' -or (Find 'ProblemCount').Text -ne '1'){throw 'MCP summary cards did not reflect the server fixture.'}
  if($rows[0].State -ne 'กำลังทำงาน' -or $rows[1].State -ne 'ต้องตรวจสอบ' -or $rows[2].State -ne 'ปิดใช้งาน'){throw 'MCP server status labels were not mapped to their user-facing states.'}
  if((Find 'EmptyState').Visibility -ne [Windows.Visibility]::Collapsed){throw 'The empty state remained visible when servers were present.'}
  Update-ServerList @{servers=@();status=@();brokerRunning=$false}
  if((Find 'EmptyState').Visibility -ne [Windows.Visibility]::Visible){throw 'The empty state was not shown when no servers were present.'}
  if((Find 'BrokerDot').ToolTip -ne 'รอ MCP เชื่อมต่อ'){throw 'The waiting broker dot is missing its status tooltip.'}
  Update-ServerList $fixture
  (Find 'Editor').IsExpanded=$false
  $window.MinHeight=620;$window.Width=1000;$window.Height=620
  $window.Measure([Windows.Size]::new(1000,620))
  $window.Arrange([Windows.Rect]::new(0,0,1000,620))
  $window.UpdateLayout()
  $scroll=$window.Content
  $scroll.Measure([Windows.Size]::new(952,572))
  $scroll.Arrange([Windows.Rect]::new(0,0,952,572))
  $scroll.UpdateLayout()
  if($scroll -isnot [Windows.Controls.ScrollViewer] -or $scroll.ScrollableHeight -le 0){throw "The MCP manager cannot scroll its full editor on a short display (control=$($scroll.GetType().FullName); extent=$($scroll.ExtentHeight); viewport=$($scroll.ViewportHeight); actual=$($scroll.ActualHeight))."}
  $scroll.ScrollToTop()
  Load-Server 'filesystem'
  (Find 'AdvancedSettings').IsExpanded=$true
  $scroll.UpdateLayout()
  $editorTop=(Find 'Editor').TransformToAncestor($scroll).Transform([Windows.Point]::new(0,0)).Y
  if($editorTop -lt 0 -or $editorTop -ge $scroll.ViewportHeight){throw 'Selecting a server did not bring its editor into view.'}
  $previousBottom=[double]::NegativeInfinity
  foreach($name in @('CatalogPanel','SummaryCards','ServersPanel','Editor','FooterPanel')){
    $region=Find $name
    if(-not $region){throw "The MCP manager is missing its $name layout region."}
    $bounds=$region.TransformToAncestor($scroll).TransformBounds([Windows.Rect]::new(0,0,$region.ActualWidth,$region.ActualHeight))
    if($bounds.Width -le 0 -or $bounds.Height -le 0){throw "The MCP manager's $name section has no arranged display area."}
    if($bounds.Y -lt $previousBottom - 0.5){throw "The MCP manager's $name section overlaps the section above it."}
    $previousBottom=$bounds.Bottom
  }
  $scroll.ScrollToEnd()
  $window.UpdateLayout()
  $footer=Find 'ActionStatus'
  $footerBottom=$footer.TransformToAncestor($scroll).Transform([Windows.Point]::new(0,$footer.ActualHeight)).Y
  if($footerBottom -gt $scroll.ViewportHeight){throw 'The MCP manager footer is not reachable by scrolling on a short display.'}
  Fit-McpManagerWindow ([Windows.Rect]::new(0,0,900,600))
  if($window.Width -gt 900 -or $window.Height -gt 600 -or $window.MinWidth -gt 900 -or $window.MinHeight -gt 600){throw 'The MCP manager window does not fit within the available display area.'}
  if($UiTestReport){[IO.File]::WriteAllText($UiTestReport,'PASS: MCP Manager UI behavior: servers=3; enabled=2; running=1; issues=1; UTF-8 helper round-trip=verified; package selector=custom; broker status=dot-only; empty=visible; scroll=available; GitHub feedback=visible; progress=shown; window=fitted; layout=nonoverlapping')}
  $window.Close()
}else{$null=$window.ShowDialog()}
