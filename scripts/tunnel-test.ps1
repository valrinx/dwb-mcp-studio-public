$ErrorActionPreference='Stop'
Import-Module Microsoft.PowerShell.Security -ErrorAction Stop
. (Join-Path $PSScriptRoot 'tunnel-common.ps1')
function Assert([bool]$Value,[string]$Message) { if (-not $Value) { throw $Message } }
$root=Join-Path ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))) ('logs\tunnel-test-' + [Guid]::NewGuid().ToString('N').Substring(0,8))
$install=Join-Path $root 'app with spaces & symbols'
$null=New-Item -ItemType Directory -Path $install -Force
foreach($folder in @('scripts','assets','dist')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot ('..\'+$folder)) -Destination $install -Recurse }
Copy-Item -LiteralPath (Join-Path $PSScriptRoot '..\package.json') -Destination $install
. (Join-Path $install 'scripts\tunnel-common.ps1')
$paths=Get-DwbExternalPaths
$null=New-Item -ItemType Directory -Path (Split-Path -Parent $paths.Worker) -Force
$workerPackage=Split-Path -Parent (Split-Path -Parent $paths.Worker)
[IO.File]::WriteAllText((Join-Path $workerPackage 'package.json'),'{"name":"@wonderwhy-er/desktop-commander","version":"0.2.50"}')
[IO.File]::WriteAllText($paths.Worker,'// owned fixture')
[IO.File]::WriteAllText((Join-Path (Split-Path -Parent $paths.Worker) 'config.js'),'export const USER_HOME = os.homedir();')
$null=New-Item -ItemType Directory -Path (Join-Path $install 'node_modules\@modelcontextprotocol\sdk') -Force
[IO.File]::WriteAllText((Join-Path $install 'node_modules\@modelcontextprotocol\sdk\package.json'),'{}')
$oldData=$env:DWB_DATA_DIR
$oldConfig=$env:DWB_CONFIG_FILE
$oldProfile=$env:TUNNEL_CLIENT_PROFILE
$oldCommand=$env:MCP_COMMAND
$env:DWB_DATA_DIR=Join-Path $root 'user data & spaces'
$env:DWB_CONFIG_FILE=Join-Path $env:DWB_DATA_DIR 'config.json'
$env:TUNNEL_CLIENT_PROFILE='must-not-inherit'
$env:MCP_COMMAND='must-not-inherit'
$null=New-Item -ItemType Directory -Path $env:DWB_DATA_DIR -Force
$null=New-Item -ItemType Directory -Path $paths.TunnelRoot -Force
[IO.File]::WriteAllText($env:DWB_CONFIG_FILE,(@{workerEntry=$paths.Worker} | ConvertTo-Json))
$exe=$paths.Tunnel
# Own executable fixture; it never contacts a network service outside loopback.
$source=@'
using System;
using System.IO;
using System.Text;
using System.Net;
using System.Net.Sockets;
using System.Web.Script.Serialization;
using System.Collections.Generic;
class TunnelFixture {
  public static void Main(string[] args) {
    if (args.Length==1 && args[0]=="--version") { Console.WriteLine("0.0.11"); return; }
    var json = new JavaScriptSerializer();
    var profile = json.Deserialize<Dictionary<string,object>>(File.ReadAllText(args[2]));
    var health = (Dictionary<string,object>)profile["health"];
    var listener = new TcpListener(IPAddress.Loopback,0); listener.Start();
    var url = "http://127.0.0.1:" + ((IPEndPoint)listener.LocalEndpoint).Port;
    var root = Path.GetDirectoryName(args[2]);
    File.WriteAllText(Path.Combine(root,"probe.json"),json.Serialize(new {
      command=args[0], config=args[1],
      keyCorrect=Environment.GetEnvironmentVariable("DWB_TUNNEL_RUNTIME_KEY")=="dwb-test-key",
      clean=Environment.GetEnvironmentVariable("MCP_COMMAND")==null && Environment.GetEnvironmentVariable("TUNNEL_CLIENT_PROFILE")==null,
      ttlFlag=args.Length>=5 && args[3]=="--mcp.connection-max-ttl" && args[4]=="168h0m0s",
      ttlEnv=Environment.GetEnvironmentVariable("MCP_CONNECTION_MAX_TTL"),
      data=Environment.GetEnvironmentVariable("DWB_DATA_DIR")
    }));
    File.WriteAllText((string)health["url_file"],url);
    for (;;) { using (var client=listener.AcceptTcpClient()) {
      var stream=client.GetStream(); var buffer=new byte[8192]; stream.Read(buffer,0,buffer.Length);
      var bytes=Encoding.ASCII.GetBytes("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}");
      stream.Write(bytes,0,bytes.Length);
    } }
  }
}
'@
try {
  Add-Type -TypeDefinition $source -ReferencedAssemblies 'System.Web.Extensions.dll' -OutputAssembly $exe -OutputType ConsoleApplication
  Assert ((Find-DwbTunnelClient) -eq $exe) 'Must find only the app-owned tunnel.'
  $failed=$false
  try { Assert-DwbExternalPath (Join-Path $root 'another app') } catch { $failed=$true }
  Assert $failed 'External path escape accepted.'
  Import-Module Microsoft.PowerShell.Security -ErrorAction Stop
  $key=ConvertTo-SecureString 'dwb-test-key' -AsPlainText -Force
  $failed=$false
  try { Start-DwbTunnel 'bad id' $key $true $exe | Out-Null } catch { $failed=$true }
  Assert $failed 'Invalid ID accepted.'
  $failed=$false
  try { Start-DwbTunnel 'tunnel_test' $null $true $exe | Out-Null } catch { $failed=$true }
  Assert $failed 'Missing key accepted.'
  $first=Start-DwbTunnel 'tunnel_test' $key $true $exe
  $deadline=[DateTime]::UtcNow.AddSeconds(10)
  do { Start-Sleep -Milliseconds 100; $state=Get-DwbTunnelStatus } while (-not $state.ready -and [DateTime]::UtcNow -lt $deadline)
  Assert $state.ready 'Fixture did not reach ready.'
  $probe=Read-DwbTunnelJson 'probe.json'
  Assert ($probe.command -eq 'run' -and $probe.config -eq '--config') 'Wrong native arguments.'
  Assert ($probe.keyCorrect -and $probe.clean -and $probe.data -eq $env:DWB_DATA_DIR) 'Secret forwarding or environment isolation failed.'
  Assert ($probe.ttlFlag -and $probe.ttlEnv -eq '168h0m0s') 'Tunnel client did not receive the durable MCP connection TTL.'
  $profile=[IO.File]::ReadAllText((Join-Path (Get-DwbTunnelDirectory) 'profile.json'))
  Assert (-not $profile.Contains('dwb-test-key')) 'Plaintext secret in profile.'
  Assert (-not ([IO.File]::ReadAllText((Join-Path (Get-DwbTunnelDirectory) 'key.dpapi'))).Contains('dwb-test-key')) 'Plaintext secret persisted.'
  $profile=Read-DwbTunnelJson 'profile.json'
  Assert ($profile.mcp.connection_max_ttl -eq '168h0m0s') 'MCP connection TTL must match the durable RVN tunnel window.'
  $command=$profile.mcp.commands[0].command
  Assert ($command.Contains('tunnel-mcp.mjs') -and -not $command.Contains('\')) 'MCP command is not portable through tunnel shlex.'
  $failed=$false
  try { Start-DwbTunnel 'tunnel_other' $key $true $exe | Out-Null } catch { $failed=$true }
  Assert ($failed -and (Get-DwbTunnelProcess).Id -eq $first) 'Duplicate start was not blocked.'
  $saved=Read-DwbTunnelJson 'process.json'
  $wrong=$saved.PSObject.Copy(); $wrong.started='0'
  Write-DwbTunnelJson 'process.json' $wrong
  Stop-DwbTunnel
  Assert ([bool](Get-Process -Id $first -ErrorAction SilentlyContinue)) 'Stopped a PID with wrong creation time.'
  Write-DwbTunnelJson 'process.json' $saved
  Stop-DwbTunnel
  Assert ((Get-DwbTunnelStatus).state -eq 'stopped') 'Stop failed.'
  $second=Start-DwbTunnel 'tunnel_test' $null $false $exe
  Assert ($second -ne $first) 'Restart did not create a new process.'
  $recovery=[pscustomobject]@{enabled=$true;secureKey=$key;nextAttemptUtc=[DateTime]::MinValue;failureCount=0;lastStartUtc=[DateTime]::UtcNow.AddMinutes(-5);unreadySinceUtc=$null;lastError=$null}
  Stop-Process -Id $second -Force
  $deadline=[DateTime]::UtcNow.AddSeconds(5)
  while((Get-Process -Id $second -ErrorAction SilentlyContinue) -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 50}
  $recovered=Invoke-DwbTunnelRecovery $recovery ([DateTime]::UtcNow)
  $deadline=[DateTime]::UtcNow.AddSeconds(10)
  do { Start-Sleep -Milliseconds 100; $state=Get-DwbTunnelStatus } while (-not $state.ready -and [DateTime]::UtcNow -lt $deadline)
  $recoveredPid=(Get-DwbTunnelProcess).Id
  Assert ($recovered -eq 'restarted' -and $recoveredPid -ne $second -and $state.ready) 'Unexpected tunnel process exit was not recovered.'
  Stop-Process -Id $recoveredPid -Force
  $deadline=[DateTime]::UtcNow.AddSeconds(5)
  while((Get-Process -Id $recoveredPid -ErrorAction SilentlyContinue) -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 50}
  $crashAt=[DateTime]::UtcNow
  Assert ((Invoke-DwbTunnelRecovery $recovery $crashAt) -eq 'backoff' -and -not (Get-DwbTunnelProcess) -and $recovery.nextAttemptUtc -gt $crashAt) 'Rapid process exit did not enter backoff.'
  Assert ((Invoke-DwbTunnelRecovery $recovery $recovery.nextAttemptUtc.AddSeconds(-1)) -eq 'backoff' -and -not (Get-DwbTunnelProcess)) 'Recovery ignored its retry backoff.'
  $recovered=Invoke-DwbTunnelRecovery $recovery $recovery.nextAttemptUtc.AddSeconds(1)
  $deadline=[DateTime]::UtcNow.AddSeconds(10)
  do { Start-Sleep -Milliseconds 100; $state=Get-DwbTunnelStatus } while (-not $state.ready -and [DateTime]::UtcNow -lt $deadline)
  $recoveredPid=(Get-DwbTunnelProcess).Id
  Assert ($recovered -eq 'restarted' -and $recoveredPid -ne $second -and $state.ready) 'Tunnel was not restarted after the backoff expired.'
  $health=Read-DwbTunnelJson 'process.json'
  [IO.File]::WriteAllText($health.healthFile,'http://127.0.0.1:1')
  $now=$recovery.lastStartUtc
  Assert ((Invoke-DwbTunnelRecovery $recovery $now) -eq 'waiting') 'Unready tunnel was restarted before the recovery grace period.'
  Assert ((Invoke-DwbTunnelRecovery $recovery $now.AddSeconds(121)) -eq 'backoff' -and -not (Get-DwbTunnelProcess)) 'Unready tunnel did not stop and back off after the grace period.'
  $recovered=Invoke-DwbTunnelRecovery $recovery $recovery.nextAttemptUtc.AddSeconds(1)
  $deadline=[DateTime]::UtcNow.AddSeconds(10)
  do { Start-Sleep -Milliseconds 100; $state=Get-DwbTunnelStatus } while (-not $state.ready -and [DateTime]::UtcNow -lt $deadline)
  Assert ($recovered -eq 'restarted' -and (Get-DwbTunnelProcess).Id -ne $recoveredPid -and $state.ready) 'Tunnel stuck unready beyond the recovery grace period.'
  $recovery.enabled=$false
  Stop-DwbTunnel
  Assert ((Invoke-DwbTunnelRecovery $recovery ([DateTime]::UtcNow)) -eq 'disabled' -and -not (Get-DwbTunnelProcess)) 'Manual Stop was undone by tunnel recovery.'
  Assert (-not (Test-Path -LiteralPath (Join-Path (Get-DwbTunnelDirectory) 'key.dpapi'))) 'Opt out failed to remove saved key.'
  Stop-DwbTunnel
  # Simulate a Windows-login launch using an owned loopback tunnel and saved DPAPI key.
  [IO.File]::WriteAllText((Join-Path (Get-DwbTunnelDirectory) 'key.dpapi'),(ConvertFrom-SecureString $key))
  Write-DwbTunnelJson 'settings.json' @{tunnelId='tunnel_startup_test';rememberKey=$true}
  [IO.File]::WriteAllText((Join-Path $env:DWB_DATA_DIR 'preferences.json'),'{"startWithWindows":true,"connectOnStartup":true,"closeAction":"tray","minimizeToTray":true}')
  $startupReport=Join-Path $root 'startup-ui.txt'
  & powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File (Join-Path $install 'scripts\app.ps1') -UiTestReport $startupReport -Startup
  Assert ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $startupReport)) 'Startup shell failed.'
  Assert (Get-DwbTunnelStatus).ready 'Startup did not connect using the saved key.'
  Stop-DwbTunnel
  Write-Output 'STARTUP_MCP_PASS: simulated login, saved DPAPI key, hidden dashboard, ready loopback tunnel.'
  # A normal app launch with auto-connect enabled must also restore a stopped tunnel.
  $interactiveReport=Join-Path $root 'interactive-ui.txt'
  & powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File (Join-Path $install 'scripts\app.ps1') -UiTestReport $interactiveReport
  Assert ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $interactiveReport)) 'Interactive shell failed.'
  Assert (Get-DwbTunnelStatus).ready 'Opening Studio normally did not reconnect with auto-connect enabled.'
  Stop-DwbTunnel
  Write-Output 'INTERACTIVE_AUTOCONNECT_PASS: normal app launch, saved DPAPI key, ready loopback tunnel.'
  # Execute the real wrapper beside a fixture start.mjs to verify credential removal.
  $wrapperRoot=Join-Path $root 'wrapper'
  $null=New-Item -ItemType Directory -Path $wrapperRoot
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'tunnel-mcp.mjs') -Destination $wrapperRoot
  [IO.File]::WriteAllText((Join-Path $wrapperRoot 'start.mjs'), 'if (process.env.DWB_TUNNEL_RUNTIME_KEY) process.exit(9); console.log("KEY_REMOVED");')
  $env:DWB_TUNNEL_RUNTIME_KEY='dwb-test-key'
  $out=Invoke-DwbNode (Get-DwbNode) @((Join-Path $wrapperRoot 'tunnel-mcp.mjs')) $wrapperRoot
  Assert ($out.Trim() -eq 'KEY_REMOVED') 'Key leaked to broker launcher.'
  $request=Join-Path $root 'ui-test-request.json'
  [IO.File]::WriteAllText($request, (@{executable=$exe;tunnelId='tunnel_ui_test';testKey='dwb-test-key'} | ConvertTo-Json))
  & powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File (Join-Path $install 'scripts\tunnel-setup.ps1') -TestRequestFile $request
  Assert ($LASTEXITCODE -eq 0) 'GUI Start/Stop failed.'
  Write-Output 'TUNNEL_SETUP_PASS: ID/key validation, encrypted key, hidden process, native quoting, isolated environment, readiness, duplicate prevention, PID ownership, stop/restart, forget key, worker secret removal.'
} finally {
  Stop-DwbTunnel
  $env:DWB_DATA_DIR=$oldData; $env:DWB_CONFIG_FILE=$oldConfig
  $env:TUNNEL_CLIENT_PROFILE=$oldProfile; $env:MCP_COMMAND=$oldCommand
  Remove-Item Env:\DWB_TUNNEL_RUNTIME_KEY -ErrorAction SilentlyContinue
}
