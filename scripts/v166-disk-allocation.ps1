param(
  [string]$CurrentReport = 'output/v166-capacity-1790302204798/report.json',
  [string]$BaselineReport = 'output/v166-baseline/output/v166-capacity-1790299554362/report.json',
  [string]$Output = 'validation/v166-capacity.json'
)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class AllocationProbe {
  [StructLayout(LayoutKind.Sequential)]
  private struct FileStandardInfo {
    public long AllocationSize;
    public long EndOfFile;
    public uint NumberOfLinks;
    [MarshalAs(UnmanagedType.U1)] public bool DeletePending;
    [MarshalAs(UnmanagedType.U1)] public bool Directory;
  }
  [DllImport("kernel32.dll", SetLastError=true)]
  private static extern bool GetFileInformationByHandleEx(SafeFileHandle handle, int infoClass, out FileStandardInfo info, uint size);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool GetDiskFreeSpaceW(string root, out uint sectorsPerCluster, out uint bytesPerSector, out uint freeClusters, out uint totalClusters);
  public static ulong Bytes(string path) {
    using (var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite)) {
      FileStandardInfo info;
      if (!GetFileInformationByHandleEx(file.SafeFileHandle, 1, out info, (uint)Marshal.SizeOf(typeof(FileStandardInfo))))
        throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
      return (ulong)info.AllocationSize;
    }
  }
}
'@
function Measure-Allocation([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return 0 }
  $item = Get-Item -LiteralPath $Path
  if (-not $item.PSIsContainer) { return [AllocationProbe]::Bytes($item.FullName) }
  [uint64]$total = 0
  foreach ($file in Get-ChildItem -LiteralPath $item.FullName -File -Recurse) { $total += [AllocationProbe]::Bytes($file.FullName) }
  return $total
}
$reports = @()
foreach ($reportPath in @($CurrentReport, $BaselineReport)) {
  $resolved = (Resolve-Path -LiteralPath $reportPath).Path
  $root = Split-Path -Parent $resolved
  $report = Get-Content -LiteralPath $resolved -Raw | ConvertFrom-Json
  foreach ($row in $report.rows) {
    $variant = if ($row.arrays) { 'enumerated' } else { 'compact' }
    $retention = if ($row.keepDirectory) { 'both' } else { 'zip' }
    $artifactBase = Join-Path $root "$variant-$retention"
    $directoryAllocation = Measure-Allocation $artifactBase
    $zipAllocation = Measure-Allocation "$artifactBase.zip"
    $row | Add-Member -NotePropertyMembers @{
      sessionAllocatedBytes = Measure-Allocation (Join-Path $root $variant)
      directoryAllocatedBytes = $directoryAllocation
      zipAllocatedBytes = $zipAllocation
      artifactAllocatedBytes = $directoryAllocation + $zipAllocation
    }
  }
  $reports += $report
}
[uint32]$sectors=0; [uint32]$bytes=0; [uint32]$free=0; [uint32]$clusters=0
$volumeRoot = [IO.Path]::GetPathRoot((Resolve-Path -LiteralPath $CurrentReport).Path)
if (-not [AllocationProbe]::GetDiskFreeSpaceW($volumeRoot, [ref]$sectors, [ref]$bytes, [ref]$free, [ref]$clusters)) { throw 'Unable to measure allocation unit' }
$drive = [IO.DriveInfo]::new($volumeRoot)
$result = @{
  measuredAt = (Get-Date).ToString('o')
  platform = [Environment]::OSVersion.VersionString
  filesystem = $drive.DriveFormat
  clusterBytes = $sectors * $bytes
  allocationMethod = 'GetFileInformationByHandleEx FileStandardInfo.AllocationSize per file; excludes directory metadata and shared filesystem overhead. Logical UTF-8/file sizes remain separate. No token estimate.'
  reports = $reports
}
$parent = Split-Path -Parent $Output
New-Item -ItemType Directory -Force -Path $parent | Out-Null
[IO.File]::WriteAllText([IO.Path]::GetFullPath($Output), ($result | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))
Write-Output $Output
