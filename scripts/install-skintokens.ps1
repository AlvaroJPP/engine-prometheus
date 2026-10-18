$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "Git não encontrado. Instale o Git para Windows e execute este script novamente."
}
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    throw "Rust/Cargo não encontrado. Instale Rust pelo https://rustup.rs e execute este script novamente."
}

$Root = Join-Path $env:LOCALAPPDATA "EnginePrometheus\tools\skintokens"
$RepoUrl = "https://github.com/chris-straka/skintokens.git"
$PinnedCommit = "3ed8c2d9b352da97208a859ef20a5954751d65f0"
$WeightsUrl = "https://huggingface.co/VAST-AI/SkinTokens/resolve/79736cad0fd84de384d5eede659b4ebd24effe33/experiments/articulation_xl_quantization_256_token_4/grpo_1400.ckpt"
$ExpectedSha256 = "f4e4706a11cfb520cdde65156a0358545e4fbf8f36237aca01ea5e79d5cb5692"
$WeightsDir = Join-Path $Root "weights"
$Checkpoint = Join-Path $WeightsDir "grpo_1400.ckpt"
$Executable = Join-Path $Root "target\release\skintokens.exe"

Write-Host ""
Write-Host "Engine Prometheus - SkinTokens local, sem API paga" -ForegroundColor Cyan
Write-Host "Diretório: $Root"
Write-Host "A primeira instalação baixa o código e um checkpoint de aproximadamente 1,1 GB."
Write-Host "O modelo é executado no computador; não exige chave de API ou assinatura."
Write-Host ""

if (Test-Path $Root) {
    if (-not (Test-Path (Join-Path $Root ".git"))) {
        throw "O diretório já existe, mas não é um clone Git. Renomeie-o manualmente e tente novamente: $Root"
    }
    git -C $Root fetch origin $PinnedCommit
    if ($LASTEXITCODE -ne 0) { throw "Não foi possível buscar a versão fixada do SkinTokens." }
    git -C $Root checkout --detach $PinnedCommit
    if ($LASTEXITCODE -ne 0) { throw "Não foi possível selecionar a versão testada do SkinTokens." }
} else {
    New-Item -ItemType Directory -Force -Path (Split-Path $Root -Parent) | Out-Null
    git clone $RepoUrl $Root
    if ($LASTEXITCODE -ne 0) { throw "Não foi possível baixar o código SkinTokens." }
    git -C $Root checkout --detach $PinnedCommit
    if ($LASTEXITCODE -ne 0) { throw "Não foi possível selecionar a versão testada do SkinTokens." }
}

Write-Host ""
Write-Host "Compilando SkinTokens em modo CPU (sem CUDA e sem GPU de 14 GB)..." -ForegroundColor Yellow
cargo build --release --no-default-features --manifest-path (Join-Path $Root "Cargo.toml")
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $Executable)) {
    throw "A compilação falhou. Confirme a instalação do Rust e das ferramentas de compilação C++ do Visual Studio (MSVC)."
}

New-Item -ItemType Directory -Force -Path $WeightsDir | Out-Null
$NeedsDownload = $true
if (Test-Path $Checkpoint) {
    $ExistingSha = (Get-FileHash -Algorithm SHA256 $Checkpoint).Hash.ToLowerInvariant()
    if ($ExistingSha -eq $ExpectedSha256) {
        $NeedsDownload = $false
        Write-Host "Checkpoint já instalado e verificado." -ForegroundColor Green
    } else {
        Write-Warning "Checkpoint existente tem checksum incorreto; será baixado novamente."
    }
}

if ($NeedsDownload) {
    $Partial = "$Checkpoint.part"
    Remove-Item $Partial -Force -ErrorAction SilentlyContinue
    Write-Host "Baixando checkpoint público (~1,1 GB) do Hugging Face..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri $WeightsUrl -OutFile $Partial
    $DownloadedSha = (Get-FileHash -Algorithm SHA256 $Partial).Hash.ToLowerInvariant()
    if ($DownloadedSha -ne $ExpectedSha256) {
        Remove-Item $Partial -Force -ErrorAction SilentlyContinue
        throw "O checksum do checkpoint não confere. O arquivo incompleto foi removido por segurança."
    }
    Move-Item -Force $Partial $Checkpoint
    Write-Host "Checkpoint baixado e checksum verificado." -ForegroundColor Green
}

Write-Host ""
Write-Host "Testando o backend..." -ForegroundColor Yellow
$env:SKINTOKENS_HOME = $Root
$env:SKINTOKENS_CKPT = $Checkpoint
& $Executable doctor
if ($LASTEXITCODE -ne 0) {
    throw "SkinTokens foi compilado, mas o teste de diagnóstico falhou. Veja as mensagens acima."
}

Write-Host ""
Write-Host "INSTALAÇÃO CONCLUÍDA" -ForegroundColor Green
Write-Host "No importador 3D do Engine Prometheus, cole este caminho no campo 'Executável SkinTokens':"
Write-Host $Executable -ForegroundColor Cyan
Write-Host "Checkpoint: $Checkpoint"
Write-Host "Depois clique em 'Testar backend local'."
