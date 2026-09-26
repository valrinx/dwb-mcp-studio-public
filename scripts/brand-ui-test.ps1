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
    foreach($frameName in @('SessionsFrame','AgentsFrame','TasksFrame','EventsFrame')){
      $frame=$window.FindName($frameName)
      Assert-Brand ($frame -and $frame.BorderThickness.Left -eq 1 -and $frame.CornerRadius.TopLeft -ge 10) "dashboard.xaml is missing the symmetric $frameName panel."
    }
  }
}

Write-Output 'BRAND_UI_PASS: N3zuui assets and branded titles are wired into Dashboard, MCP Manager, Setup, and Tunnel Setup.'
