using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Management;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32;

// Windows' existing .NET Framework only; no PowerShell, network, account or
// owner-lock API. Packaged at build time, never compiled by the player's game.
internal static class WindowsOwnerObservation
{
    private static void Stage(string phase) { Console.Error.WriteLine("VOXEL_OWNER_STAGE:" + phase); }
    private static string Digest(string value)
    {
        using (var digest = SHA256.Create())
            return BitConverter.ToString(digest.ComputeHash(Encoding.UTF8.GetBytes(value))).Replace("-", "").ToLowerInvariant();
    }
    private static string Machine()
    {
        using (var root = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64))
        using (var key = root.OpenSubKey(@"SOFTWARE\Microsoft\Cryptography", false))
        {
            var value = key == null ? null : key.GetValue("MachineGuid") as string;
            if (String.IsNullOrWhiteSpace(value)) throw new InvalidOperationException();
            return Digest(value.Trim().ToLowerInvariant());
        }
    }
    private static string Boot()
    {
        using (var query = new ManagementObjectSearcher("SELECT LastBootUpTime FROM Win32_OperatingSystem"))
        using (var values = query.Get())
        {
            string instant = null;
            foreach (ManagementBaseObject value in values)
            using (value)
            {
                if (instant != null) throw new InvalidOperationException();
                var dmtf = value["LastBootUpTime"] as string;
                if (String.IsNullOrWhiteSpace(dmtf)) throw new InvalidOperationException();
                instant = ManagementDateTimeConverter.ToDateTime(dmtf).ToUniversalTime().ToString("o", CultureInfo.InvariantCulture);
            }
            if (instant == null) throw new InvalidOperationException();
            return instant;
        }
    }
    private static string ProcessFacts(int pid)
    {
        Process process;
        try { process = Process.GetProcessById(pid); }
        catch (ArgumentException) { return "null"; }
        using (process)
        {
            if (process.HasExited) return "null";
            var started = process.StartTime.ToUniversalTime();
            // Win32_Process CreationDate is whole DMTF microseconds. Retain
            // that EXACT v1 identity, not native FILETIME's extra 100ns digit.
            started = new DateTime(started.Ticks - started.Ticks % 10, DateTimeKind.Utc);
            var executable = process.MainModule.FileName;
            if (String.IsNullOrWhiteSpace(executable)) throw new InvalidOperationException();
            var executableHash = Digest(Path.GetFullPath(executable).ToLowerInvariant());
            if (process.HasExited) throw new InvalidOperationException();
            return "{\"pid\":" + process.Id.ToString(CultureInfo.InvariantCulture) + ",\"startedUtc\":\"" + started.ToString("o", CultureInfo.InvariantCulture)
                + "\",\"executablePathHash\":\"" + executableHash + "\"}";
        }
    }
    private static int Query(int pid)
    {
        Stage("machine");
        var machine = Machine();
        Stage("boot-before");
        var before = Boot();
        Stage("process");
        var facts = ProcessFacts(pid);
        Stage("boot-after");
        var after = Boot();
        if (!String.Equals(before, after, StringComparison.Ordinal)) throw new InvalidOperationException();
        Stage("serialize");
        // Only our integer, SHA256 hex and UTC strings cross the helper pipe.
        Console.Out.WriteLine("{\"format\":\"WindowsOwnerObservation\",\"version\":1,\"machineHash\":\"" + machine + "\",\"bootUtc\":\"" + before
            + "\",\"observedUtc\":\"" + DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) + "\",\"queriedPid\":" + pid.ToString(CultureInfo.InvariantCulture) + ",\"process\":" + facts + "}");
        return 0;
    }
    private static int Main(string[] args)
    {
        uint value;
        if (args.Length != 1 || !UInt32.TryParse(args[0], NumberStyles.None, CultureInfo.InvariantCulture, out value) || value <= 1 || value > Int32.MaxValue) return 2;
        try { return Query((int)value); }
        catch { return 3; } // Never print raw exception, registry or path data.
    }
}
