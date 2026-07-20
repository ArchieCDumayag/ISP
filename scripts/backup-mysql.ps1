param(
  [string]$OutputDir = (Join-Path $PSScriptRoot "..\\backups")
)

$host = if ($env:MYSQL_HOST) { $env:MYSQL_HOST } else { "127.0.0.1" }
$port = if ($env:MYSQL_PORT) { $env:MYSQL_PORT } else { "3306" }
$user = if ($env:MYSQL_USER) { $env:MYSQL_USER } else { "root" }
$pass = $env:MYSQL_PASSWORD
$db = $env:MYSQL_DATABASE

if (-not $db) {
  Write-Error "MYSQL_DATABASE is not set."
  exit 1
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$dumpPath = Join-Path $OutputDir "$db-$timestamp.sql"

$args = @("-h", $host, "-P", $port, "-u", $user, "--protocol=tcp")
if ($pass) {
  $args += "--password=$pass"
}
$args += @("--single-transaction", "--routines", "--events", "--databases", $db)

& mysqldump @args | Out-File -FilePath $dumpPath -Encoding utf8
if ($LASTEXITCODE -ne 0) {
  Write-Error "mysqldump failed with exit code $LASTEXITCODE."
  exit $LASTEXITCODE
}

Write-Host "Backup saved: $dumpPath"
