FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV WARP_SOCKS_PORT=9091

# Install dependencies + Cloudflare WARP client
RUN apt-get update && \
    apt-get install -y curl gnupg lsb-release iproute2 dbus && \
    curl -fsSL https://pkg.cloudflareclient.com/pubkey.gpg | gpg --dearmor -o /usr/share/keyrings/cloudflare-warp-archive-keyring.gpg && \
    echo "deb [signed-by=/usr/share/keyrings/cloudflare-warp-archive-keyring.gpg] https://pkg.cloudflareclient.com/ $(lsb_release -cs) main" > /etc/apt/sources.list.d/cloudflare-client.list && \
    apt-get update && \
    apt-get install -y cloudflare-warp && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

HEALTHCHECK --interval=15s --timeout=10s --retries=10 --start-period=30s \
    CMD curl -x socks5h://localhost:${WARP_SOCKS_PORT} -s https://cloudflare.com/cdn-cgi/trace | grep -q "warp=on"

ENTRYPOINT ["/entrypoint.sh"]
