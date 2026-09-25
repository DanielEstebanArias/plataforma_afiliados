$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Instala Node.js 22.13 o superior antes de continuar.' }
Start-Process 'http://localhost:4180/'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
node scripts/start-affiliates.cjs
