param([string]$Archive)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $repo 'runtime'
$target = Join-Path $runtime 'weknora-0.9.0-company-accounts'
$expected = 'A62B5F64FA9859D8A387DD3768338A1BADB6EE678CD114DA6E77214F381949B2'
$asset = 'Schanora-WeKnora-Lite-0.9.0-company-accounts-win-x64.zip'
$url = "https://github.com/CHRISYU2233/Schanora-Republic/releases/download/weknora-lite-0.9.0-company-accounts-win-x64/$asset"

if (Test-Path -LiteralPath $target) {
    if ((Test-Path -LiteralPath (Join-Path $target 'WeKnora-lite.exe') -PathType Leaf) -and
        (Test-Path -LiteralPath (Join-Path $target 'SCHANORA-COMPANY-ACCOUNTS') -PathType Leaf)) {
        Write-Output "WeKnora runtime is already installed at $target"
        return
    }
    throw "Runtime directory exists but is incomplete. Move it aside before installing: $target"
}
if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64' -and $env:PROCESSOR_ARCHITEW6432 -ne 'AMD64') {
    throw 'This runtime archive requires Windows x64.'
}

New-Item -Type Directory -Force -Path $runtime | Out-Null
$staging = Join-Path $runtime ('.install-' + [guid]::NewGuid().ToString('N'))
$inputZip = $Archive
if (-not $inputZip) {
    $inputZip = Join-Path $runtime $asset
    if (-not (Test-Path -LiteralPath $inputZip -PathType Leaf)) {
        Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile "$inputZip.part"
        if ((Get-FileHash -LiteralPath "$inputZip.part" -Algorithm SHA256).Hash -ne $expected) {
            throw "Downloaded archive did not match the pinned SHA-256: $inputZip.part"
        }
        Move-Item -LiteralPath "$inputZip.part" -Destination $inputZip
    }
}
if ((Get-FileHash -LiteralPath $inputZip -Algorithm SHA256).Hash -ne $expected) {
    throw "Archive did not match the pinned SHA-256: $inputZip"
}
Expand-Archive -LiteralPath $inputZip -DestinationPath $staging
foreach ($path in @('WeKnora-lite.exe','SCHANORA-COMPANY-ACCOUNTS','web/index.html','config/config.yaml','migrations/sqlite')) {
    if (-not (Test-Path -LiteralPath (Join-Path $staging $path))) {
        throw "Missing runtime component: $path"
    }
}
if (Test-Path -LiteralPath $target) { throw "Runtime appeared during installation: $target" }
Move-Item -LiteralPath $staging -Destination $target
Write-Output "Installed WeKnora runtime at $target"
