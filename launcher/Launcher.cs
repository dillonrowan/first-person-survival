// Windows launcher for the release build: serves the built game from the "game" folder next to
// this exe on a fixed localhost port and opens it in an Edge (or Chrome) app window. The port is
// fixed because saves live in localStorage, which is keyed by origin. When the window closes, the
// launcher exits and the server stops.
//
// Built by scripts/build-launcher.mjs with the C# 5 compiler in .NET Framework 4, which ships
// with Windows, so players need nothing installed.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

static class Launcher
{
    const string Title = "First-Person Survival";
    const int Port = 47613;
    const string Marker = "first-person-survival-launcher";
    static readonly string Url = "http://localhost:" + Port + "/";

    static readonly Dictionary<string, string> MimeTypes = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        { ".html", "text/html; charset=utf-8" },
        { ".js", "text/javascript; charset=utf-8" },
        { ".mjs", "text/javascript; charset=utf-8" },
        { ".css", "text/css; charset=utf-8" },
        { ".json", "application/json; charset=utf-8" },
        { ".png", "image/png" },
        { ".jpg", "image/jpeg" },
        { ".svg", "image/svg+xml" },
        { ".ico", "image/x-icon" },
        { ".glb", "model/gltf-binary" },
        { ".wasm", "application/wasm" },
        { ".ogg", "audio/ogg" },
        { ".mp3", "audio/mpeg" },
        { ".wav", "audio/wav" },
    };

    static string root;

    [STAThread]
    static void Main()
    {
        try
        {
            Run();
        }
        catch (Exception e)
        {
            Fail(e.Message);
        }
    }

    static void Run()
    {
        string exeDir = AppDomain.CurrentDomain.BaseDirectory;
        root = Path.GetFullPath(Path.Combine(exeDir, "game")) + Path.DirectorySeparatorChar;
        if (!File.Exists(Path.Combine(root, "index.html")))
        {
            Fail("The \"game\" folder is missing. Keep it next to " + Path.GetFileName(Application.ExecutablePath) + ".");
            return;
        }

        var listener = new HttpListener();
        listener.Prefixes.Add(Url);
        try
        {
            listener.Start();
        }
        catch (HttpListenerException)
        {
            // Already running: open another window on the running server.
            if (IsOurServer())
            {
                OpenWindow();
                return;
            }
            Fail("Port " + Port + " is in use by another program. Close it and try again.");
            return;
        }

        var server = new Thread(() => Serve(listener)) { IsBackground = true };
        server.Start();

        Process window = OpenWindow();
        if (window != null)
        {
            window.WaitForExit();
        }
        else
        {
            MessageBox.Show("The game is open in your web browser.\n\nClick OK to quit the game.", Title);
        }
        listener.Stop();
    }

    static void Serve(HttpListener listener)
    {
        while (listener.IsListening)
        {
            HttpListenerContext context;
            try
            {
                context = listener.GetContext();
            }
            catch (Exception)
            {
                return; // Listener stopped.
            }
            ThreadPool.QueueUserWorkItem(_ => Respond(context));
        }
    }

    static void Respond(HttpListenerContext context)
    {
        HttpListenerResponse response = context.Response;
        try
        {
            string path = Uri.UnescapeDataString(context.Request.Url.AbsolutePath);
            if (path == "/__launcher")
            {
                WriteText(response, 200, Marker);
                return;
            }
            if (path.EndsWith("/")) path += "index.html";

            string file = Path.GetFullPath(Path.Combine(root, path.TrimStart('/')));
            if (!file.StartsWith(root, StringComparison.OrdinalIgnoreCase) || !File.Exists(file))
            {
                WriteText(response, 404, "Not found");
                return;
            }

            string type;
            response.ContentType = MimeTypes.TryGetValue(Path.GetExtension(file), out type) ? type : "application/octet-stream";
            // Read from disk every time: nothing goes stale after an update, and the browser
            // profile does not keep a second copy of the game.
            response.Headers["Cache-Control"] = "no-store";
            using (var stream = File.OpenRead(file))
            {
                response.ContentLength64 = stream.Length;
                if (context.Request.HttpMethod != "HEAD") stream.CopyTo(response.OutputStream);
            }
        }
        catch (Exception)
        {
            // The page went away mid-request; nothing to do.
        }
        finally
        {
            try { response.Close(); } catch (Exception) { }
        }
    }

    static void WriteText(HttpListenerResponse response, int status, string text)
    {
        byte[] body = System.Text.Encoding.UTF8.GetBytes(text);
        response.StatusCode = status;
        response.ContentType = "text/plain; charset=utf-8";
        response.ContentLength64 = body.Length;
        response.OutputStream.Write(body, 0, body.Length);
    }

    static bool IsOurServer()
    {
        try
        {
            var request = (HttpWebRequest)WebRequest.Create(Url + "__launcher");
            request.Timeout = 2000;
            using (var response = request.GetResponse())
            using (var reader = new StreamReader(response.GetResponseStream()))
            {
                return reader.ReadToEnd() == Marker;
            }
        }
        catch (Exception)
        {
            return false;
        }
    }

    /// Opens the game in an Edge or Chrome app window with its own profile, so the browser
    /// process lives exactly as long as the window. Falls back to the default browser, which
    /// returns null because its lifetime cannot be tracked.
    static Process OpenWindow()
    {
        string browser = FindBrowser("msedge.exe", @"Microsoft\Edge\Application\msedge.exe")
            ?? FindBrowser("chrome.exe", @"Google\Chrome\Application\chrome.exe");
        if (browser == null)
        {
            Process.Start(Url);
            return null;
        }

        string profile = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "FirstPersonSurvival", "browser-profile");
        string args = "--app=" + Url
            + " --user-data-dir=\"" + profile + "\""
            + " --no-first-run --no-default-browser-check --start-maximized";
        return Process.Start(new ProcessStartInfo(browser, args) { UseShellExecute = false });
    }

    static string FindBrowser(string exeName, string relativePath)
    {
        string appPathsKey = @"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\" + exeName;
        foreach (RegistryKey hive in new[] { Registry.CurrentUser, Registry.LocalMachine })
        {
            using (RegistryKey key = hive.OpenSubKey(appPathsKey))
            {
                string path = key == null ? null : key.GetValue(null) as string;
                if (path != null && File.Exists(path.Trim('"'))) return path.Trim('"');
            }
        }
        foreach (var folder in new[] {
            Environment.SpecialFolder.ProgramFilesX86,
            Environment.SpecialFolder.ProgramFiles,
            Environment.SpecialFolder.LocalApplicationData })
        {
            string path = Path.Combine(Environment.GetFolderPath(folder), relativePath);
            if (File.Exists(path)) return path;
        }
        return null;
    }

    static void Fail(string message)
    {
        MessageBox.Show(message, Title, MessageBoxButtons.OK, MessageBoxIcon.Error);
    }
}
