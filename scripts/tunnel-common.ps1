. (Join-Path $PSScriptRoot 'setup-common.ps1')

. (Join-Path $PSScriptRoot 'external-common.ps1')
function Get-DwbTunnelDirectory { return Join-Path (Get-DwbDataDirectory) 'tunnel' }
function Read-DwbTunnelJson([string]$Name) {
  $path = Join-Path (Get-DwbTunnelDirectory) $Name
  if (Test-Path -LiteralPath $path) { return Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json }
  return $null
}
function Write-DwbTunnelJson([string]$Name, $Value) {
  $root = Get-DwbTunnelDirectory
  $null = New-Item -ItemType Directory -Path $root -Force
  [IO.File]::WriteAllText((Join-Path $root $Name), ($Value | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding($false)))
}
function Find-DwbTunnelClient {
  $state=Get-DwbManagedTunnelState
  if ($state.Ready) { return $state.Entry }
  return ''
}
function Get-DwbTunnelProcess {
  $state = Read-DwbTunnelJson 'process.json'
  if (-not $state) { return $null }
  try {
    $process = Get-Process -Id $state.pid -ErrorAction Stop
    if ($process.Path -ne $state.executable -or $process.StartTime.ToUniversalTime().Ticks.ToString() -ne $state.started) { return $null }
    return $process
  } catch { return $null }
}
function Get-DwbTunnelStatus {
  $process = Get-DwbTunnelProcess
  if (-not $process) { return [pscustomobject]@{ state='stopped'; ready=$false } }
  $state = Read-DwbTunnelJson 'process.json'
  try {
    $url = [IO.File]::ReadAllText($state.healthFile).Trim()
    $uri = [Uri]$url
    if ($uri.Scheme -ne 'http' -or $uri.Host -ne '127.0.0.1') { throw 'Unexpected health URL.' }
    $response = Invoke-WebRequest -UseBasicParsing -Uri ($url.TrimEnd('/') + '/readyz') -TimeoutSec 1
    if ($response.StatusCode -eq 200) { return [pscustomobject]@{ state='ready'; ready=$true; pid=$process.Id } }
  } catch {}
  return [pscustomobject]@{ state='starting'; ready=$false; pid=$process.Id }
}
function New-DwbTunnelRecoveryState {
  return [pscustomobject]@{ enabled=$false; secureKey=$null; nextAttemptUtc=[DateTime]::MinValue; failureCount=0; lastStartUtc=$null; unreadySinceUtc=$null; lastError=$null }
}
function Enable-DwbTunnelRecovery($State,[Security.SecureString]$ApiKey=$null) {
  if ($State.secureKey -and $State.secureKey -ne $ApiKey) { $State.secureKey.Dispose() }
  $State.enabled=$true
  $State.secureKey=$ApiKey
  $State.nextAttemptUtc=[DateTime]::MinValue
  $State.failureCount=0
  $State.lastStartUtc=$null
  $State.unreadySinceUtc=$null
  $State.lastError=$null
}
function Disable-DwbTunnelRecovery($State) {
  $State.enabled=$false
  if ($State.secureKey) { $State.secureKey.Dispose(); $State.secureKey=$null }
  $State.nextAttemptUtc=[DateTime]::MinValue
  $State.unreadySinceUtc=$null
  $State.lastStartUtc=$null
  $State.lastError=$null
}
function Invoke-DwbTunnelRecovery($State,[DateTime]$Now=[DateTime]::UtcNow) {
  if (-not $State.enabled) { return 'disabled' }
  if ($Now -lt $State.nextAttemptUtc) { return 'backoff' }

  $process=Get-DwbTunnelProcess
  if ($process) {
    $status=Get-DwbTunnelStatus
    if ($status.ready) {
      if ($State.lastStartUtc -and ($Now-$State.lastStartUtc).TotalSeconds -ge 120) { $State.failureCount=0; $State.lastError=$null }
      $State.unreadySinceUtc=$null
      return 'healthy'
    }
    if (-not $State.unreadySinceUtc) { $State.unreadySinceUtc=$Now; return 'waiting' }
    if (($Now-$State.unreadySinceUtc).TotalSeconds -lt 120) { return 'waiting' }
    Stop-DwbTunnel
    $State.failureCount=[int]$State.failureCount+1
    $State.lastStartUtc=$null
    $State.unreadySinceUtc=$null
    $delay=[Math]::Min(60,5*[Math]::Pow(2,[Math]::Min(6,[Math]::Max(0,[int]$State.failureCount-1))))
    $State.nextAttemptUtc=$Now.AddSeconds($delay)
    return 'backoff'
  } elseif ($State.lastStartUtc) {
    $startedRecently=($Now-$State.lastStartUtc).TotalSeconds -lt 120
    $State.lastStartUtc=$null
    if($startedRecently){
      $State.failureCount=[int]$State.failureCount+1
      $delay=[Math]::Min(60,5*[Math]::Pow(2,[Math]::Min(6,[Math]::Max(0,[int]$State.failureCount-1))))
      $State.nextAttemptUtc=$Now.AddSeconds($delay)
      $State.unreadySinceUtc=$null
      return 'backoff'
    }
  }

  try {
    $settings=Read-DwbTunnelJson 'settings.json'
    if (-not $settings) { throw 'Tunnel settings are missing.' }
    $null=Start-DwbTunnel $settings.tunnelId $State.secureKey ([bool]$settings.rememberKey) (Find-DwbTunnelClient)
    $State.lastStartUtc=$Now
    $State.unreadySinceUtc=$Now
    $State.nextAttemptUtc=[DateTime]::MinValue
    $State.lastError=$null
    return 'restarted'
  } catch {
    $State.failureCount=[int]$State.failureCount+1
    $delay=[Math]::Min(60,5*[Math]::Pow(2,[Math]::Min(6,[Math]::Max(0,[int]$State.failureCount-1))))
    $State.nextAttemptUtc=$Now.AddSeconds($delay)
    $State.lastStartUtc=$null
    $State.unreadySinceUtc=$null
    $State.lastError=$_.Exception.Message
    return 'backoff'
  }
}
function Stop-DwbTunnel {
  $process = Get-DwbTunnelProcess
  if ($process) {
    # Only the process recorded by this data directory, checked against creation time and image.
    $killer = Start-Process -FilePath 'taskkill.exe' -ArgumentList @('/PID',[string]$process.Id,'/T','/F') -WindowStyle Hidden -Wait -PassThru
    if ($killer.ExitCode -ne 0 -and (Get-DwbTunnelProcess)) { throw 'Could not stop the N3zuui tunnel process.' }
  }
}
function Start-DwbTunnel([string]$TunnelId, [Security.SecureString]$ApiKey, [bool]$RememberKey, [string]$Executable) {
  $TunnelId = $TunnelId.Trim()
  if ($TunnelId -notmatch '^tunnel_[A-Za-z0-9_-]+$') { throw 'กรอก Tunnel ID ที่ขึ้นต้นด้วย tunnel_ โดยไม่มีช่องว่าง' }
  $paths=Get-DwbExternalPaths
  if ($Executable -ne $paths.Tunnel -or -not (Get-DwbManagedTunnelState).Ready) { throw 'กด ตั้งค่าเครื่อง เพื่อติดตั้ง tunnel-client ในโฟลเดอร์ N3zuui นี้ก่อน' }
  if (-not (Get-DwbManagedWorkerState).Ready -or (Get-Content -LiteralPath (Get-DwbConfigPath) -Raw | ConvertFrom-Json).workerEntry -ne $paths.Worker) { throw 'กด ตั้งค่าเครื่อง เพื่อเตรียม Desktop Commander ของ N3zuui นี้ก่อน' }
  $Executable = [IO.Path]::GetFullPath($Executable)
  $machine = Get-DwbMachineState
  $appRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
  if (-not $machine.NodeReady -or -not (Test-Path -LiteralPath (Get-DwbConfigPath)) -or -not (Test-Path -LiteralPath (Join-Path $appRoot 'node_modules\@modelcontextprotocol\sdk\package.json'))) { throw 'เปิด ตั้งค่าเครื่อง แล้วบันทึกและเตรียมใช้งานให้สำเร็จก่อน' }
  $runtime=Invoke-DwbNode $machine.Node @((Join-Path $PSScriptRoot 'runtime-control.mjs'),'status') $appRoot | ConvertFrom-Json
  if($runtime.state -ne 'stopped' -and (-not $runtime.matches)) { throw 'Broker รุ่นเดิมยังทำงานอยู่: จบงาน กด Stop MCP แล้วเปิด ตั้งค่าเครื่อง ในรุ่นนี้ก่อน ข้อมูลเดิมยังอยู่' }
  $root = Get-DwbTunnelDirectory
  $null = New-Item -ItemType Directory -Path $root -Force
  $lock = [IO.File]::Open((Join-Path $root 'start.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
  $plainKey = $null
  try {
    if (Get-DwbTunnelProcess) { throw 'MCP กำลังทำงานอยู่ กด Stop ก่อนเปลี่ยนการเชื่อมต่อ' }
    $keyFile = Join-Path $root 'key.dpapi'
    if (-not $ApiKey -or $ApiKey.Length -eq 0) {
      if (Test-Path -LiteralPath $keyFile) {
        try { $ApiKey = ConvertTo-SecureString ([IO.File]::ReadAllText($keyFile)) }
        catch { throw 'อ่าน API key ที่จำไว้ไม่ได้ กรุณากรอกใหม่สำหรับบัญชี Windows นี้' }
      } else { throw 'กรอก API key สำหรับ tunnel ของคุณก่อนกด Start MCP' }
    }
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($ApiKey)
    try { $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer).Trim() }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    if (-not $plainKey -or $plainKey -match '[\r\n]') { throw 'API key ว่างหรือมีการขึ้นบรรทัดใหม่ กรุณากรอกอีกครั้ง' }
    if ($RememberKey) {
      $encrypted = ConvertFrom-SecureString (ConvertTo-SecureString $plainKey -AsPlainText -Force)
      [IO.File]::WriteAllText($keyFile, $encrypted, (New-Object Text.UTF8Encoding($false)))
    } elseif (Test-Path -LiteralPath $keyFile) { Remove-Item -LiteralPath $keyFile }
    $commandPaths = @($machine.Node, (Join-Path $appRoot 'scripts\tunnel-mcp.mjs'))
    foreach ($path in $commandPaths) { if ($path -match '["\r\n]') { throw 'Install path cannot contain quotes or newlines.' } }
    $mcpCommand = ($commandPaths | ForEach-Object { '"' + $_.Replace('\','/') + '"' }) -join ' '
    $runId = [Guid]::NewGuid().ToString('N')
    $healthFile = Join-Path $root ($runId + '.health')
    $logFile = Join-Path $root ($runId + '.log')
    # JSON is also valid YAML. No shell interpolation and no secret in the profile or argv.
    $profile = @{
      config_version=1
      control_plane=@{ base_url='https://api.openai.com'; tunnel_id=$TunnelId; api_key='env:DWB_TUNNEL_RUNTIME_KEY' }
      health=@{ listen_addr='127.0.0.1:0'; url_file=$healthFile }
      admin_ui=@{ open_browser=$false }
      log=@{ level='info'; format='json'; file=$logFile }
      mcp=@{ connection_max_ttl='168h0m0s'; commands=@(@{ channel='main'; command=$mcpCommand }) }
    }
    Write-DwbTunnelJson 'profile.json' $profile
    Write-DwbTunnelJson 'settings.json' @{ tunnelId=$TunnelId; executable=$Executable; rememberKey=$RememberKey }
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $Executable
    $info.Arguments = 'run --config ' + (ConvertTo-DwbArgument (Join-Path $root 'profile.json')) + ' --mcp.connection-max-ttl 168h0m0s'
    $info.WorkingDirectory = $appRoot
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    # Isolate N3zuui from the user's existing tunnel profile and transport overrides.
    foreach ($name in @($info.EnvironmentVariables.Keys)) {
      if ($name -match '^(CONTROL_PLANE_|TUNNEL_CLIENT_|MCP_|HARPOON_|HEALTH_|ADMIN_UI_|CLOUDFLARED_|LOG_|DWB_)' -or $name -in @('OPENAI_API_KEY','OPEN_WEB_UI','ALLOW_REMOTE_UI')) { $info.EnvironmentVariables.Remove($name) }
    }
    $info.EnvironmentVariables['DWB_TUNNEL_RUNTIME_KEY'] = $plainKey
    $info.EnvironmentVariables['MCP_CONNECTION_MAX_TTL'] = '168h0m0s'
    $info.EnvironmentVariables['DWB_DATA_DIR'] = Get-DwbDataDirectory
    $info.EnvironmentVariables['DWB_CONFIG_FILE'] = Get-DwbConfigPath
    $process = [Diagnostics.Process]::Start($info)
    $info.EnvironmentVariables.Remove('DWB_TUNNEL_RUNTIME_KEY')
    try {
      Write-DwbTunnelJson 'process.json' @{ pid=$process.Id; started=$process.StartTime.ToUniversalTime().Ticks.ToString(); executable=$Executable; tunnelId=$TunnelId; healthFile=$healthFile; logFile=$logFile }
    } catch {
      if (-not $process.HasExited) { $process.Kill() }
      throw 'tunnel-client เริ่มไม่สำเร็จ ตรวจรุ่นของโปรแกรมและ API key แล้วลองใหม่'
    }
    return $process.Id
  } finally { $plainKey=$null; $lock.Dispose() }
}
