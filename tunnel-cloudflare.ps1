# Публичная HTTPS-ссылка без карты (Cloudflare Tunnel).
# 1) Скачайте cloudflared: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
# 2) В другом окне: node server.js
# 3) Запустите этот скрипт
Write-Host "Туннель к http://localhost:3000 ..."
cloudflared tunnel --url http://localhost:3000
