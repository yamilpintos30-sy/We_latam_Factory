# Ejecutar desde PowerShell como Administrador en Windows.
$ErrorActionPreference = "Stop"
$Port = 3000
$RuleName = "Nocturne Music Studio - WiFi"

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Abre PowerShell como Administrador y vuelve a ejecutar este script."
}

$WslIp = (wsl.exe -- hostname -I).Trim().Split(' ')[0]
if (-not $WslIp -or $WslIp -notmatch '^\d+\.\d+\.\d+\.\d+$') {
    throw "No se pudo detectar la IP IPv4 de WSL."
}

netsh interface portproxy delete v4tov4 listenport=$Port listenaddress=0.0.0.0 2>$null | Out-Null
netsh interface portproxy add v4tov4 listenport=$Port listenaddress=0.0.0.0 connectport=$Port connectaddress=$WslIp | Out-Null

Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName $RuleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -Profile Any -RemoteAddress LocalSubnet | Out-Null

$LanIp = Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254*' -and $_.InterfaceAlias -notlike '*vEthernet*' -and $_.InterfaceAlias -notlike '*Tailscale*' } |
    Select-Object -First 1 -ExpandProperty IPAddress

Write-Host "Nocturne publicado en la red local." -ForegroundColor Green
Write-Host "WSL:     $WslIp`:$Port"
Write-Host "Wi-Fi:   http://$LanIp`:$Port"
Write-Host "Nota: si WSL cambia de IP tras reiniciar, vuelve a ejecutar este script."
