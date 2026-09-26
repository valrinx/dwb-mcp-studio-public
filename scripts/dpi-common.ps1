if (-not ('DwbDpiAwareness' -as [type])) {
  Add-Type @'
using System;
using System.Runtime.InteropServices;

public static class DwbDpiAwareness {
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetProcessDpiAwarenessContext(IntPtr dpiContext);

    [DllImport("shcore.dll")]
    private static extern int SetProcessDpiAwareness(int value);

    public static bool EnablePerMonitorV2() {
        try {
            if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return true;
        } catch (EntryPointNotFoundException) {
        } catch (DllNotFoundException) {
        }

        try {
            return SetProcessDpiAwareness(2) == 0;
        } catch (EntryPointNotFoundException) {
            return false;
        } catch (DllNotFoundException) {
            return false;
        }
    }
}
'@
}

# Set this before WPF loads any window so Windows does not bitmap-scale the UI.
try { [DwbDpiAwareness]::EnablePerMonitorV2() | Out-Null } catch {}
