FROM debian:13.2

WORKDIR /app

# Download prebuilt arm64 wrapper binary from GitHub release
RUN apt-get update && apt-get install -y wget && \
    wget -q -O /app/wrapper https://github.com/WorldObservationLog/wrapper/releases/download/wrapper.arm64.latest/wrapper && \
    chmod +x /app/wrapper && \
    apt-get purge -y wget && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

# Clone only the rootfs directory from the repo
RUN apt-get update && apt-get install -y git && \
    git clone --depth 1 --filter=blob:none --sparse https://github.com/WorldObservationLog/wrapper.git /tmp/wrapper-repo && \
    cd /tmp/wrapper-repo && git sparse-checkout set rootfs && \
    cp -r /tmp/wrapper-repo/rootfs /app/rootfs && \
    rm -rf /tmp/wrapper-repo && \
    apt-get purge -y git && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

# Copy entrypoint from repo
RUN apt-get update && apt-get install -y wget && \
    wget -q -O /app/entrypoint.sh https://raw.githubusercontent.com/WorldObservationLog/wrapper/main/entrypoint.sh && \
    chmod +x /app/entrypoint.sh && \
    apt-get purge -y wget && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

EXPOSE 10020 20020 30020

CMD ["/app/entrypoint.sh"]
