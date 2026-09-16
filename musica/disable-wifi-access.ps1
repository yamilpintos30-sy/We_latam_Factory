# Ejecutar desde PowerShell como Administrador en Windows.
$Port = 3000
$RuleName = "Nocturne Music Studio - WiFi"
netsh interface portproxy delete v4tov4 listenport=$Port listenaddress=0.0.0.0 | Out-Null
Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
Write-Host "Acceso Wi-Fi de Nocturne desactivado." -ForegroundColor Yellow
