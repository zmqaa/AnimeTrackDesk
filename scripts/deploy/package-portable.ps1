$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$packageJsonPath = Join-Path $projectRoot "package.json"
$releaseDir = Join-Path $projectRoot "src-tauri\target\release"
$sourceExePath = Join-Path $releaseDir "animetrack.exe"

if (-not (Test-Path $packageJsonPath)) {
  throw "package.json not found: $packageJsonPath"
}

if (-not (Test-Path $sourceExePath)) {
  throw "Desktop executable not found: $sourceExePath. Run npm run tauri build first."
}

$packageJson = Get-Content $packageJsonPath -Raw | ConvertFrom-Json
$version = [string]$packageJson.version
if ([string]::IsNullOrWhiteSpace($version)) {
  throw "Unable to read version from package.json."
}

$buildStamp = (Get-Item $sourceExePath).LastWriteTime.ToString("yyyyMMdd-HHmmss")
$portableFolderName = "AnimeTrack-$buildStamp"
$portableExeName = "AnimeTrack.exe"

$portableBundleDir = Join-Path $releaseDir "bundle\portable"
$stagingRoot = Join-Path $releaseDir "portable-stage"
$stagingDir = Join-Path $stagingRoot $portableFolderName
$portableExePath = Join-Path $stagingDir $portableExeName
$portableReadmePath = Join-Path $stagingDir "README.txt"
$portableZipPath = Join-Path $portableBundleDir ("AnimeTrack_{0}_x64_portable_{1}.zip" -f $version, $buildStamp)

if (Test-Path $stagingRoot) {
  Remove-Item $stagingRoot -Recurse -Force
}

New-Item -ItemType Directory -Path $stagingDir -Force | Out-Null
New-Item -ItemType Directory -Path $portableBundleDir -Force | Out-Null

Copy-Item $sourceExePath $portableExePath -Force

$portableReadmeTemplateBase64 = "QW5pbWVUcmFjayDkvr/mkLrniYgKCuS9v+eUqOaWueazle+8mgoxLiDlhYjlsIbmlbTkuKrljovnvKnljIXop6PljovliLDkuIDkuKrmlrDnmoTmlofku7blpLnkvY3nva7jgIIKMi4g5omT5byAIHswfSDmlofku7blpLnjgIIKMy4g5Y+M5Ye7IHsxfSDljbPlj6/ov5DooYzjgIIKCuivtOaYju+8mgotIOi/meS4quS+v+aQuueJiOS4jei1sCBNU0kg5oiWIE5TSVMg5a6J6KOF5rWB56iL77yM6YCC5ZCI5a6J6KOF5YyF6KKr57O757uf562W55Wl5oum5oiq5pe25L2/55So44CCCi0g5b2T5YmN5p6E5bu65LuN54S25rKh5pyJ5pWw5a2X562+5ZCN44CC5aaC5p6cIFdpbmRvd3MgU21hcnQgQXBwIENvbnRyb2wg5oiW5pu05Lil5qC855qE5bqU55So5o6n5Yi2562W55Wl5aSE5LqO5ZCv55So54q25oCB77yM5L6/5pC654mI5Y+v5omn6KGM5paH5Lu25Lmf5Y+v6IO96KKr5oum5oiq44CCCi0g5bqU55So5pWw5o2u5L+d5a2Y5Zyo5b2T5YmN55So5oi355qEIEFwcERhdGEg55uu5b2V5Lit77yM5LiN5Lya5YaZ5YWl5L6/5pC654mI5paH5Lu25aS55YaF6YOo44CCCi0gQUkgQVBJIEtleSDku43kvJrkvJjlhYjlhpnlhaXns7vnu5/lronlhajlrZjlgqjjgIIKLSDkvr/mkLrniYjmlofku7blpLnlkI3kuK3ljIXlkKvmnoTlu7rml7bpl7TmiLPvvIznlKjmnaXpmY3kvY4gV2luZG93cyDotYTmupDnrqHnkIblmajlnKjmlrDml6fniYjmnKzop6PljovlkI7lpI3nlKjml6flm77moIfnvJPlrZjnmoTmpoLnjofjgII="
$portableReadmeTemplate = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($portableReadmeTemplateBase64))
$portableReadme = [string]::Format($portableReadmeTemplate, $portableFolderName, $portableExeName)

[System.IO.File]::WriteAllText(
  $portableReadmePath,
  $portableReadme,
  [System.Text.UTF8Encoding]::new($true)
)

if (Test-Path $portableZipPath) {
  Remove-Item $portableZipPath -Force
}

Compress-Archive -Path $stagingDir -DestinationPath $portableZipPath -Force

Write-Host "Portable bundle created: $portableZipPath"