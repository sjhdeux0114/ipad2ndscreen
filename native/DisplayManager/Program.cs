using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;
using System.Xml.Linq;

internal static class Program
{
    private const string HardwareId = @"Root\MttVDD";
    private const uint InstallFlagForce = 0x00000001;
    private const uint InstallFlagNonInteractive = 0x00000004;
    private static readonly Guid DisplayClassGuid = new("4D36E968-E325-11CE-BFC1-08002BE10318");
    private static readonly int[] DpiScales = [100, 125, 150, 175, 200, 225, 250, 300, 350, 400, 450, 500];
    private static readonly Dictionary<string, string> ExpectedHashes = new(StringComparer.OrdinalIgnoreCase)
    {
        ["mttvdd.cat"] = "08A0093FC9B2E32B287A6F8A77CA4DE0A31830D29FC33D2B13A918DC859468F6",
        ["MttVDD.dll"] = "C9CA837F57A98FBD43BC416A7F535A95843626E7759EAF85CF0CD7CE334DBB05",
        ["MttVDD.inf"] = "550D211FE481E74DFE3F9D724ED78BE48B3A9113405965D683D9373E8D672F5D"
    };

    public static int Main()
    {
        var dataDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "iPadDisplayServer");
        var commandPath = Path.Combine(dataDirectory, "driver-command.json");
        var resultPath = Path.Combine(dataDirectory, "driver-result.json");
        Command? command = null;
        try
        {
            command = JsonSerializer.Deserialize<Command>(File.ReadAllText(commandPath), JsonOptions());
            if (command is null || string.IsNullOrWhiteSpace(command.Token)) throw new InvalidOperationException("잘못된 가상 디스플레이 명령입니다.");
            ValidateCommand(command);
            var message = command.Operation switch
            {
                "install" => Install(command),
                "configure" => Configure(command),
                "remove" => Remove(),
                _ => throw new InvalidOperationException("지원하지 않는 명령입니다.")
            };
            WriteResult(resultPath, new Result(command.Token, true, message, null));
            return 0;
        }
        catch (Exception error)
        {
            Directory.CreateDirectory(dataDirectory);
            WriteResult(resultPath, new Result(command?.Token ?? string.Empty, false, "가상 디스플레이 작업에 실패했습니다.", error.Message));
            return 1;
        }
    }

    private static string Install(Command command)
    {
        var driverDirectory = FindDriverDirectory();
        VerifyDriverFiles(driverDirectory);
        WriteSettings(command.Width, command.Height);
        if (!DeviceExists()) CreateRootDevice();
        var infPath = Path.Combine(driverDirectory, "MttVDD.inf");
        if (!UpdateDriverForPlugAndPlayDevices(IntPtr.Zero, HardwareId, infPath, InstallFlagForce | InstallFlagNonInteractive, out var reboot))
            throw new Win32Exception(Marshal.GetLastWin32Error(), "서명된 가상 디스플레이 드라이버를 설치하지 못했습니다.");
        RestartDevice();
        ApplyExtendedTopology();
        Thread.Sleep(1800);
        var scaleMessage = TrySetVirtualDisplayScale(command.Scale);
        return $"가상 확장 화면 {command.Width} × {command.Height}, {command.Scale}%를 만들었습니다.{(reboot ? " Windows 재시작이 필요할 수 있습니다." : string.Empty)}{scaleMessage}";
    }

    private static string Configure(Command command)
    {
        if (!DeviceExists()) return Install(command);
        WriteSettings(command.Width, command.Height);
        RestartDevice();
        ApplyExtendedTopology();
        Thread.Sleep(1800);
        var scaleMessage = TrySetVirtualDisplayScale(command.Scale);
        return $"가상 확장 화면을 {command.Width} × {command.Height}, {command.Scale}%로 적용했습니다.{scaleMessage}";
    }

    private static string Remove()
    {
        var infoSet = OpenVirtualDevice(out var device);
        if (infoSet == InvalidHandleValue) return "설치된 가상 디스플레이가 없습니다.";
        try
        {
            if (!DiUninstallDevice(IntPtr.Zero, infoSet, ref device, 0, out var reboot))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "가상 디스플레이 장치를 제거하지 못했습니다.");
            return reboot ? "가상 디스플레이를 제거했습니다. Windows를 다시 시작해 주세요." : "가상 디스플레이를 제거했습니다.";
        }
        finally { SetupDiDestroyDeviceInfoList(infoSet); }
    }

    private static void ValidateCommand(Command command)
    {
        if (command.Operation is not ("install" or "configure" or "remove")) throw new InvalidOperationException("지원하지 않는 명령입니다.");
        if (command.Operation == "remove") return;
        if (command.Width is < 640 or > 7680 || command.Height is < 480 or > 4320) throw new InvalidOperationException("해상도 범위가 올바르지 않습니다.");
        if (!DpiScales.Contains(command.Scale) || command.Scale == 225 || command.Scale > 300) throw new InvalidOperationException("지원하지 않는 Windows 배율입니다.");
    }

    private static JsonSerializerOptions JsonOptions() => new() { PropertyNameCaseInsensitive = true };

    private static void WriteResult(string path, Result result)
    {
        var temp = path + ".tmp";
        File.WriteAllText(temp, JsonSerializer.Serialize(result, JsonOptions()));
        File.Move(temp, path, true);
    }

    private static string FindDriverDirectory()
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        while (current is not null)
        {
            var candidate = Path.Combine(current.FullName, "vendor", "virtual-display-driver", "driver");
            if (File.Exists(Path.Combine(candidate, "MttVDD.inf"))) return candidate;
            current = current.Parent;
        }
        throw new FileNotFoundException("앱에 포함된 가상 디스플레이 드라이버를 찾을 수 없습니다.");
    }

    private static void VerifyDriverFiles(string directory)
    {
        foreach (var pair in ExpectedHashes)
        {
            var path = Path.Combine(directory, pair.Key);
            if (!File.Exists(path)) throw new FileNotFoundException($"드라이버 파일이 없습니다: {pair.Key}");
            var hash = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path)));
            if (!hash.Equals(pair.Value, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException($"드라이버 무결성 검사에 실패했습니다: {pair.Key}");
        }
    }

    private static void WriteSettings(int width, int height)
    {
        var targetDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System).Substring(0, 3), "VirtualDisplayDriver");
        Directory.CreateDirectory(targetDirectory);
        var document = new XDocument(
            new XElement("vdd_settings",
                new XElement("monitors", new XElement("count", 1)),
                new XElement("gpu", new XElement("friendlyname", "default")),
                new XElement("global", new XElement("g_refresh_rate", 60)),
                new XElement("resolutions", new XElement("resolution",
                    new XElement("width", width), new XElement("height", height), new XElement("refresh_rate", 60))),
                new XElement("options",
                    new XElement("CustomEdid", false), new XElement("PreventSpoof", false), new XElement("EdidCeaOverride", false),
                    new XElement("HardwareCursor", true), new XElement("SDR10bit", false), new XElement("HDRPlus", false),
                    new XElement("logging", false), new XElement("debuglogging", false))));
        document.Save(Path.Combine(targetDirectory, "vdd_settings.xml"));
    }

    private static bool DeviceExists()
    {
        var infoSet = OpenVirtualDevice(out _);
        if (infoSet == InvalidHandleValue) return false;
        SetupDiDestroyDeviceInfoList(infoSet);
        return true;
    }

    private static void CreateRootDevice()
    {
        var classGuid = DisplayClassGuid;
        var infoSet = SetupDiCreateDeviceInfoList(ref classGuid, IntPtr.Zero);
        if (infoSet == InvalidHandleValue) throw new Win32Exception(Marshal.GetLastWin32Error());
        try
        {
            var device = NewDeviceInfoData();
            if (!SetupDiCreateDeviceInfo(infoSet, "iPadDisplayVirtualMonitor", ref classGuid, "iPad Display Virtual Monitor", IntPtr.Zero, DicdGenerateId, ref device))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            var ids = System.Text.Encoding.Unicode.GetBytes(HardwareId + "\0\0");
            if (!SetupDiSetDeviceRegistryProperty(infoSet, ref device, SpdrpHardwareId, ids, (uint)ids.Length))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            if (!SetupDiCallClassInstaller(DifRegisterDevice, infoSet, ref device))
                throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        finally { SetupDiDestroyDeviceInfoList(infoSet); }
    }

    private static void RestartDevice()
    {
        var infoSet = OpenVirtualDevice(out var device);
        if (infoSet == InvalidHandleValue) throw new InvalidOperationException("설치된 가상 디스플레이 장치를 찾지 못했습니다.");
        try
        {
            ChangeDeviceState(infoSet, ref device, DicsDisable);
            Thread.Sleep(350);
            ChangeDeviceState(infoSet, ref device, DicsEnable);
        }
        finally { SetupDiDestroyDeviceInfoList(infoSet); }
    }

    private static IntPtr OpenVirtualDevice(out SP_DEVINFO_DATA matchingDevice)
    {
        var classGuid = DisplayClassGuid;
        var infoSet = SetupDiGetClassDevsByClass(ref classGuid, null, IntPtr.Zero, DigcfPresent);
        matchingDevice = NewDeviceInfoData();
        if (infoSet == InvalidHandleValue) return InvalidHandleValue;
        for (uint index = 0; ; index++)
        {
            var device = NewDeviceInfoData();
            if (!SetupDiEnumDeviceInfo(infoSet, index, ref device)) break;
            var instanceId = new System.Text.StringBuilder(512);
            if (SetupDiGetDeviceInstanceId(infoSet, ref device, instanceId, instanceId.Capacity, out _)
                && instanceId.ToString().StartsWith(@"ROOT\MTTVDD\", StringComparison.OrdinalIgnoreCase))
            {
                matchingDevice = device;
                return infoSet;
            }
        }
        SetupDiDestroyDeviceInfoList(infoSet);
        return InvalidHandleValue;
    }

    private static void ChangeDeviceState(IntPtr infoSet, ref SP_DEVINFO_DATA device, uint state)
    {
        var parameters = new SP_PROPCHANGE_PARAMS
        {
            ClassInstallHeader = new SP_CLASSINSTALL_HEADER { cbSize = (uint)Marshal.SizeOf<SP_CLASSINSTALL_HEADER>(), InstallFunction = DifPropertyChange },
            StateChange = state, Scope = DicsFlagGlobal, HwProfile = 0
        };
        if (!SetupDiSetClassInstallParams(infoSet, ref device, ref parameters, Marshal.SizeOf<SP_PROPCHANGE_PARAMS>()))
            throw new Win32Exception(Marshal.GetLastWin32Error());
        if (!SetupDiCallClassInstaller(DifPropertyChange, infoSet, ref device))
            throw new Win32Exception(Marshal.GetLastWin32Error());
    }

    private static void ApplyExtendedTopology()
    {
        var result = SetDisplayConfig(0, IntPtr.Zero, 0, IntPtr.Zero, SdcTopologyExtend | SdcApply | SdcAllowChanges);
        if (result != 0) throw new Win32Exception(result, "Windows 확장 디스플레이 모드를 적용하지 못했습니다.");
    }

    private static string TrySetVirtualDisplayScale(int requestedScale)
    {
        try
        {
            var target = FindVirtualDisplayTarget();
            if (target is null) return " 배율은 Windows 디스플레이 설정에서 확인해 주세요.";
            var get = new DISPLAYCONFIG_GET_DPI_SCALE
            {
                Header = NewHeader(DisplayconfigDeviceInfoGetDpiScale, target.Value.AdapterId, target.Value.Id)
            };
            var result = DisplayConfigGetDeviceInfo(ref get);
            if (result != 0) return " 배율은 Windows 디스플레이 설정에서 확인해 주세요.";
            var requestedIndex = Array.IndexOf(DpiScales, requestedScale);
            var recommendedIndex = -get.MinScaleRel;
            var relative = requestedIndex - recommendedIndex;
            if (relative < get.MinScaleRel || relative > get.MaxScaleRel) return " 이 디스플레이에서 지원하지 않는 배율이라 Windows 기본값을 사용합니다.";
            var set = new DISPLAYCONFIG_SET_DPI_SCALE
            {
                Header = NewHeader(DisplayconfigDeviceInfoSetDpiScale, target.Value.AdapterId, target.Value.Id),
                ScaleRel = relative
            };
            result = DisplayConfigSetDeviceInfo(ref set);
            return result == 0 ? string.Empty : " 배율은 Windows 디스플레이 설정에서 확인해 주세요.";
        }
        catch { return " 배율은 Windows 디스플레이 설정에서 확인해 주세요."; }
    }

    private static (LUID AdapterId, uint Id)? FindVirtualDisplayTarget()
    {
        uint pathCount = 0, modeCount = 0;
        var error = GetDisplayConfigBufferSizes(QdcOnlyActivePaths, out pathCount, out modeCount);
        if (error != 0) return null;
        var paths = new DISPLAYCONFIG_PATH_INFO[pathCount];
        var modes = new DISPLAYCONFIG_MODE_INFO[modeCount];
        error = QueryDisplayConfig(QdcOnlyActivePaths, ref pathCount, paths, ref modeCount, modes, IntPtr.Zero);
        if (error != 0) return null;
        foreach (var path in paths.Take((int)pathCount))
        {
            var name = new DISPLAYCONFIG_TARGET_DEVICE_NAME
            {
                Header = NewHeader(DisplayconfigDeviceInfoGetTargetName, path.TargetInfo.AdapterId, path.TargetInfo.Id),
                MonitorFriendlyDeviceName = string.Empty,
                MonitorDevicePath = string.Empty
            };
            if (DisplayConfigGetDeviceInfo(ref name) != 0) continue;
            var isVirtualDriver = name.MonitorDevicePath.Contains("MTT", StringComparison.OrdinalIgnoreCase)
                || name.MonitorFriendlyDeviceName.Contains("Virtual Display", StringComparison.OrdinalIgnoreCase);
            if (isVirtualDriver) return (path.SourceInfo.AdapterId, path.SourceInfo.Id);
        }
        return null;
    }

    private static DISPLAYCONFIG_DEVICE_INFO_HEADER NewHeader(uint type, LUID adapter, uint id) => new()
    {
        Type = type, Size = type == DisplayconfigDeviceInfoGetTargetName ? (uint)Marshal.SizeOf<DISPLAYCONFIG_TARGET_DEVICE_NAME>() :
            type == DisplayconfigDeviceInfoGetDpiScale ? (uint)Marshal.SizeOf<DISPLAYCONFIG_GET_DPI_SCALE>() : (uint)Marshal.SizeOf<DISPLAYCONFIG_SET_DPI_SCALE>(),
        AdapterId = adapter, Id = id
    };

    private static SP_DEVINFO_DATA NewDeviceInfoData() => new() { cbSize = (uint)Marshal.SizeOf<SP_DEVINFO_DATA>() };

    private const uint DigcfPresent = 0x2, DigcfAllClasses = 0x4, DicdGenerateId = 0x1, SpdrpHardwareId = 0x1;
    private const uint DifPropertyChange = 0x12, DifRegisterDevice = 0x19, DicsEnable = 1, DicsDisable = 2, DicsFlagGlobal = 1;
    private const uint SdcTopologyExtend = 0x4, SdcApply = 0x80, SdcAllowChanges = 0x400;
    private const uint QdcOnlyActivePaths = 0x2, DisplayconfigDeviceInfoGetTargetName = 2;
    private const uint DisplayconfigDeviceInfoGetDpiScale = 0xFFFFFFFD, DisplayconfigDeviceInfoSetDpiScale = 0xFFFFFFFC;
    private static readonly IntPtr InvalidHandleValue = new(-1);

    [StructLayout(LayoutKind.Sequential)] private struct SP_DEVINFO_DATA { public uint cbSize; public Guid ClassGuid; public uint DevInst; public IntPtr Reserved; }
    [StructLayout(LayoutKind.Sequential)] private struct SP_CLASSINSTALL_HEADER { public uint cbSize; public uint InstallFunction; }
    [StructLayout(LayoutKind.Sequential)] private struct SP_PROPCHANGE_PARAMS { public SP_CLASSINSTALL_HEADER ClassInstallHeader; public uint StateChange; public uint Scope; public uint HwProfile; }
    [StructLayout(LayoutKind.Sequential)] private struct LUID { public uint LowPart; public int HighPart; }
    [StructLayout(LayoutKind.Sequential)] private struct DISPLAYCONFIG_RATIONAL { public uint Numerator; public uint Denominator; }
    [StructLayout(LayoutKind.Sequential)] private struct DISPLAYCONFIG_PATH_SOURCE_INFO { public LUID AdapterId; public uint Id; public uint ModeInfoIdx; public uint StatusFlags; }
    [StructLayout(LayoutKind.Sequential)] private struct DISPLAYCONFIG_PATH_TARGET_INFO { public LUID AdapterId; public uint Id; public uint ModeInfoIdx; public uint OutputTechnology; public uint Rotation; public uint Scaling; public DISPLAYCONFIG_RATIONAL RefreshRate; public uint ScanLineOrdering; [MarshalAs(UnmanagedType.Bool)] public bool TargetAvailable; public uint StatusFlags; }
    [StructLayout(LayoutKind.Sequential)] private struct DISPLAYCONFIG_PATH_INFO { public DISPLAYCONFIG_PATH_SOURCE_INFO SourceInfo; public DISPLAYCONFIG_PATH_TARGET_INFO TargetInfo; public uint Flags; }
    [StructLayout(LayoutKind.Sequential, Size = 64)] private struct DISPLAYCONFIG_MODE_INFO { }
    [StructLayout(LayoutKind.Sequential)] private struct DISPLAYCONFIG_DEVICE_INFO_HEADER { public uint Type; public uint Size; public LUID AdapterId; public uint Id; }
    [StructLayout(LayoutKind.Sequential)] private struct DISPLAYCONFIG_GET_DPI_SCALE { public DISPLAYCONFIG_DEVICE_INFO_HEADER Header; public int MinScaleRel; public int CurScaleRel; public int MaxScaleRel; }
    [StructLayout(LayoutKind.Sequential)] private struct DISPLAYCONFIG_SET_DPI_SCALE { public DISPLAYCONFIG_DEVICE_INFO_HEADER Header; public int ScaleRel; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct DISPLAYCONFIG_TARGET_DEVICE_NAME { public DISPLAYCONFIG_DEVICE_INFO_HEADER Header; public uint Flags; public uint OutputTechnology; public ushort EdidManufactureId; public ushort EdidProductCodeId; public uint ConnectorInstance; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string MonitorFriendlyDeviceName; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string MonitorDevicePath; }

    [DllImport("newdev.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool UpdateDriverForPlugAndPlayDevices(IntPtr hwndParent, string hardwareId, string fullInfPath, uint installFlags, out bool rebootRequired);
    [DllImport("newdev.dll", SetLastError = true)] private static extern bool DiUninstallDevice(IntPtr hwndParent, IntPtr deviceInfoSet, ref SP_DEVINFO_DATA deviceInfoData, uint flags, out bool needReboot);
    [DllImport("setupapi.dll", SetLastError = true)] private static extern IntPtr SetupDiCreateDeviceInfoList(ref Guid classGuid, IntPtr hwndParent);
    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool SetupDiCreateDeviceInfo(IntPtr deviceInfoSet, string deviceName, ref Guid classGuid, string deviceDescription, IntPtr hwndParent, uint creationFlags, ref SP_DEVINFO_DATA deviceInfoData);
    [DllImport("setupapi.dll", SetLastError = true)] private static extern bool SetupDiSetDeviceRegistryProperty(IntPtr deviceInfoSet, ref SP_DEVINFO_DATA deviceInfoData, uint property, byte[] propertyBuffer, uint propertyBufferSize);
    [DllImport("setupapi.dll", SetLastError = true)] private static extern bool SetupDiCallClassInstaller(uint installFunction, IntPtr deviceInfoSet, ref SP_DEVINFO_DATA deviceInfoData);
    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr SetupDiGetClassDevs(IntPtr classGuid, string enumerator, IntPtr hwndParent, uint flags);
    [DllImport("setupapi.dll", EntryPoint = "SetupDiGetClassDevsW", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr SetupDiGetClassDevsByClass(ref Guid classGuid, string? enumerator, IntPtr hwndParent, uint flags);
    [DllImport("setupapi.dll", SetLastError = true)] private static extern bool SetupDiEnumDeviceInfo(IntPtr deviceInfoSet, uint memberIndex, ref SP_DEVINFO_DATA deviceInfoData);
    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool SetupDiGetDeviceInstanceId(IntPtr deviceInfoSet, ref SP_DEVINFO_DATA deviceInfoData, System.Text.StringBuilder deviceInstanceId, int deviceInstanceIdSize, out int requiredSize);
    [DllImport("setupapi.dll", SetLastError = true)] private static extern bool SetupDiSetClassInstallParams(IntPtr deviceInfoSet, ref SP_DEVINFO_DATA deviceInfoData, ref SP_PROPCHANGE_PARAMS classInstallParams, int classInstallParamsSize);
    [DllImport("setupapi.dll")] private static extern bool SetupDiDestroyDeviceInfoList(IntPtr deviceInfoSet);
    [DllImport("user32.dll")] private static extern int SetDisplayConfig(uint numPathArrayElements, IntPtr pathArray, uint numModeInfoArrayElements, IntPtr modeInfoArray, uint flags);
    [DllImport("user32.dll")] private static extern int GetDisplayConfigBufferSizes(uint flags, out uint numPathArrayElements, out uint numModeInfoArrayElements);
    [DllImport("user32.dll")] private static extern int QueryDisplayConfig(uint flags, ref uint numPathArrayElements, [Out] DISPLAYCONFIG_PATH_INFO[] pathArray, ref uint numModeInfoArrayElements, [Out] DISPLAYCONFIG_MODE_INFO[] modeInfoArray, IntPtr currentTopologyId);
    [DllImport("user32.dll")] private static extern int DisplayConfigGetDeviceInfo(ref DISPLAYCONFIG_TARGET_DEVICE_NAME requestPacket);
    [DllImport("user32.dll")] private static extern int DisplayConfigGetDeviceInfo(ref DISPLAYCONFIG_GET_DPI_SCALE requestPacket);
    [DllImport("user32.dll")] private static extern int DisplayConfigSetDeviceInfo(ref DISPLAYCONFIG_SET_DPI_SCALE setPacket);

    private sealed record Command(string Token, string Operation, int Width, int Height, int Scale);
    private sealed record Result(string Token, bool Success, string Message, string? Error);
}
