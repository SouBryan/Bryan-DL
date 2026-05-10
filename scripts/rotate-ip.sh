#!/bin/sh
# Rotaciona o IP do WARP recriando o container warp-socks com nova registration
# a cada ROTATION_INTERVAL segundos (padrão: 1800 = 30 min)
#
# Também escuta na porta 7070 para rotações sob demanda (trigger HTTP)
# Exemplo: curl http://warp-rotator:7070/rotate

INTERVAL="${ROTATION_INTERVAL:-1800}"
TRIGGER_PORT=7070
COMPOSE_DIR="${COMPOSE_DIR:-/project}"

echo "[warp-rotator] Iniciando rotação de IP a cada ${INTERVAL}s"
echo "[warp-rotator] HTTP trigger escutando em :${TRIGGER_PORT}/rotate"

get_current_ip() {
    docker exec warp-socks curl -s --max-time 8 -x socks5h://localhost:9091 https://api.ipify.org 2>/dev/null || echo "unknown"
}

do_rotate() {
    local REASON="${1:-scheduled}"
    OLD_IP=$(get_current_ip)
    echo "[warp-rotator] $(date -u '+%Y-%m-%d %H:%M:%S UTC') - IP: ${OLD_IP} - Rotacionando (${REASON})..."

    # Stop container, remove WARP registration volume, recreate with fresh key
    docker rm -f warp-socks 2>/dev/null
    docker volume rm qobuz-dl_warp_data 2>/dev/null || docker volume rm warp_data 2>/dev/null
    sleep 2

    # Recreate the container via docker compose
    docker compose -f "${COMPOSE_DIR}/docker-compose.yml" up -d warp-socks 2>/dev/null \
        || docker-compose -f "${COMPOSE_DIR}/docker-compose.yml" up -d warp-socks 2>/dev/null

    # Wait for warp-socks to become healthy
    echo "[warp-rotator] Aguardando warp-socks ficar healthy..."
    for i in $(seq 1 20); do
        sleep 5
        STATUS=$(docker inspect --format='{{.State.Health.Status}}' warp-socks 2>/dev/null || echo "missing")
        if [ "$STATUS" = "healthy" ]; then
            break
        fi
        echo "[warp-rotator] ...status: ${STATUS} (tentativa ${i}/20)"
    done

    NEW_IP=$(get_current_ip)
    echo "[warp-rotator] Rotação completa: ${OLD_IP} -> ${NEW_IP}"
}

# Background: HTTP trigger listener (via nc)
start_trigger_listener() {
    while true; do
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
