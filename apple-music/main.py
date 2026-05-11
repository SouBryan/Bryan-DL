"""
Apple Music Sidecar — FastAPI service
Internal service called by the Next.js app. Not exposed publicly.
Provides: search, download+decrypt+upload to R2, health check.
"""

import asyncio
import json
import os
import tempfile
import shutil
import logging
from contextlib import asynccontextmanager
from pathlib import Path

import boto3
from botocore.exceptions import ClientError
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse

from gamdl.api import AppleMusicApi
from gamdl.downloader import (
    AppleMusicBaseDownloader,
    AppleMusicDownloader,
    AppleMusicSongDownloader,
    AppleMusicMusicVideoDownloader,
    AppleMusicUploadedVideoDownloader,
)
from gamdl.interface import (
    AppleMusicBaseInterface,
    AppleMusicInterface,
    AppleMusicMusicVideoInterface,
    AppleMusicSongInterface,
    AppleMusicUploadedVideoInterface,
    SongCodec,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("apple-music-api")

# ── Config ──

COOKIES_PATH = os.environ.get("APPLE_MUSIC_COOKIES_PATH", "/app/cookies/cookies.txt")
TEMP_DIR = os.environ.get("APPLE_MUSIC_TEMP_DIR", "/tmp/apple-music-processing")

R2_ENDPOINT_URL = os.environ.get("R2_ENDPOINT_URL", "")
R2_ACCESS_KEY_ID = os.environ.get("R2_ACCESS_KEY_ID", "")
R2_SECRET_ACCESS_KEY = os.environ.get("R2_SECRET_ACCESS_KEY", "")
R2_BUCKET_NAME = os.environ.get("R2_BUCKET_NAME", "media-cache")
R2_PUBLIC_URL = os.environ.get("R2_PUBLIC_URL", "")

# Wrapper config (for ALAC/lossless support)
WRAPPER_HOST = os.environ.get("WRAPPER_HOST", "")
WRAPPER_DECRYPT_PORT = int(os.environ.get("WRAPPER_DECRYPT_PORT", "10020"))
WRAPPER_M3U8_PORT = int(os.environ.get("WRAPPER_M3U8_PORT", "20020"))
WRAPPER_ACCOUNT_PORT = int(os.environ.get("WRAPPER_ACCOUNT_PORT", "30020"))
USE_WRAPPER = bool(WRAPPER_HOST)

SOCKS5_PROXY = os.environ.get("SOCKS5_PROXY", "")

# ── Monkey-patch httpx to inject SOCKS5 proxy into all gamdl requests ──
if SOCKS5_PROXY:
    import httpx
    _proxy_url = SOCKS5_PROXY if "://" in SOCKS5_PROXY else f"socks5://{SOCKS5_PROXY}"

    # Internal Docker hostnames that must NOT go through the SOCKS5 proxy
    _NO_PROXY_HOSTS = {
        "apple-music-wrapper",
        "warp-socks",
        "localhost",
        "127.0.0.1",
    }

    # 1) Patch AsyncHTTPTransport to inject proxy by default.
    #    This covers RetryTransport (used by gamdl's main client) which
    #    internally creates an AsyncHTTPTransport without proxy.
    _original_transport_init = httpx.AsyncHTTPTransport.__init__

    def _patched_transport_init(self, *args, **kwargs):
        if "proxy" not in kwargs:
            kwargs["proxy"] = _proxy_url
        _original_transport_init(self, *args, **kwargs)

    httpx.AsyncHTTPTransport.__init__ = _patched_transport_init

    class _SmartProxyTransport(httpx.AsyncBaseTransport):
        """Routes requests through SOCKS5 proxy unless target is an internal Docker host."""

        def __init__(self):
            # Create proxy transport (uses patched init, gets proxy automatically)
            self._proxy = httpx.AsyncHTTPTransport()
            # Create direct transport bypassing the patch
            self._direct = httpx.AsyncHTTPTransport.__new__(httpx.AsyncHTTPTransport)
            _original_transport_init(self._direct)

        async def handle_async_request(self, request):
            host = request.url.host or ""
            if host in _NO_PROXY_HOSTS:
                return await self._direct.handle_async_request(request)
            return await self._proxy.handle_async_request(request)

        async def aclose(self):
            await self._proxy.aclose()
            await self._direct.aclose()

    # 2) Patch AsyncClient to use SmartProxyTransport for short-lived clients
    #    (wrapper, cover downloads, etc). This routes per-request based on hostname.
    _original_client_init = httpx.AsyncClient.__init__

    def _patched_client_init(self, *args, **kwargs):
        if "proxy" not in kwargs and "transport" not in kwargs:
            kwargs["transport"] = _SmartProxyTransport()
        _original_client_init(self, *args, **kwargs)

    httpx.AsyncClient.__init__ = _patched_client_init

    logger.info(f"httpx monkey-patched with smart proxy: {_proxy_url}")
    logger.info(f"No-proxy hosts (bypass SOCKS5): {_NO_PROXY_HOSTS}")
else:
    logger.warning("No SOCKS5_PROXY configured — Apple Music requests will use direct connection")

# ── Global state ──

apple_music_api: AppleMusicApi | None = None
apple_music_interface: AppleMusicInterface | None = None
s3_client = None
_init_lock = asyncio.Lock()
_wrapper_connected = False  # True only if wrapper was actually used (not cookie fallback)


def get_s3_client():
    return boto3.client(
        "s3",
        endpoint_url=R2_ENDPOINT_URL,
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        region_name="auto",
    )


def r2_object_exists(key: str) -> bool:
    """Check if an object exists in R2."""
    try:
        s3_client.head_object(Bucket=R2_BUCKET_NAME, Key=key)
        return True
    except ClientError:
        return False


def r2_upload_file(local_path: str, key: str) -> str:
    """Upload a file to R2 and return the public URL."""
    s3_client.upload_file(
        local_path,
        R2_BUCKET_NAME,
        key,
        ExtraArgs={"ContentType": "audio/mp4"},
    )
    return f"{R2_PUBLIC_URL}/{key}"


async def init_gamdl():
    """Initialize gamdl API and interfaces."""
    global apple_music_api, apple_music_interface, s3_client

    async with _init_lock:
        if apple_music_api is not None:
            return

        # Initialize gamdl — try wrapper first (ALAC/lossless), fall back to cookies (AAC only)
        global _wrapper_connected
        if USE_WRAPPER:
            wrapper_account_url = f"http://{WRAPPER_HOST}:{WRAPPER_ACCOUNT_PORT}/"
            logger.info(f"Initializing gamdl with WRAPPER at {wrapper_account_url}")

            # Retry wrapper connection (Docker healthcheck ensures port is listening,
            # but the API may need a moment after port opens)
            max_retries = 5
            for attempt in range(1, max_retries + 1):
                try:
                    apple_music_api = await AppleMusicApi.create_from_wrapper(
                        wrapper_account_url=wrapper_account_url,
                    )
                    _wrapper_connected = True
                    logger.info(f"Wrapper connected on attempt {attempt}! Subscription: {apple_music_api.active_subscription}")
                    logger.info(f"Storefront: {apple_music_api.storefront}")
                    logger.info("ALAC/lossless codec available via wrapper")
                    break
                except Exception as e:
                    if attempt < max_retries:
                        wait = 5
                        logger.warning(f"Wrapper attempt {attempt}/{max_retries} failed ({e}), retrying in {wait}s...")
                        await asyncio.sleep(wait)
                    else:
                        logger.error(f"Wrapper failed after {max_retries} attempts ({e}), falling back to cookies...")
                        apple_music_api = await AppleMusicApi.create_from_netscape_cookies(COOKIES_PATH)
                        logger.info(f"Cookies fallback — Subscription: {apple_music_api.active_subscription}")
        else:
            logger.info(f"Initializing gamdl with cookies from {COOKIES_PATH}")
            apple_music_api = await AppleMusicApi.create_from_netscape_cookies(COOKIES_PATH)
            logger.info(f"Subscription active: {apple_music_api.active_subscription}")
            logger.info(f"Storefront: {apple_music_api.storefront}")

        base_interface = await AppleMusicBaseInterface.create(
            apple_music_api=apple_music_api,
            **({"use_wrapper": True, "wrapper_m3u8_ip": f"{WRAPPER_HOST}:{WRAPPER_M3U8_PORT}"} if _wrapper_connected else {}),
        )

        # With wrapper: ALAC first (lossless), fallback to AAC. Without: AAC only.
        if _wrapper_connected:
            codec_priority = [SongCodec.ALAC, SongCodec.AAC_LEGACY]
        else:
            codec_priority = [SongCodec.AAC_LEGACY]
        logger.info(f"Codec priority: {[c.value for c in codec_priority]}")

        song_interface = AppleMusicSongInterface(
            base=base_interface,
            codec_priority=codec_priority,
        )
        mv_interface = AppleMusicMusicVideoInterface(base=base_interface)
        uv_interface = AppleMusicUploadedVideoInterface(base=base_interface)

        apple_music_interface = AppleMusicInterface(
            song=song_interface,
            music_video=mv_interface,
            uploaded_video=uv_interface,
        )

        s3_client = get_s3_client()
        logger.info("R2 client initialized")

        # Configure CORS on R2 bucket to allow frontend downloads
        try:
            s3_client.put_bucket_cors(
                Bucket=R2_BUCKET_NAME,
                CORSConfiguration={
                    "CORSRules": [
                        {
                            "AllowedOrigins": ["*"],
                            "AllowedMethods": ["GET", "HEAD"],
                            "AllowedHeaders": ["*"],
                            "MaxAgeSeconds": 86400,
                        }
                    ]
                },
            )
            logger.info("R2 CORS configured successfully")
        except Exception as e:
            logger.warning(f"Failed to configure R2 CORS (may need manual config): {e}")

        os.makedirs(TEMP_DIR, exist_ok=True)
        logger.info("Apple Music API ready")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_gamdl()
    yield
    # Cleanup temp dir on shutdown
    if os.path.exists(TEMP_DIR):
        shutil.rmtree(TEMP_DIR, ignore_errors=True)


app = FastAPI(title="Apple Music Sidecar", lifespan=lifespan)


# ── Endpoints ──


@app.get("/health")
async def health():
    if apple_music_api is None:
        raise HTTPException(status_code=503, detail="Not initialized")
    return {
        "status": "ok",
        "subscription": apple_music_api.active_subscription,
        "storefront": apple_music_api.storefront,
        "wrapper_active": _wrapper_connected,
        "lossless_available": _wrapper_connected,
        "codec": "alac" if _wrapper_connected else "aac-legacy",
    }


@app.get("/check-ip")
async def check_ip():
    """Check what IP is being used for outbound requests (verifies WARP proxy)."""
    import httpx
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get("https://cloudflare.com/cdn-cgi/trace")
            lines = resp.text.strip().split("\n")
            info = {k: v for k, v in (line.split("=", 1) for line in lines if "=" in line)}
            return {
                "ip": info.get("ip", "unknown"),
                "warp": info.get("warp", "unknown"),
                "proxy_configured": bool(SOCKS5_PROXY),
                "proxy_url": _proxy_url if SOCKS5_PROXY else None,
            }
    except Exception as e:
        return {"error": str(e), "proxy_configured": bool(SOCKS5_PROXY)}


@app.get("/search")
async def search(
    term: str = Query(..., min_length=1),
    limit: int = Query(10, ge=1, le=50),
    types: str = Query("songs"),
):
    """Search Apple Music. Returns raw Apple Music API results."""
    if apple_music_api is None:
        raise HTTPException(status_code=503, detail="Not initialized")

    try:
        results = await apple_music_api.get_search_results(
            term=term,
            types=types,
            limit=limit,
        )
        return results
    except Exception as e:
        logger.error(f"Search failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/lookup-isrc")
async def lookup_isrc(
    isrc: str = Query(..., min_length=5),
):
    """Look up a song by ISRC code via Apple Music catalog filter."""
    if apple_music_api is None:
        raise HTTPException(status_code=503, detail="Not initialized")

    try:
        storefront = apple_music_api.storefront
        url = f"https://amp-api.music.apple.com/v1/catalog/{storefront}/songs"
        params = {"filter[isrc]": isrc}
        response = await apple_music_api.client.get(url, params=params)
        response.raise_for_status()
        data = response.json()
        # Wrap in search-like format for consistency
        songs = data.get("data", [])
        logger.info(f"ISRC lookup '{isrc}': {len(songs)} results")
        return {"results": {"songs": {"data": songs}}} if songs else {"results": {}}
    except Exception as e:
        logger.error(f"ISRC lookup failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/download/{song_id}")
async def download_track(song_id: str):
    """
    Download, decrypt, and upload a track to R2.
    Returns the public R2 URL.

    Flow:
    1. Check R2 cache — if exists, return URL immediately
    2. Download HLS + decrypt via gamdl
    3. Upload to R2
    4. Return public URL
    """
    if apple_music_api is None or apple_music_interface is None:
        raise HTTPException(status_code=503, detail="Not initialized")

    r2_key = f"apple/{song_id}.m4a"

    # 1. Check R2 cache
    if r2_object_exists(r2_key):
        url = f"{R2_PUBLIC_URL}/{r2_key}"
        logger.info(f"R2 cache hit: {song_id}")
        return {"url": url, "cached": True}

    # 2. Download + decrypt
    logger.info(f"R2 cache miss, downloading: {song_id}")
    work_dir = os.path.join(TEMP_DIR, song_id)
    os.makedirs(work_dir, exist_ok=True)

    try:
        # Create downloader targeting work_dir
        base_dl = AppleMusicBaseDownloader(
            interface=apple_music_interface,
            output_path=work_dir,
            temp_path=work_dir,
            **({"wrapper_decrypt_ip": f"{WRAPPER_HOST}:{WRAPPER_DECRYPT_PORT}"} if _wrapper_connected else {}),
        )
        song_dl = AppleMusicSongDownloader(base=base_dl)
        mv_dl = AppleMusicMusicVideoDownloader(base=base_dl)
        uv_dl = AppleMusicUploadedVideoDownloader(base=base_dl)

        downloader = AppleMusicDownloader(
            song=song_dl,
            music_video=mv_dl,
            uploaded_video=uv_dl,
            overwrite=True,
            skip_cleanup=True,
        )

        # Get the real Apple Music URL from catalog data
        catalog_data = await apple_music_api.get_song(song_id)
        song_url = catalog_data["data"][0]["attributes"]["url"]
        logger.info(f"Resolved song URL: {song_url}")

        downloaded_path = None
        item_count = 0
        async for download_item in downloader.get_download_item_from_url(song_url):
            item_count += 1
            has_error = download_item.media.error if hasattr(download_item.media, 'error') else None
            is_partial = download_item.media.partial if hasattr(download_item.media, 'partial') else None
            logger.info(f"Download item #{item_count}: partial={is_partial}, error={has_error}, "
                        f"final_path={download_item.final_path}, staged_path={download_item.staged_path}")

            if has_error:
                logger.error(f"Media error: {has_error}")
                continue

            if is_partial:
                logger.warning(f"Media is partial (incomplete stream info), skipping")
                continue

            await downloader.download(download_item)
            if download_item.final_path and os.path.exists(download_item.final_path):
                downloaded_path = str(download_item.final_path)
                logger.info(f"Downloaded to final_path: {downloaded_path}")
            break

        if not downloaded_path:
            logger.info(f"Items yielded: {item_count}. Searching work_dir recursively for .m4a...")
            for f in Path(work_dir).rglob("*.m4a"):
                downloaded_path = str(f)
                logger.info(f"Found .m4a: {downloaded_path}")
                break

        if not downloaded_path or not os.path.exists(downloaded_path):
            all_files = list(Path(work_dir).rglob("*"))
            logger.error(f"No .m4a found after {item_count} items. All files in work_dir: {all_files}")
            raise HTTPException(status_code=404, detail=f"Track {song_id} not downloaded. Items yielded: {item_count}")

        # 3. Upload to R2
        url = r2_upload_file(downloaded_path, r2_key)
        logger.info(f"Uploaded to R2: {r2_key} ({os.path.getsize(downloaded_path)} bytes)")

        return {"url": url, "cached": False}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Download failed for {song_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        # Cleanup work_dir
        shutil.rmtree(work_dir, ignore_errors=True)


@app.get("/track-info/{song_id}")
async def track_info(song_id: str):
    """Get track metadata from Apple Music catalog."""
    if apple_music_api is None:
        raise HTTPException(status_code=503, detail="Not initialized")

    try:
        catalog_data = await apple_music_api.get_song(song_id)
        if not catalog_data:
            raise HTTPException(status_code=404, detail=f"Track {song_id} not found")
        return catalog_data
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Track info failed for {song_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))
