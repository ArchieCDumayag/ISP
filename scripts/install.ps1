$ErrorActionPreference = 'Stop'

Write-Host '== Billing System Fresh Install ==' -ForegroundColor Cyan

function Prompt-Value($label, $defaultValue = '') {
  $suffix = if ($defaultValue) { " [$defaultValue]" } else { '' }
  $value = Read-Host "$label$suffix"
  if ([string]::IsNullOrWhiteSpace($value)) {
    return $defaultValue
  }
  return $value
}

function New-HexSecret([int]$bytes = 32) {
  $buffer = New-Object byte[] $bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($buffer)
  return ([System.BitConverter]::ToString($buffer)).Replace('-', '').ToLowerInvariant()
}

$mysqlHost = Prompt-Value 'MySQL Host' '127.0.0.1'
$mysqlPort = Prompt-Value 'MySQL Port' '3306'
$mysqlUser = Prompt-Value 'MySQL User' 'billing_user'
$mysqlPassword = Prompt-Value 'MySQL Password' ''
$mysqlDatabase = Prompt-Value 'MySQL Database' 'billing_system'
$masterKey = Prompt-Value 'CONFIG_MASTER_KEY (keep secret)' ''
$sessionTokenSecret = Prompt-Value 'SESSION_TOKEN_SECRET (leave blank to auto-generate)' ''

if ([string]::IsNullOrWhiteSpace($masterKey)) {
  Write-Host 'ERROR: CONFIG_MASTER_KEY is required.' -ForegroundColor Red
  exit 1
}

if ([string]::IsNullOrWhiteSpace($sessionTokenSecret)) {
  $sessionTokenSecret = New-HexSecret 32
  Write-Host "Generated SESSION_TOKEN_SECRET: $sessionTokenSecret" -ForegroundColor Yellow
}

$env:MYSQL_HOST = $mysqlHost
$env:MYSQL_PORT = $mysqlPort
$env:MYSQL_USER = $mysqlUser
$env:MYSQL_PASSWORD = $mysqlPassword
$env:MYSQL_DATABASE = $mysqlDatabase
$env:MYSQL_CONN_LIMIT = '10'
$env:CONFIG_MASTER_KEY = $masterKey
$env:SESSION_TOKEN_SECRET = $sessionTokenSecret

$env:INITIAL_ADMIN_USERNAME = 'archiecd'
$env:INITIAL_ADMIN_PASSWORD = 'finley123!'

Write-Host 'Running schema update...' -ForegroundColor Yellow
node scripts\migrate-json-to-schema.js
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Schema update failed. Please check the error output.' -ForegroundColor Red
  exit 1
}

Write-Host 'Starting server...' -ForegroundColor Green
node server.js
