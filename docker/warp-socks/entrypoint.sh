#!/bin/bash
set -e

SOCKS_PORT="${WARP_SOCKS_PORT:-9091}"

echo "[warp-socks] Starting warp-svc daemon..."
warp-svc &

# Wait for the daemon socket
for i in $(seq 1 30); do
    if warp-cli status 2>/dev/null | grep -q "Status"; then
        echo "[warp-socks] warp-svc is ready"
        break
    fi
    echo "[warp-socks] Waiting for warp-svc... ($i/30)"
    sleep 2
done

# Register if not already registered
if ! warp-cli registration show 2>/dev/null | grep -q "Account"; then
    echo "[warp-socks] Registering new WARP account..."
    warp-cli registration new
fi

# Set proxy mode with SOCKS5 on the specified port
echo "[warp-socks] Configuring proxy mode on port ${SOCKS_PORT}..."
warp-cli mode proxy
warp-cli proxy port "${SOCKS_PORT}"

# Connect
echo "[warp-socks] Connecting..."
warp-cli connect

# Wait for connection
for i in $(seq 1 20); do
    STATUS=$(warp-cli status 2>/dev/null || echo "unknown")
    if echo "$STATUS" | grep -q "Connected"; then
        echo "[warp-socks] Connected! SOCKS5 proxy available at localhost:${SOCKS_PORT}"
        break
    fi
    echo "[warp-socks] Waiting for connection... ($i/20) - $STATUS"
    sleep 3
done

# Keep alive
echo "[warp-socks] Running. SOCKS5 on :${SOCKS_PORT}"
wait
