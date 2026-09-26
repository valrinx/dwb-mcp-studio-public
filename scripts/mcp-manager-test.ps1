$ErrorActionPreference='Stop'
$report=Join-Path $env:TEMP ('dwb-mcp-manager-test-'+[guid]::NewGuid().ToString('N')+'.txt')
try{
  & powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'mcp-manager.ps1') -UiTest -UiTestReport $report
  if($LASTEXITCODE -ne 0){throw "MCP Manager UI test process failed ($LASTEXITCODE)"}
  if(-not (Test-Path -LiteralPath $report)){throw 'MCP Manager UI did not produce its control verification report.'}
  $result=Get-Content -LiteralPath $report -Raw -Encoding UTF8
  if($result -notmatch '^PASS: MCP Manager WPF loaded'){throw $result}
  Write-Output 'MCP_MANAGER_UI_PASS: WPF window loaded with server list and editor controls.'
}finally{
  if(Test-Path -LiteralPath $report){Remove-Item -LiteralPath $report -Force}
}
