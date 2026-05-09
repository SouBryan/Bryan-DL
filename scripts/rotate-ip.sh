#!/bin/sh
# Rotaciona o IP do WARP reconectando o tunnel dentro do container
# a cada ROTATION_INTERVAL segundos (padrão: 1800 = 30 min)
#
# Método 1 (preferido): warp-cli disconnect/connect (sem downtime)
# Método 2 (fallback): docker restart (se warp-cli falhar)

INTERVAL="${ROTATION_INTERVAL:-1800}"

echo "[warp-rotator] Iniciando rotação de IP a cada ${INTERVAL}s"

get_current_ip() {
    docker exec warp-socks curl -s -x socks5h://localhost:1080 https://api.ipify.org 2>/dev/null || echo "unknown"
}

rotate_via_cli() {
    echo "[warp-rotator] Tentando rotação via warp-cli..."
    docker exec warp-socks warp-cli disconnect 2>/dev/null
    sleep 2
    docker exec warp-socks warp-cli connect 2>/dev/null
    sleep 5
    return $?
}

rotate_via_restart() {
    echo "[warp-rotator] Fallback: reiniciando container warp-socks..."
    docker restart warp-socks
    sleep 20
}

while true; do
    sleep "$INTERVAL"
    
    OLD_IP=$(get_current_ip)
    echo "[warp-rotator] $(date -u '+%Y-%m-%d %H:%M:%S UTC') - IP atual: ${OLD_IP} - Rotacionando..."
    
    if ! rotate_via_cli; then
        rotate_via_restart
    fi
    
    NEW_IP=$(get_current_ip)
    
    if [ "$OLD_IP" = "$NEW_IP" ] && [ "$OLD_IP" != "unknown" ]; then
        echo "[warp-rotator] IP não mudou (${OLD_IP}), tentando restart completo..."
        rotate_via_restart
        NEW_IP=$(get_current_ip)
    fi
    
    echo "[warp-rotator] Rotação completa: ${OLD_IP} -> ${NEW_IP}"
done
