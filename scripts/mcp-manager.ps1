param([switch]$UiTest,[string]$UiTestReport)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName PresentationFramework,PresentationCore,WindowsBase
Add-Type -AssemblyName System.Windows.Forms
. (Join-Path $PSScriptRoot 'setup-common.ps1')
$reader=[Xml.XmlReader]::Create([IO.StringReader]::new([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'mcp-manager.xaml'))))
try{$window=[Windows.Markup.XamlReader]::Load($reader)}finally{$reader.Dispose()}
function Find([string]$Name){return $window.FindName($Name)}
$script:Node=Get-DwbNode
$script:Servers=@()
$script:OriginalEnv=@{}
$script:SelectedId=''
$script:BrokerRunning=$false

function Invoke-McpManager([string]$Action,$Payload=@{}){
  if(-not $script:Node){throw 'Node.js was not found. Run machine setup first.'}
  $info=New-Object Diagnostics.ProcessStartInfo
  $info.FileName=$script:Node
  $info.Arguments=(ConvertTo-DwbArgument (Join-Path $PSScriptRoot 'external-mcp-client.mjs'))+' '+(ConvertTo-DwbArgument $Action)
  $info.WorkingDirectory=$PSScriptRoot
  $info.UseShellExecute=$false;$info.CreateNoWindow=$true
  $info.RedirectStandardInput=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
  $info.StandardInputEncoding=[Text.Encoding]::UTF8;$info.StandardOutputEncoding=[Text.Encoding]::UTF8;$info.StandardErrorEncoding=[Text.Encoding]::UTF8
  $process=[Diagnostics.Process]::Start($info)
  $stdoutTask=$process.StandardOutput.ReadToEndAsync();$stderrTask=$process.StandardError.ReadToEndAsync()
  $json=ConvertTo-Json -InputObject $Payload -Depth 24 -Compress
  $process.StandardInput.Write($json);$process.StandardInput.Close()
  if(-not $process.WaitForExit(20000)){try{$process.Kill()}catch{};throw 'MCP management timed out.'}
  $stdout=$stdoutTask.GetAwaiter().GetResult();$stderr=$stderrTask.GetAwaiter().GetResult()
  if($process.ExitCode -ne 0){throw $(if($stderr){$stderr.Trim()}else{'MCP management failed.'})}
  if(-not $stdout){throw 'MCP manager returned no response.'}
  return $stdout | ConvertFrom-Json
}

function Update-ServerList($Data){
  $script:Servers=@($Data.servers)
  $script:BrokerRunning=[bool]$Data.brokerRunning
  $rows=@(foreach($server in $script:Servers){
    $status=@($Data.status | Where-Object {$_.id -eq $server.id}) | Select-Object -First 1
    $state=if(-not $server.enabled){'Disabled'}elseif($status.error){'Error'}elseif($status.runningSessions -gt 0){'Running'}else{'Enabled - starts on use'}
    [pscustomobject]@{Name=$server.name;Id=$server.id;Command=$server.command;State=$state;Sessions=$(if($status){$status.runningSessions}else{0});Error=$(if($status.error){$status.error}else{''})}
  })
  (Find 'Servers').ItemsSource=$rows
  (Find 'ActionStatus').Text=if($script:BrokerRunning){'Saved and synchronized with the running broker.'}else{'Broker is stopped. Changes are saved locally and will apply when MCP connects.'}
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
  if(-not $entry){(Find 'CatalogInfo').Text='No curated packages are available.';return}
  (Find 'CatalogInfo').Text=$entry.description+' '+$entry.permissionSummary
  (Find 'AllowedDirectory').IsEnabled=[bool]$entry.allowedDirectoryArg
  (Find 'ChooseDirectory').IsEnabled=[bool]$entry.allowedDirectoryArg
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
  (Find 'Id').Text=$server.id;(Find 'Id').IsEnabled=$false
  (Find 'Name').Text=$server.name
  (Find 'Command').Text=$server.command
  (Find 'Cwd').Text=[string]$server.cwd
  (Find 'Args').Text=[string]::Join([Environment]::NewLine,@($server.args))
  $script:OriginalEnv=@{}
  if($server.env){foreach($property in $server.env.PSObject.Properties){$script:OriginalEnv[$property.Name]=[string]$property.Value}}
  (Find 'Environment').Text=[string]::Join([Environment]::NewLine,@($script:OriginalEnv.Keys | Sort-Object | ForEach-Object {$_+'='}))
  (Find 'Enabled').IsChecked=[bool]$server.enabled
}

function New-ServerForm{
  $script:SelectedId='';$script:OriginalEnv=@{}
  (Find 'Id').Text='';(Find 'Id').IsEnabled=$true
  (Find 'Name').Text='';(Find 'Command').Text='';(Find 'Cwd').Text=''
  (Find 'Args').Text='';(Find 'Environment').Text='';(Find 'Enabled').IsChecked=$true
  (Find 'Servers').SelectedItem=$null
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
    if($existingServer -and $existingServer.source -eq 'catalog'){
      foreach($field in @('source','catalogId','packageName','packageVersion','installDirectory')){
        if($null -ne $existingServer.$field){$definition[$field]=$existingServer.$field}
      }
    }
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
  foreach($name in @('Servers','Refresh','NewServer','SaveServer','RemoveServer','Enabled','Id','Name','Command','Cwd','Args','Environment','Catalog','AllowedDirectory','ChooseDirectory','InstallCatalog','CatalogInfo','ActionStatus')){
    if(-not (Find $name)){throw "MCP Manager is missing control: $name"}
  }
  if($UiTestReport){[IO.File]::WriteAllText($UiTestReport,'PASS: MCP Manager WPF loaded with server list and editor controls.')}
  $window.Close()
}else{$null=$window.ShowDialog()}
