$ErrorActionPreference='Stop'
Add-Type -AssemblyName PresentationFramework,PresentationCore,WindowsBase
Add-Type -AssemblyName System.Drawing

function Load-BrandWindow([string]$Path) {
  $reader=[Xml.XmlReader]::Create([IO.StringReader]::new([IO.File]::ReadAllText($Path)))
  try { return [Windows.Markup.XamlReader]::Load($reader) } finally { $reader.Dispose() }
}

function Assert-Brand([bool]$Condition,[string]$Message) {
  if(-not $Condition){throw $Message}
}

function Assert-GraphiteSurface($Brush,[string]$Screen) {
  $colors=@()
  if($Brush -is [Windows.Media.SolidColorBrush]){$colors=@($Brush.Color)}
  elseif($Brush -is [Windows.Media.GradientBrush]){$colors=@($Brush.GradientStops | ForEach-Object {$_.Color})}
  Assert-Brand ($colors.Count -gt 0) "$Screen must expose a graphite surface brush."
  $isGraphite=($colors | Where-Object { $_.R -gt 32 -or $_.G -gt 34 -or $_.B -gt 36 -or (($_.B - $_.R) -gt 12) }).Count -eq 0
  Assert-Brand $isGraphite "$Screen is still blue-toned; use deep graphite surfaces for the Lumen Edge theme."
}

function Get-VisibleBounds([string]$Path) {
  $bitmap=[Drawing.Bitmap]::new($Path)
  try {
    $minX=$bitmap.Width
    $minY=$bitmap.Height
    $maxX=-1
    $maxY=-1
    for($y=0;$y -lt $bitmap.Height;$y++) {
      for($x=0;$x -lt $bitmap.Width;$x++) {
        $pixel=$bitmap.GetPixel($x,$y)
        if($pixel.A -gt 20 -and ($pixel.R -gt 20 -or $pixel.G -gt 20 -or $pixel.B -gt 20)) {
          if($x -lt $minX){$minX=$x}
          if($x -gt $maxX){$maxX=$x}
          if($y -lt $minY){$minY=$y}
          if($y -gt $maxY){$maxY=$y}
        }
      }
    }
    return [pscustomobject]@{
      Width=$bitmap.Width
      Height=$bitmap.Height
      MinX=$minX
      MaxX=$maxX
      MinY=$minY
      MaxY=$maxY
      BoxWidth=($maxX-$minX+1)
      BoxHeight=($maxY-$minY+1)
      CenterX=(($minX+$maxX)/2)
      CenterY=(($minY+$maxY)/2)
    }
  } finally {
    $bitmap.Dispose()
  }
}

$root=Split-Path -Parent $PSScriptRoot
Assert-Brand (Test-Path -LiteralPath (Join-Path $root 'assets\n3zuui-logo.png')) 'N3zuui wordmark asset is missing.'
Assert-Brand (Test-Path -LiteralPath (Join-Path $root 'assets\n3zuui-mark.png')) 'N3zuui app mark asset is missing.'
$markBounds=Get-VisibleBounds (Join-Path $root 'assets\n3zuui-mark.png')
Assert-Brand ([math]::Abs($markBounds.CenterX-($markBounds.Width/2)) -le 24 -and [math]::Abs($markBounds.CenterY-($markBounds.Height/2)) -le 24) 'N3zuui mark artwork must be optically centered inside its transparent canvas.'
Assert-Brand ($markBounds.BoxWidth -ge 740 -and $markBounds.BoxHeight -ge 800) 'N3zuui rebrand must use the selected dimensional prism icon instead of a small text or ribbon mark.'

$cases=@(
  @{File='dashboard.xaml';Title=('N3zuui '+[char]0x00B7+' Core Dashboard');Brand='N3zuui Studio'},
  @{File='mcp-manager.xaml';Title=('N3zuui '+[char]0x00B7+' MCP Servers');Brand='N3zuui Studio'},
  @{File='setup.xaml';Title=('N3zuui Studio '+[char]0x00B7+' Setup');Brand='N3zuui Studio'},
  @{File='tunnel-setup.xaml';Title=('N3zuui '+[char]0x00B7+' OpenAI Tunnel');Brand='N3zuui Studio'}
)

foreach($case in $cases){
  $window=Load-BrandWindow (Join-Path $PSScriptRoot $case.File)
  Assert-Brand ($window.Title -eq $case.Title) "$($case.File) has the wrong branded window title: $($window.Title)"
  $brand=$window.FindName('BrandTitle')
  Assert-Brand ($brand -and $brand.Text -eq $case.Brand) "$($case.File) is missing the N3zuui brand title."
  $surface=if($case.File -eq 'setup.xaml'){$window.FindName('WindowSurface')}else{$window}
  Assert-GraphiteSurface $surface.Background $case.File
  Assert-Brand ($window.UseLayoutRounding -and $window.SnapsToDevicePixels) "$($case.File) must enable pixel-aligned layout for crisp text at non-100% DPI scaling."
  Assert-Brand ([Windows.Media.TextOptions]::GetTextFormattingMode($window) -eq [Windows.Media.TextFormattingMode]::Display) "$($case.File) must use display text formatting for crisp small labels."
  Assert-Brand ([Windows.Media.TextOptions]::GetTextRenderingMode($window) -eq [Windows.Media.TextRenderingMode]::ClearType) "$($case.File) must use ClearType text rendering for crisp UI text."
  if($case.File -eq 'setup.xaml'){
    $brandImage=$window.FindName('BrandImage')
    Assert-Brand ($brandImage -and $brandImage.Stretch -eq [Windows.Media.Stretch]::Uniform) 'setup.xaml must keep the full N3zuui wordmark visible inside the square brand panel.'
  }
  if($case.File -eq 'dashboard.xaml'){
    $logoFrame=$window.FindName('LogoFrame')
    Assert-Brand ($logoFrame -and $logoFrame.Width -eq $logoFrame.Height -and $logoFrame.CornerRadius.TopLeft -ge 16) 'dashboard.xaml must place the N3 mark inside a square luminous frame.'
    $logo=$window.FindName('Logo')
    Assert-Brand ($logo -and $logo.Width -ge 112 -and $logo.Height -ge 112 -and $logoFrame.Padding.Left -le 8) 'dashboard.xaml must let the centered N3 mark use the square frame without excessive inset padding.'
    $stats=$window.FindName('StatsCards')
    Assert-Brand ($stats -and $stats.Columns -eq 4) 'dashboard.xaml must keep the four status cards in one equal-column row.'
    $rightScroll=$window.Content.Children[1]
    Assert-Brand ($rightScroll -is [Windows.Controls.ScrollViewer] -and $rightScroll.VerticalScrollBarVisibility -eq [Windows.Controls.ScrollBarVisibility]::Auto) 'dashboard.xaml must keep the main content reachable when the window is shorter than the full dashboard layout.'
    $rightGrid=$rightScroll.Content
    Assert-Brand ($rightGrid.RowDefinitions.Count -ge 9 -and $rightGrid.RowDefinitions[3].Height.GridUnitType -eq [Windows.GridUnitType]::Pixel -and $rightGrid.RowDefinitions[3].Height.Value -ge 150) 'dashboard.xaml must reserve the full minimum height of the Workers and Sessions panel.'
    $startMcp=$window.FindName('StartMcp')
    $stopMcp=$window.FindName('StopMcp')
    Assert-Brand ($startMcp -is [Windows.Controls.Button] -and $stopMcp -is [Windows.Controls.Button] -and $window.FindName('Refresh') -is [Windows.Controls.Button] -and $null -eq $window.FindName('McpToggle')) 'dashboard.xaml must use the original separate Refresh, Stop, and Start MCP buttons.'
    $dashboardCode=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'dashboard.ps1') -Raw
    Assert-Brand ($dashboardCode.Contains("Find 'StartMcp'") -and $dashboardCode.Contains("Find 'StopMcp'") -and $dashboardCode.Contains('Start-MuseAiMcp') -and $dashboardCode.Contains('Stop-MuseAiMcp') -and $dashboardCode.Contains('mcp-control.ps1') -and -not $dashboardCode.Contains('Start-DwbTunnel') -and -not $dashboardCode.Contains('Stop-DwbTunnel') -and -not $dashboardCode.Contains('McpToggle')) 'dashboard.ps1 must route the separate Start/Stop MCP actions through the shared MCP controller.'
    Assert-Brand ($dashboardCode.Contains('Set-DashboardRoundedClip')) 'dashboard.ps1 must clip dashboard tables to their rounded panel corners.'
    $statCards=@($stats.Children | Where-Object {$_ -is [Windows.Controls.Border]})
    Assert-Brand ($statCards.Count -eq 4) 'dashboard.xaml status cards must remain separate elevated surfaces.'
    foreach($card in $statCards){
      Assert-Brand ($card.Effect -is [Windows.Media.Effects.DropShadowEffect] -and $card.Effect.BlurRadius -ge 12 -and $card.Effect.ShadowDepth -ge 3 -and $card.Effect.Opacity -ge 0.25) 'dashboard.xaml status cards need a soft depth shadow to separate them from the graphite background.'
    }
    foreach($frameName in @('SessionsFrame','AgentsFrame','TasksFrame','EventsFrame')){
      $frame=$window.FindName($frameName)
      Assert-Brand ($frame -and $frame.BorderThickness.Left -eq 1 -and $frame.CornerRadius.TopLeft -ge 10) "dashboard.xaml is missing the symmetric $frameName panel."
      $edge=$window.FindName(($frameName -replace 'Frame$','Edge'))
      Assert-Brand ($edge -and $edge.IsHitTestVisible -eq $false -and $edge.CornerRadius.TopLeft -ge 10 -and $edge.BorderThickness.Left -eq 1) "dashboard.xaml $frameName needs a visible rounded edge above its DataGrid content."
      Assert-Brand ($frame.Padding.Left -ge 1 -and $frame.Padding.Top -ge 1) "dashboard.xaml $frameName needs an inset surface so its table cannot erase the rounded outer frame."
      Assert-Brand ($frame.Background -is [Windows.Media.SolidColorBrush] -and $frame.Background.Color.R -ge 18 -and $frame.Background.Color.B -ge 34) "dashboard.xaml $frameName needs a lifted graphite surface instead of a sunken near-black panel."
      Assert-Brand ($frame.Effect -is [Windows.Media.Effects.DropShadowEffect] -and $frame.Effect.BlurRadius -ge 18 -and $frame.Effect.ShadowDepth -ge 5 -and $frame.Effect.Opacity -ge 0.5) "dashboard.xaml $frameName needs a stronger soft elevation shadow."
    }
  }
}

Write-Output 'BRAND_UI_PASS: N3zuui assets and branded titles are wired into Dashboard, MCP Manager, Setup, and Tunnel Setup.'
