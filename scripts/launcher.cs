using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

internal static class Launcher {
    [STAThread]
    private static void Main(string[] args) {
        try {
            string root = AppDomain.CurrentDomain.BaseDirectory;
            string script = Path.Combine(root, "scripts", "app.ps1");
            if (!File.Exists(script)) throw new IOException("Extract the complete N3zuui folder before opening the app.");
            var start = new ProcessStartInfo {
                FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe"),
                Arguments = "-NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File \"" + script + "\"",
                WorkingDirectory = root,
                UseShellExecute = false,
                CreateNoWindow = true
            };
            // Windows PowerShell must use its own module paths when launched from PS7.
            start.EnvironmentVariables.Remove("PSModulePath");
            for (int i = 0; i < args.Length; i++) {
                if (args[i] == "--startup") start.Arguments += " -Startup";
                else if (args[i] == "--data-dir" && i + 1 < args.Length) {
                    string data = Path.GetFullPath(args[++i]);
                    start.EnvironmentVariables["DWB_DATA_DIR"] = data;
                    start.EnvironmentVariables["DWB_CONFIG_FILE"] = Path.Combine(data, "config.json");
                } else throw new ArgumentException("Unknown launcher argument.");
            }
            Process.Start(start);
        } catch (Exception error) {
            MessageBox.Show(error.Message, "N3zuui Studio", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
