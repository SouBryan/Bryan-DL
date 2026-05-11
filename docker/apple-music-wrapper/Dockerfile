FROM debian:13.2

WORKDIR /app

# Download prebuilt arm64 release (wrapper binary + rootfs + entrypoint)
RUN apt-get update && \
    apt-get install -y --no-install-recommends wget unzip ca-certificates git && \
    wget -q -O /tmp/wrapper.zip https://github.com/WorldObservationLog/wrapper/releases/download/wrapper.arm64.latest/Wrapper.arm64.latest.zip && \
    unzip -o /tmp/wrapper.zip -d /app && \
    chmod +x /app/wrapper && \
    rm /tmp/wrapper.zip && \
    # Get rootfs and entrypoint from main branch
    git clone --depth 1 --filter=blob:none --sparse https://github.com/WorldObservationLog/wrapper.git /tmp/wrapper-repo && \
    cd /tmp/wrapper-repo && git sparse-checkout set rootfs entrypoint.sh && \
    cp -r /tmp/wrapper-repo/rootfs /app/rootfs && \
    cp /tmp/wrapper-repo/entrypoint.sh /app/entrypoint.sh && \
    chmod +x /app/entrypoint.sh && \
    rm -rf /tmp/wrapper-repo && \
    apt-get purge -y wget unzip git && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

EXPOSE 10020 20020 30020

CMD ["/app/entrypoint.sh"]
