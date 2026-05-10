#!/bin/sh
# Rotaciona o IP do WARP reiniciando o container warp-socks
# a cada ROTATION_INTERVAL segundos (padrão: 1800 = 30 min)
#
# Também escuta na porta 7070 para rotações sob demanda (trigger HTTP)
# Exemplo: curl http://warp-rotator:7070/rotate

INTERVAL="${ROTATION_INTERVAL:-1800}"
TRIGGER_PORT=7070

echo "[warp-rotator] Iniciando rotação de IP a cada ${INTERVAL}s"
echo "[warp-rotator] HTTP trigger escutando em :${TRIGGER_PORT}/rotate"

get_current_ip() {
    docker exec warp-socks curl -s --max-time 5 -x socks5h://localhost:9091 https://api.ipify.org 2>/dev/null || echo "unknown"
}

do_rotate() {
    local REASON="${1:-scheduled}"
    OLD_IP=$(get_current_ip)
    echo "[warp-rotator] $(date -u '+%Y-%m-%d %H:%M:%S UTC') - IP: ${OLD_IP} - Rotacionando (${REASON})..."
    docker restart warp-socks
    sleep 15
    NEW_IP=$(get_current_ip)
    echo "[warp-rotator] Rotação completa: ${OLD_IP} -> ${NEW_IP}"
}

# Background: HTTP trigger listener (via nc)
start_trigger_listener() {
    while true; do
        # Listen for incoming HTTP request, respond 200 and trigger rotation
        RESPONSE="HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nrotating"
        REQUEST=$(echo -e "$RESPONSE" | nc -l -p "$TRIGGER_PORT" -w 5 2>/dev/null)
        if echo "$REQUEST" | grep -q "GET /rotate"; then
            echo "[warp-rotator] On-demand rotation triggered via HTTP"
            do_rotate "on-demand"
        fi
    done
}

start_trigger_listener &

# Main loop: proactive rotation
while true; do
    sleep "$INTERVAL"
    do_rotate "scheduled ${INTERVAL}s"
done
