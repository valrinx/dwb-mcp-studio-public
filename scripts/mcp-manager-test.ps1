$ErrorActionPreference='Stop'
$report=Join-Path $env:TEMP ('dwb-mcp-manager-test-'+[guid]::NewGuid().ToString('N')+'.txt')
try{
  & powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'mcp-manager.ps1') -UiTest -UiTestReport $report
  if($LASTEXITCODE -ne 0){throw "MCP Manager UI test process failed ($LASTEXITCODE)"}
  if(-not (Test-Path -LiteralPath $report)){throw 'MCP Manager UI did not produce its control verification report.'}
  $result=Get-Content -LiteralPath $report -Raw -Encoding UTF8
  $expected='PASS: MCP Manager UI behavior: servers=3; enabled=2; running=1; issues=1; empty=visible; scroll=available; GitHub feedback=visible; progress=shown; window=fitted; layout=nonoverlapping'
  if($result.Trim() -ne $expected){throw "Expected '$expected'; got '$result'"}
  Write-Output 'MCP_MANAGER_UI_PASS: summary, empty state, GitHub install feedback and progress, scrolling, display fitting, and section layout verified.'
}finally{
  if(Test-Path -LiteralPath $report){Remove-Item -LiteralPath $report -Force}
}
