<#
create_cloudflare_mappings.ps1

Usage examples:
  .\create_cloudflare_mappings.ps1 -ZoneId ZONE_ID -AccountId ACCOUNT_ID -TunnelId TUNNEL_ID -Hostname app.dantefiber.com
  # or provide API token env var CF_API_TOKEN and run as above

This script will:
 - create or update a DNS CNAME record for the hostname -> <tunnel-id>.cfargotunnel.com (proxied=false)
 - create (or replace) a tunnel public hostname mapping that forwards to the local service (http://localhost:3000 by default)

Notes:
 - Provide a Cloudflare API token via -ApiToken or set environment variable CF_API_TOKEN.
 - The token needs Zone.DNS edit permission for the zone and Account/Tunnels edit permission for the account.
#>

param(
    [string]$ApiToken,
    [Parameter(Mandatory=$true)][string]$ZoneId,
    [Parameter(Mandatory=$true)][string]$AccountId,
    [Parameter(Mandatory=$true)][string]$TunnelId,
    [Parameter(Mandatory=$true)][string]$Hostname,
    [string]$Service = "http://localhost:3000",
    [switch]$VerboseHttp
)

function Write-Info { param($m) Write-Host "[info] $m" -ForegroundColor Cyan }
function Write-Ok   { param($m) Write-Host "[ok]   $m" -ForegroundColor Green }
function Write-Warn { param($m) Write-Host "[warn] $m" -ForegroundColor Yellow }
function Write-Err  { param($m) Write-Host "[error] $m" -ForegroundColor Red }

if (-not $ApiToken) {
    if ($env:CF_API_TOKEN) {
        $ApiToken = $env:CF_API_TOKEN
    } else {
        Write-Host "Cloudflare API token not provided. You can pass -ApiToken or set CF_API_TOKEN environment variable." -ForegroundColor Yellow
        $ApiToken = Read-Host -Prompt "Cloudflare API token (paste, will be visible)"
    }
}

$headers = @{ Authorization = "Bearer $ApiToken"; 'Content-Type' = 'application/json' }
$cfTarget = "$TunnelId.cfargotunnel.com"

# Helper: Invoke API with error handling
function Invoke-Api {
    param(
        [string]$Method,
        [string]$Uri,
        $Body = $null
    )
    try {
        if ($Body -ne $null) {
            $json = $Body | ConvertTo-Json -Depth 10
            if ($VerboseHttp) { Write-Host "REQUEST: $Method $Uri`n$json`n" }
            $resp = Invoke-RestMethod -Method $Method -Uri $Uri -Headers $headers -Body $json -ErrorAction Stop
        } else {
            if ($VerboseHttp) { Write-Host "REQUEST: $Method $Uri`n" }
            $resp = Invoke-RestMethod -Method $Method -Uri $Uri -Headers $headers -ErrorAction Stop
        }
        return $resp
    } catch {
        Write-Err "HTTP $Method $Uri failed: $($_.Exception.Message)"
        if ($_.Exception -and $_.Exception.Response) {
            try {
                $respStream = $_.Exception.Response.GetResponseStream()
                if ($respStream) {
                    $reader = New-Object System.IO.StreamReader($respStream)
                    $errText = $reader.ReadToEnd()
                    $reader.Close()
                } else {
                    $errText = $null
                }
            } catch { $errText = $null }
            if ($errText) { Write-Host $errText }
        }
        return $null
    }
}

# 1) Create or update DNS CNAME
Write-Info "Checking existing DNS records for $Hostname in zone $ZoneId..."
$encodedName = [System.Uri]::EscapeDataString($Hostname)
$dnsListUri = "https://api.cloudflare.com/client/v4/zones/$ZoneId/dns_records?type=CNAME&name=$encodedName"
$existingDns = Invoke-Api -Method Get -Uri $dnsListUri

if ($existingDns -and $existingDns.success -and ($existingDns.result | Measure-Object).Count -gt 0) {
    $rec = $existingDns.result[0]
    if ($rec.content -eq $cfTarget -and $rec.proxied -eq $false) {
        Write-Ok "DNS CNAME already exists and matches target ($cfTarget). id=$($rec.id)"
    } else {
        Write-Warn "DNS CNAME exists but differs. Updating record id=$($rec.id)"
        $updateBody = @{ type = 'CNAME'; name = $Hostname; content = $cfTarget; ttl = 1; proxied = $false }
        $updateUri = "https://api.cloudflare.com/client/v4/zones/$ZoneId/dns_records/$($rec.id)"
        $r = Invoke-Api -Method Put -Uri $updateUri -Body $updateBody
        if ($r -and $r.success) { Write-Ok "DNS record updated." } else { Write-Err "Failed to update DNS record." }
    }
} else {
    Write-Info "No existing CNAME found. Creating new DNS CNAME $Hostname -> $cfTarget"
    $createBody = @{ type = 'CNAME'; name = $Hostname; content = $cfTarget; ttl = 1; proxied = $false }
    $createUri = "https://api.cloudflare.com/client/v4/zones/$ZoneId/dns_records"
    $r = Invoke-Api -Method Post -Uri $createUri -Body $createBody
    if ($r -and $r.success) { Write-Ok "DNS record created. id=$($r.result.id)" } else { Write-Err "Failed to create DNS record." }
}

# 2) Create or update Tunnel Public Hostname
Write-Info "Checking existing public hostnames for tunnel $TunnelId in account $AccountId..."
$publicListUri = "https://api.cloudflare.com/client/v4/accounts/$AccountId/argo/tunnels/$TunnelId/public_hostnames"
$existingPH = Invoke-Api -Method Get -Uri $publicListUri

$needCreatePH = $true
if ($existingPH -and $existingPH.success) {
    foreach ($p in $existingPH.result) {
        if ($p.hostname -eq $Hostname) {
            if ($p.service -eq $Service) {
                Write-Ok "Public hostname already exists and matches service. id=$($p.id)"
                $needCreatePH = $false
            } else {
                Write-Warn "Public hostname exists but service differs. Deleting existing id=$($p.id) and will recreate."
                $delUri = "https://api.cloudflare.com/client/v4/accounts/$AccountId/argo/tunnels/$TunnelId/public_hostnames/$($p.id)"
                $delResp = Invoke-Api -Method Delete -Uri $delUri
                if ($delResp -and $delResp.success) { Write-Info "Deleted existing public hostname id=$($p.id)" } else { Write-Warn "Failed to delete existing public hostname id=$($p.id). You may need to remove it in Cloudflare dashboard." }
            }
            break
        }
    }
}

if ($needCreatePH) {
    Write-Info "Creating public hostname mapping: $Hostname -> $Service on tunnel $TunnelId"
    $phBody = @{ hostname = $Hostname; service = $Service }
    $createPHUri = "https://api.cloudflare.com/client/v4/accounts/$AccountId/argo/tunnels/$TunnelId/public_hostnames"
    $r = Invoke-Api -Method Post -Uri $createPHUri -Body $phBody
    if ($r -and $r.success) { Write-Ok "Public hostname created. id=$($r.result.id)" } else { Write-Err "Failed to create public hostname. See response above." }
}

# 3) Verification hints
Write-Host "`nVerification steps:`n" -ForegroundColor White
Write-Host "1) Check DNS CNAME (nslookup):" -ForegroundColor Cyan
Write-Host "   nslookup -type=CNAME $Hostname`n"
Write-Host "2) List public hostnames for tunnel (API):" -ForegroundColor Cyan
Write-Host "   GET https://api.cloudflare.com/client/v4/accounts/$AccountId/argo/tunnels/$TunnelId/public_hostnames`n"
Write-Host "3) While cloudflared tunnel is running, observe its logs and run:`n   curl -v https://$Hostname/`n" -ForegroundColor Cyan

Write-Ok "Script finished. If any API calls failed, re-run with -VerboseHttp to see request bodies and responses."
