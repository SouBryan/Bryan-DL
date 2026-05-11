FROM debian:13.2

WORKDIR /app

# Download prebuilt arm64 release (includes wrapper binary + rootfs + entrypoint)
RUN apt-get update && \
    apt-get install -y --no-install-recommends wget unzip ca-certificates curl && \
    wget -q -O /tmp/wrapper.zip https://github.com/WorldObservationLog/wrapper/releases/download/wrapper.arm64.latest/Wrapper.arm64.latest.zip && \
    unzip -o /tmp/wrapper.zip -d /app && \
    chmod +x /app/wrapper /app/entrypoint.sh && \
    rm /tmp/wrapper.zip && \
    apt-get purge -y wget unzip && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

EXPOSE 10020 20020 30020

CMD ["/app/entrypoint.sh"]
