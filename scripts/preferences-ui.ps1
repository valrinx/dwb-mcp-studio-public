function global:Show-DwbPreferences([string]$RegistryPath='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run',[string]$TestReport) {
  [xml]$xaml=@'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" Title="N3zuui · การเปิดและปิดแอป" Width="550" SizeToContent="Height" ResizeMode="NoResize" WindowStartupLocation="CenterOwner" Background="#070B14" Foreground="#EDF7FF" FontFamily="Leelawadee UI, Segoe UI">
 <Window.Resources>
  <Style TargetType="Button"><Setter Property="Background" Value="#1B3041"/><Setter Property="Foreground" Value="#E9F0F7"/><Setter Property="BorderBrush" Value="#345064"/><Setter Property="Cursor" Value="Hand"/><Setter Property="Template"><Setter.Value><ControlTemplate TargetType="Button"><Border Background="{TemplateBinding Background}" BorderBrush="{TemplateBinding BorderBrush}" BorderThickness="1" CornerRadius="7" Padding="{TemplateBinding Padding}"><ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/></Border></ControlTemplate></Setter.Value></Setter></Style>
  <Style TargetType="TextBlock"><Setter Property="TextWrapping" Value="Wrap"/></Style>
  <Style TargetType="CheckBox"><Setter Property="Foreground" Value="#E9F0F7"/><Setter Property="Margin" Value="0,10,0,0"/></Style>
  <Style TargetType="RadioButton"><Setter Property="Foreground" Value="#E9F0F7"/><Setter Property="Margin" Value="0,10,0,0"/></Style>
 </Window.Resources>
 <StackPanel Margin="28">
  <TextBlock Text="ให้ N3zuui ทำงานในแบบที่คุณเลือก" FontSize="22" FontWeight="SemiBold"/>
  <TextBlock Text="ตอนเข้าสู่ Windows" Foreground="#08B8D2" Margin="0,24,0,0" FontSize="14"/>
  <CheckBox x:Name="Startup" Content="เปิด N3zuui พร้อม Windows โดยเริ่มใน tray"/>
  <CheckBox x:Name="Connect" Content="Start MCP อัตโนมัติด้วย Tunnel ID และ key ที่บันทึกไว้"/>
  <TextBlock Text="หากยังตั้งค่าไม่ครบ หรือเชื่อมต่อไม่ได้ จะแสดงหน้าต่างให้แก้ไข" Foreground="#89AABE" Margin="20,8,0,0"/>
  <TextBlock Text="เมื่อกด × ปิดหน้าต่าง" Foreground="#08B8D2" Margin="0,24,0,0" FontSize="14"/>
  <RadioButton x:Name="CloseTray" GroupName="CloseAction" Content="ซ่อนไป tray — MCP และงานยังทำต่อ"/>
  <RadioButton x:Name="CloseExit" GroupName="CloseAction" Content="ปิดแอปและหยุด MCP"/>
  <TextBlock Text="ถ้ายังมีคำขอ / process / search ทำงาน จะไม่ปิดทิ้ง และแจ้งให้จบงานก่อน" Foreground="#89AABE" Margin="20,8,0,0"/>
  <CheckBox x:Name="Minimize" Content="เมื่อกด − ย่อหน้าต่าง ให้ซ่อนไป tray" Margin="0,24,0,0"/>
  <TextBlock Text="หากไม่เลือก ปุ่มย่อจะเก็บหน้าต่างไว้ที่ taskbar ตามปกติ" Foreground="#89AABE" Margin="20,8,0,0"/>
  <TextBlock x:Name="Error" Foreground="#EDB77D" Margin="0,16,0,0"/>
  <StackPanel Orientation="Horizontal" HorizontalAlignment="Right" Margin="0,16,0,0">
   <Button x:Name="Cancel" Content="ยกเลิก" Padding="20,9" Margin="0,0,10,0"/>
   <Button x:Name="Save" Content="บันทึก" Padding="24,9" Background="#08B8D2" Foreground="#06252E"/>
  </StackPanel>
 </StackPanel>
</Window>
'@
  $reader=New-Object Xml.XmlNodeReader $xaml
  try{$dialog=[Windows.Markup.XamlReader]::Load($reader)}finally{$reader.Dispose()}
  if($global:DwbShell.Window){$dialog.Owner=$global:DwbShell.Window}
  $preferences=Get-DwbPreferences
  $dialog.FindName('Error').Text=[string]$preferences.readError
  $dialog.FindName('Startup').IsChecked=$preferences.startWithWindows
  $dialog.FindName('Connect').IsChecked=$preferences.connectOnStartup
  $dialog.FindName('Connect').IsEnabled=$preferences.startWithWindows
  $dialog.FindName('CloseTray').IsChecked=$preferences.closeAction -eq 'tray'
  $dialog.FindName('CloseExit').IsChecked=$preferences.closeAction -eq 'exit'
  $dialog.FindName('Minimize').IsChecked=$preferences.minimizeToTray
  $dialog.FindName('Startup').Add_Click({$dialog.FindName('Connect').IsEnabled=[bool]$dialog.FindName('Startup').IsChecked})
  $dialog.FindName('Cancel').Add_Click({$dialog.Close()})
  $dialog.FindName('Save').Add_Click({
    try{
      $next=@{startWithWindows=[bool]$dialog.FindName('Startup').IsChecked;connectOnStartup=[bool]$dialog.FindName('Connect').IsChecked;closeAction=$(if($dialog.FindName('CloseExit').IsChecked){'exit'}else{'tray'});minimizeToTray=[bool]$dialog.FindName('Minimize').IsChecked}
      if($next.startWithWindows -and $next.connectOnStartup -and (-not(Test-Path -LiteralPath (Join-Path (Get-DwbTunnelDirectory) 'key.dpapi')))){throw 'เปิดหน้า Tunnel / API key และเลือกจำ key ก่อนเปิด Start MCP อัตโนมัติ'}
      Save-DwbPreferences $next $RegistryPath
      $global:DwbShell.Preferences=$next
      $dialog.Close()
    }catch{$dialog.FindName('Error').Text=$_.Exception.Message}
  })
  if($TestReport){
    $dialog.WindowStartupLocation='Manual';$dialog.Left=-20000;$dialog.Top=-20000
    $dialog.Add_ContentRendered({
      $dialog.FindName('Startup').IsChecked=$true
      $dialog.FindName('Connect').IsChecked=$false
      $dialog.FindName('CloseExit').IsChecked=$true
      $dialog.FindName('Minimize').IsChecked=$false
      $dialog.UpdateLayout()
      $render=New-Object Windows.Media.Imaging.RenderTargetBitmap([int]$dialog.ActualWidth,[int]$dialog.ActualHeight,96,96,[Windows.Media.PixelFormats]::Pbgra32)
      $render.Render($dialog)
      $encoder=New-Object Windows.Media.Imaging.PngBitmapEncoder
      $encoder.Frames.Add([Windows.Media.Imaging.BitmapFrame]::Create($render))
      $stream=[IO.File]::Create($TestReport+'.png')
      try{$encoder.Save($stream)}finally{$stream.Dispose()}
      $dialog.FindName('Save').RaiseEvent((New-Object Windows.RoutedEventArgs([Windows.Controls.Button]::ClickEvent)))
      if($dialog.IsVisible){[IO.File]::WriteAllText($TestReport,$dialog.FindName('Error').Text);$dialog.Close()}else{[IO.File]::WriteAllText($TestReport,'PASS')}
    })
  }
  $null=$dialog.ShowDialog()
}
