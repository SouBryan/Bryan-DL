"""
Apple Music Sidecar — FastAPI service
Internal service called by the Next.js app. Not exposed publicly.
Provides: search, download+decrypt+upload to R2, health check.
Supports multiple accounts/storefronts for multi-country coverage.
"""

import asyncio
import json
import os
import tempfile
import shutil
import logging
import functools
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import boto3
from botocore.exceptions import ClientError
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse

from auth import refresh_cookies_sync, cookies_json_to_netscape

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

# Suppress verbose third-party loggers
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("gamdl").setLevel(logging.WARNING)
logging.getLogger("uvicorn.access").setLevel(logging.CRITICAL)  # replaced by middleware below

# Suppress structlog debug output from gamdl internals
try:
    import structlog
    structlog.configure(wrapper_class=structlog.make_filtering_bound_logger(logging.INFO))
except Exception:
    pass

# ── Config ──

COOKIES_DIR = os.environ.get("APPLE_MUSIC_COOKIES_DIR", "/app/cookies")
COOKIES_PATH = os.environ.get("APPLE_MUSIC_COOKIES_PATH", os.path.join(COOKIES_DIR, "cookies.txt"))
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

# Cookie auto-refresh config (single account — backward compat)
APPLE_MUSIC_EMAIL = os.environ.get("APPLE_MUSIC_EMAIL", "")
APPLE_MUSIC_PASSWORD = os.environ.get("APPLE_MUSIC_PASSWORD", "")
COOKIE_REFRESH_INTERVAL_H = int(os.environ.get("APPLE_MUSIC_COOKIE_REFRESH_HOURS", "12"))

# Multi-account config: JSON array of {email, password, storefront}
# Example: [{"email":"a@b.com","password":"x","storefront":"us"},{"email":"c@d.com","password":"y","storefront":"jp"}]
# Falls back to single APPLE_MUSIC_EMAIL/PASSWORD if not set
APPLE_MUSIC_ACCOUNTS_RAW = os.environ.get("APPLE_MUSIC_ACCOUNTS", "")

# Rate limiting config
REQUEST_DELAY_MS = int(os.environ.get("APPLE_MUSIC_REQUEST_DELAY_MS", "500"))
MAX_RETRIES_429 = int(os.environ.get("APPLE_MUSIC_MAX_RETRIES_429", "5"))
MAX_CONCURRENT_DOWNLOADS = int(os.environ.get("APPLE_MUSIC_MAX_CONCURRENT_DOWNLOADS", "2"))


def _parse_accounts_config() -> list[dict]:
    """Parse multi-account config. Returns list of {email, password, storefront}."""
    if APPLE_MUSIC_ACCOUNTS_RAW:
        try:
            accounts = json.loads(APPLE_MUSIC_ACCOUNTS_RAW)
            if isinstance(accounts, list) and len(accounts) > 0:
                for acc in accounts:
                    if not acc.get("email") or not acc.get("password") or not acc.get("storefront"):
                        raise ValueError(f"Each account must have email, password, storefront. Got: {acc}")
                logger.info(f"Parsed {len(accounts)} accounts from APPLE_MUSIC_ACCOUNTS")
                return accounts
        except json.JSONDecodeError as e:
            logger.error(f"Invalid APPLE_MUSIC_ACCOUNTS JSON: {e}")
    # Fallback: single account from legacy env vars
    if APPLE_MUSIC_EMAIL and APPLE_MUSIC_PASSWORD:
        logger.info("Using single account from APPLE_MUSIC_EMAIL/PASSWORD (storefront auto-detected)")
        return [{"email": APPLE_MUSIC_EMAIL, "password": APPLE_MUSIC_PASSWORD, "storefront": "auto"}]
    return []


ACCOUNT_CONFIGS = _parse_accounts_config()
COOKIE_REFRESH_ENABLED = len(ACCOUNT_CONFIGS) > 0

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

# ── Account instance (per-storefront) ──

@dataclass
class AccountInstance:
    """Holds all state for a single Apple Music account/storefront."""
    storefront: str
    email: str
    password: str
    cookies_path: str
    api: Optional[AppleMusicApi] = None
    interface: Optional[AppleMusicInterface] = None
    uses_wrapper: bool = False
    codec: str = "aac-legacy"
    last_cookie_refresh: str = "never"
    refresh_task: Optional[asyncio.Task] = field(default=None, repr=False)


# ── Global state ──

_accounts: dict[str, AccountInstance] = {}  # keyed by storefront code
_wrapper_storefront: str | None = None  # storefront that uses the wrapper (ALAC)
s3_client = None
_init_lock = asyncio.Lock()
_last_request_time: float = 0.0  # monotonic timestamp of last API request
_download_semaphore: asyncio.Semaphore | None = None  # limits concurrent downloads


async def _throttle():
    """Enforce minimum delay between Apple Music API requests."""
    global _last_request_time
    if REQUEST_DELAY_MS <= 0:
        return
    now = asyncio.get_event_loop().time()
    elapsed_ms = (now - _last_request_time) * 1000
    if elapsed_ms < REQUEST_DELAY_MS:
        wait_s = (REQUEST_DELAY_MS - elapsed_ms) / 1000
        logger.debug(f"Throttle: waiting {wait_s:.2f}s")
        await asyncio.sleep(wait_s)
    _last_request_time = asyncio.get_event_loop().time()


async def _request_with_backoff(coro_factory, description: str = "request", account: AccountInstance | None = None):
    """
    Execute an async request with exponential backoff on 429/rate limit errors.
    Also triggers cookie refresh on 401 (expired auth).
    coro_factory is a callable that returns a new coroutine each time.
    """
    for attempt in range(1, MAX_RETRIES_429 + 1):
        await _throttle()
        try:
            return await coro_factory()
        except Exception as e:
            error_str = str(e).lower()
            is_rate_limit = "429" in error_str or "rate limit" in error_str or "too many" in error_str
            is_auth_error = "401" in error_str or "unauthorized" in error_str

            if is_auth_error and attempt == 1 and account and not account.uses_wrapper:
                logger.warning(f"Auth error on {description} (storefront={account.storefront}), triggering cookie refresh...")
                refreshed = await _do_cookie_refresh(account)
                if refreshed:
                    logger.info(f"Cookies refreshed for {account.storefront}, reinitializing gamdl...")
                    await _reinit_gamdl_cookies(account)
                    continue
                else:
                    raise
            elif is_rate_limit and attempt < MAX_RETRIES_429:
                backoff = min(2 ** attempt, 60)  # 2, 4, 8, 16, 32, max 60s
                logger.warning(f"Rate limited on {description} (attempt {attempt}/{MAX_RETRIES_429}), "
                               f"backing off {backoff}s...")
                await asyncio.sleep(backoff)
            else:
                raise
    raise RuntimeError(f"Exhausted {MAX_RETRIES_429} retries for {description}")


def get_s3_client():
    return boto3.client(
        "s3",
        endpoint_url=R2_ENDPOINT_URL,
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        region_name="auto",
    )


async def _do_cookie_refresh(account: AccountInstance) -> bool:
    """Run cookie refresh for a specific account. Returns True on success."""
    if not account.email or not account.password:
        return False
    try:
        proxy_url = f"socks5://{SOCKS5_PROXY}" if SOCKS5_PROXY and "://" not in SOCKS5_PROXY else SOCKS5_PROXY or None
        logger.info(f"Starting cookie refresh for {account.email} (storefront={account.storefront})...")
        loop = asyncio.get_event_loop()
        cookies = await loop.run_in_executor(
            None,
            functools.partial(refresh_cookies_sync, account.email, account.password, proxy_url),
        )
        cookies_json_to_netscape(cookies, account.cookies_path)
        account.last_cookie_refresh = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        logger.info(f"Cookie refresh succeeded for {account.storefront} — {len(cookies)} cookies written to {account.cookies_path}")
        return True
    except Exception as e:
        logger.error(f"Cookie refresh failed for {account.storefront}: {e}", exc_info=True)
        return False


async def _reinit_gamdl_cookies(account: AccountInstance):
    """Reinitialize gamdl API from refreshed cookies for a specific account."""
    try:
        account.api = await AppleMusicApi.create_from_netscape_cookies(account.cookies_path)
        logger.info(f"gamdl reinitialized for {account.storefront} — Subscription: {account.api.active_subscription}")

        # Update storefront if it was auto-detected
        if account.storefront == "auto":
            account.storefront = account.api.storefront
            # Re-register under correct key
            _accounts[account.api.storefront] = account
            logger.info(f"Auto-detected storefront: {account.api.storefront}")

        base_interface = await AppleMusicBaseInterface.create(apple_music_api=account.api)
        song_interface = AppleMusicSongInterface(
            base=base_interface,
            codec_priority=[SongCodec.AAC_LEGACY],
        )
        account.interface = AppleMusicInterface(
            song=song_interface,
            music_video=AppleMusicMusicVideoInterface(base=base_interface),
            uploaded_video=AppleMusicUploadedVideoInterface(base=base_interface),
        )
    except Exception as e:
        logger.error(f"gamdl reinit failed for {account.storefront}: {e}", exc_info=True)


async def _cookie_refresh_loop(account: AccountInstance):
    """Background task: refresh cookies periodically for a specific account."""
    interval_s = COOKIE_REFRESH_INTERVAL_H * 3600
    logger.info(f"Cookie refresh loop started for {account.storefront} (every {COOKIE_REFRESH_INTERVAL_H}h)")
    while True:
        await asyncio.sleep(interval_s)
        logger.info(f"Scheduled cookie refresh for {account.storefront}")
        await _do_cookie_refresh(account)


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


def _get_account(storefront: str | None = None) -> AccountInstance:
    """Get an account instance by storefront, or the first available one."""
    if not _accounts:
        raise HTTPException(status_code=503, detail="No accounts initialized")
    if storefront and storefront in _accounts:
        return _accounts[storefront]
    if storefront:
        raise HTTPException(status_code=404, detail=f"Storefront '{storefront}' not configured. Available: {list(_accounts.keys())}")
    # Return first account (wrapper account preferred if available)
    if _wrapper_storefront and _wrapper_storefront in _accounts:
        return _accounts[_wrapper_storefront]
    return next(iter(_accounts.values()))


async def _init_account_from_cookies(acc_config: dict) -> AccountInstance:
    """Initialize a single account from cookies."""
    storefront = acc_config["storefront"]
    cookies_path = os.path.join(COOKIES_DIR, f"cookies_{storefront}.txt") if storefront != "auto" else COOKIES_PATH

    account = AccountInstance(
        storefront=storefront,
        email=acc_config["email"],
        password=acc_config["password"],
        cookies_path=cookies_path,
    )

    # If cookies file doesn't exist yet, do initial refresh
    if not os.path.exists(cookies_path):
        logger.info(f"No cookies file for {storefront}, performing initial cookie refresh...")
        success = await _do_cookie_refresh(account)
        if not success:
            logger.error(f"Initial cookie refresh failed for {storefront} — skipping this account")
            return account

    try:
        account.api = await AppleMusicApi.create_from_netscape_cookies(cookies_path)
        actual_storefront = account.api.storefront
        logger.info(f"Account initialized: {acc_config['email']} → storefront={actual_storefront}, "
                     f"subscription={account.api.active_subscription}")

        # Update storefront if auto-detected
        if storefront == "auto":
            account.storefront = actual_storefront

        base_interface = await AppleMusicBaseInterface.create(apple_music_api=account.api)
        song_interface = AppleMusicSongInterface(
            base=base_interface,
            codec_priority=[SongCodec.AAC_LEGACY],
        )
        account.interface = AppleMusicInterface(
            song=song_interface,
            music_video=AppleMusicMusicVideoInterface(base=base_interface),
            uploaded_video=AppleMusicUploadedVideoInterface(base=base_interface),
        )
        account.codec = "aac-legacy"
    except Exception as e:
        logger.error(f"Failed to init account {acc_config['email']}: {e}", exc_info=True)

    return account


async def init_gamdl():
    """Initialize gamdl API instances (wrapper + cookie accounts)."""
    global s3_client, _wrapper_storefront

    async with _init_lock:
        if _accounts:
            return

        # 1. Try wrapper first (single ALAC account)
        if USE_WRAPPER:
            wrapper_account_url = f"http://{WRAPPER_HOST}:{WRAPPER_ACCOUNT_PORT}/"
            logger.info(f"Initializing wrapper account at {wrapper_account_url}")

            max_retries = 5
            for attempt in range(1, max_retries + 1):
                try:
                    api = await AppleMusicApi.create_from_wrapper(wrapper_account_url=wrapper_account_url)
                    storefront = api.storefront
                    logger.info(f"Wrapper connected! storefront={storefront}, subscription={api.active_subscription}")

                    base_interface = await AppleMusicBaseInterface.create(
                        apple_music_api=api,
                        use_wrapper=True,
                        wrapper_m3u8_ip=f"{WRAPPER_HOST}:{WRAPPER_M3U8_PORT}",
                    )
                    song_interface = AppleMusicSongInterface(
                        base=base_interface,
                        codec_priority=[SongCodec.ALAC, SongCodec.AAC_LEGACY],
                    )
                    interface = AppleMusicInterface(
                        song=song_interface,
                        music_video=AppleMusicMusicVideoInterface(base=base_interface),
                        uploaded_video=AppleMusicUploadedVideoInterface(base=base_interface),
                    )

                    wrapper_account = AccountInstance(
                        storefront=storefront,
                        email="(wrapper)",
                        password="",
                        cookies_path="",
                        api=api,
                        interface=interface,
                        uses_wrapper=True,
                        codec="alac",
                    )
                    _accounts[storefront] = wrapper_account
                    _wrapper_storefront = storefront
                    logger.info(f"Wrapper account registered as storefront={storefront} (ALAC)")
                    break
                except Exception as e:
                    if attempt < max_retries:
                        logger.warning(f"Wrapper attempt {attempt}/{max_retries} failed ({e}), retrying in 5s...")
                        await asyncio.sleep(5)
                    else:
                        logger.error(f"Wrapper failed after {max_retries} attempts: {e}")

        # 2. Initialize cookie-based accounts (AAC)
        if ACCOUNT_CONFIGS:
            os.makedirs(COOKIES_DIR, exist_ok=True)
            for acc_config in ACCOUNT_CONFIGS:
                sf = acc_config["storefront"]
                # Skip if wrapper already covers this storefront
                if sf in _accounts and sf != "auto":
                    logger.info(f"Storefront {sf} already covered by wrapper, skipping cookie account")
                    continue

                account = await _init_account_from_cookies(acc_config)
                if account.api is not None:
                    actual_sf = account.storefront
                    # Don't overwrite wrapper account
                    if actual_sf in _accounts and _accounts[actual_sf].uses_wrapper:
                        logger.info(f"Storefront {actual_sf} covered by wrapper, cookie account available as fallback")
                        _accounts[f"{actual_sf}-cookies"] = account
                    else:
                        _accounts[actual_sf] = account
        elif not _accounts:
            # No accounts configured and no wrapper — try legacy single cookies file
            if os.path.exists(COOKIES_PATH):
                logger.info(f"No accounts configured, trying legacy cookies from {COOKIES_PATH}")
                api = await AppleMusicApi.create_from_netscape_cookies(COOKIES_PATH)
                sf = api.storefront
                base_interface = await AppleMusicBaseInterface.create(apple_music_api=api)
                song_interface = AppleMusicSongInterface(
                    base=base_interface,
                    codec_priority=[SongCodec.AAC_LEGACY],
                )
                interface = AppleMusicInterface(
                    song=song_interface,
                    music_video=AppleMusicMusicVideoInterface(base=base_interface),
                    uploaded_video=AppleMusicUploadedVideoInterface(base=base_interface),
                )
                _accounts[sf] = AccountInstance(
                    storefront=sf, email="", password="",
                    cookies_path=COOKIES_PATH, api=api, interface=interface,
                )

        if not _accounts:
            logger.error("No Apple Music accounts initialized!")
            raise RuntimeError("No Apple Music accounts available")

        logger.info(f"Initialized {len(_accounts)} account(s): {list(_accounts.keys())}")

        # R2 client
        s3_client = get_s3_client()
        logger.info("R2 client initialized")

        try:
            s3_client.put_bucket_cors(
                Bucket=R2_BUCKET_NAME,
                CORSConfiguration={
                    "CORSRules": [{
                        "AllowedOrigins": ["*"],
                        "AllowedMethods": ["GET", "HEAD"],
                        "AllowedHeaders": ["*"],
                        "MaxAgeSeconds": 86400,
                    }]
                },
            )
        except Exception as e:
            logger.warning(f"R2 CORS config failed: {e}")

        os.makedirs(TEMP_DIR, exist_ok=True)

        global _download_semaphore
        _download_semaphore = asyncio.Semaphore(MAX_CONCURRENT_DOWNLOADS)
        logger.info(f"Rate limiting: {REQUEST_DELAY_MS}ms delay, {MAX_RETRIES_429} retries, "
                    f"{MAX_CONCURRENT_DOWNLOADS} max concurrent downloads")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_gamdl()
    # Start background cookie refresh for each cookie-based account
    for account in _accounts.values():
        if account.email and account.password and not account.uses_wrapper:
            account.refresh_task = asyncio.create_task(_cookie_refresh_loop(account))
            logger.info(f"Cookie auto-refresh started for {account.storefront}")
    if not any(a.email and a.password for a in _accounts.values()):
        logger.info("Cookie auto-refresh disabled (no credentials configured)")
    yield
    # Cleanup
    for account in _accounts.values():
        if account.refresh_task:
            account.refresh_task.cancel()
    if os.path.exists(TEMP_DIR):
        shutil.rmtree(TEMP_DIR, ignore_errors=True)


app = FastAPI(title="Apple Music Sidecar", lifespan=lifespan)


@app.middleware("http")
async def access_log_middleware(request, call_next):
    start = datetime.now(timezone.utc)
    response = await call_next(request)
    elapsed_ms = int((datetime.now(timezone.utc) - start).total_seconds() * 1000)
    client_ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "-").split(",")[0].strip()
    ts = start.strftime("%d/%m %H:%M:%S")
    logger.info(f"{client_ip} | {ts} | {request.method} {request.url.path} → {response.status_code} ({elapsed_ms}ms)")
    return response


# ── Endpoints ──


@app.get("/health")
async def health():
    if not _accounts:
        raise HTTPException(status_code=503, detail="Not initialized")
    accounts_info = []
    for sf, acc in _accounts.items():
        accounts_info.append({
            "storefront": acc.storefront,
            "key": sf,
            "subscription": acc.api.active_subscription if acc.api else False,
            "uses_wrapper": acc.uses_wrapper,
            "codec": acc.codec,
            "last_cookie_refresh": acc.last_cookie_refresh,
            "has_credentials": bool(acc.email and acc.password),
        })
    primary = _get_account()
    return {
        "status": "ok",
        "accounts": accounts_info,
        "storefronts": [a["storefront"] for a in accounts_info],
        "primary_storefront": primary.storefront,
        "wrapper_storefront": _wrapper_storefront,
        "cookie_refresh_interval_hours": COOKIE_REFRESH_INTERVAL_H,
    }


@app.get("/storefronts")
async def list_storefronts():
    """List all available storefronts."""
    if not _accounts:
        raise HTTPException(status_code=503, detail="Not initialized")
    return {
        "storefronts": [
            {
                "code": acc.storefront,
                "codec": acc.codec,
                "uses_wrapper": acc.uses_wrapper,
            }
            for acc in _accounts.values()
        ]
    }


@app.post("/refresh-cookies")
async def refresh_cookies_endpoint(
    storefront: str | None = Query(None, description="Specific storefront to refresh, or all if omitted"),
):
    """Manually trigger a cookie refresh for one or all accounts."""
    targets = []
    if storefront:
        acc = _accounts.get(storefront)
        if not acc:
            raise HTTPException(status_code=404, detail=f"Storefront '{storefront}' not found")
        targets = [acc]
    else:
        targets = [a for a in _accounts.values() if a.email and a.password and not a.uses_wrapper]

    if not targets:
        raise HTTPException(status_code=400, detail="No cookie-based accounts with credentials found")

    results = {}
    for acc in targets:
        success = await _do_cookie_refresh(acc)
        if success and not acc.uses_wrapper:
            await _reinit_gamdl_cookies(acc)
        results[acc.storefront] = {"success": success, "last_refresh": acc.last_cookie_refresh}

    all_ok = all(r["success"] for r in results.values())
    if not all_ok:
        return JSONResponse(status_code=207, content={"results": results})
    return {"status": "ok", "results": results}


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


@app.get("/album/{album_id}")
async def get_album(
    album_id: str,
    storefront: str | None = Query(None),
):
    """Get album details with tracks from Apple Music catalog."""
    if not _accounts:
        raise HTTPException(status_code=503, detail="Not initialized")
    try:
        account = _get_account(storefront)
        result = await _request_with_backoff(
            lambda: account.api.get_album(album_id),
            description=f"get_album '{album_id}'",
            account=account,
        )
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"get_album failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/artist/{artist_id}")
async def get_artist(
    artist_id: str,
    storefront: str | None = Query(None),
):
    """Get artist details with albums from Apple Music catalog."""
    if not _accounts:
        raise HTTPException(status_code=503, detail="Not initialized")
    try:
        account = _get_account(storefront)
        result = await _request_with_backoff(
            lambda: account.api.get_artist(
                artist_id,
                include="albums",
                views="full-albums,singles",
                limit=100,
            ),
            description=f"get_artist '{artist_id}'",
            account=account,
        )
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"get_artist failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/search")
async def search(
    term: str = Query(..., min_length=1),
    limit: int = Query(10, ge=1, le=50),
    types: str = Query("songs"),
    storefront: str | None = Query(None, description="Search specific storefront, or all if omitted"),
):
    """Search Apple Music. Can search a specific storefront or all configured ones."""
    if not _accounts:
        raise HTTPException(status_code=503, detail="Not initialized")

    try:
        if storefront:
            # Search specific storefront
            account = _get_account(storefront)
            results = await _request_with_backoff(
                lambda: account.api.get_search_results(term=term, types=types, limit=limit),
                description=f"search '{term}' on {storefront}",
                account=account,
            )
            # Tag results with storefront
            _tag_results_with_storefront(results, account.storefront)
            return results
        else:
            # Search all storefronts, merge results
            all_songs = []
            all_albums = []
            all_artists = []
            seen_isrcs = set()
            seen_album_ids = set()
            seen_artist_ids = set()
            for sf, account in _accounts.items():
                if account.api is None:
                    continue
                try:
                    results = await _request_with_backoff(
                        lambda a=account: a.api.get_search_results(term=term, types=types, limit=limit),
                        description=f"search '{term}' on {sf}",
                        account=account,
                    )
                    songs = results.get("results", {}).get("songs", {}).get("data", [])
                    for song in songs:
                        isrc = song.get("attributes", {}).get("isrc", "")
                        song["_storefront"] = account.storefront
                        if isrc and isrc in seen_isrcs:
                            continue  # deduplicate by ISRC across storefronts
                        if isrc:
                            seen_isrcs.add(isrc)
                        all_songs.append(song)
                    albums = results.get("results", {}).get("albums", {}).get("data", [])
                    for album in albums:
                        album_id = album.get("id", "")
                        album["_storefront"] = account.storefront
                        if album_id in seen_album_ids:
                            continue
                        seen_album_ids.add(album_id)
                        all_albums.append(album)
                    artists = results.get("results", {}).get("artists", {}).get("data", [])
                    for artist in artists:
                        artist_id = artist.get("id", "")
                        artist["_storefront"] = account.storefront
                        if artist_id in seen_artist_ids:
                            continue
                        seen_artist_ids.add(artist_id)
                        all_artists.append(artist)
                except Exception as e:
                    logger.warning(f"Search on {sf} failed: {e}")

            # Return merged results in standard format
            merged: dict = {"results": {}}
            if all_songs:
                merged["results"]["songs"] = {"data": all_songs[:limit]}
            if all_albums:
                merged["results"]["albums"] = {"data": all_albums[:limit]}
            if all_artists:
                merged["results"]["artists"] = {"data": all_artists[:limit]}
            return merged
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Search failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


def _tag_results_with_storefront(results: dict, storefront: str):
    """Add _storefront field to each item in results (songs, albums, artists)."""
    for item_type in ("songs", "albums", "artists"):
        items = results.get("results", {}).get(item_type, {}).get("data", [])
        for item in items:
            item["_storefront"] = storefront


@app.get("/lookup-isrc")
async def lookup_isrc(
    isrc: str = Query(..., min_length=5),
    storefront: str | None = Query(None),
):
    """Look up a song by ISRC code. Searches specific storefront or all."""
    if not _accounts:
        raise HTTPException(status_code=503, detail="Not initialized")

    async def _do_isrc_lookup(account: AccountInstance):
        sf = account.api.storefront
        url = f"https://amp-api.music.apple.com/v1/catalog/{sf}/songs"
        params = {"filter[isrc]": isrc}
        resp = await account.api.client.get(url, params=params)
        resp.raise_for_status()
        return resp.json()

    try:
        if storefront:
            account = _get_account(storefront)
            data = await _request_with_backoff(
                lambda: _do_isrc_lookup(account),
                description=f"ISRC lookup '{isrc}' on {storefront}",
                account=account,
            )
            songs = data.get("data", [])
            for s in songs:
                s["_storefront"] = account.storefront
            return {"results": {"songs": {"data": songs}}} if songs else {"results": {}}
        else:
            # Try all storefronts until we find a match
            for sf, account in _accounts.items():
                if account.api is None:
                    continue
                try:
                    data = await _request_with_backoff(
                        lambda a=account: _do_isrc_lookup(a),
                        description=f"ISRC lookup '{isrc}' on {sf}",
                        account=account,
                    )
                    songs = data.get("data", [])
                    if songs:
                        for s in songs:
                            s["_storefront"] = account.storefront
                        logger.info(f"ISRC lookup '{isrc}': found in {sf}")
                        return {"results": {"songs": {"data": songs}}}
                except Exception as e:
                    logger.warning(f"ISRC lookup on {sf} failed: {e}")
            return {"results": {}}
    except Exception as e:
        logger.error(f"ISRC lookup failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/download/{song_id}")
async def download_track(
    song_id: str,
    storefront: str | None = Query(None, description="Which storefront account to use for download"),
    codec: str = Query("alac", description="Requested codec: 'alac' for lossless, 'aac' for 256kbps AAC"),
):
    """
    Download, decrypt, and upload a track to R2.
    Returns the public R2 URL.

    Flow:
    1. Check R2 cache — if exists, return URL immediately
    2. Select account (by storefront param, or try all)
    3. Download HLS + decrypt via gamdl
    4. Upload to R2
    5. Return public URL
    """
    if not _accounts:
        raise HTTPException(status_code=503, detail="Not initialized")

    # Normalize codec value
    codec = codec.lower()
    if codec not in ("alac", "aac"):
        codec = "alac"

    # R2 key: ALAC uses legacy key for backward compat; AAC gets its own key
    r2_suffix = "" if codec == "alac" else "_aac"
    r2_key = f"apple/{song_id}{r2_suffix}.m4a"

    # 1. Check R2 cache
    if r2_object_exists(r2_key):
        url = f"{R2_PUBLIC_URL}/{r2_key}"
        logger.info(f"R2 cache hit: {song_id} ({codec})")
        return {"url": url, "cached": True}

    # 2. Select account
    account = _get_account(storefront)

    # Fall back to AAC if ALAC requested but account has no wrapper
    if codec == "alac" and not account.uses_wrapper:
        logger.warning(f"ALAC requested but account '{account.storefront}' has no wrapper — falling back to AAC")
        codec = "aac"
        r2_key = f"apple/{song_id}_aac.m4a"
        # Re-check cache for AAC key
        if r2_object_exists(r2_key):
            url = f"{R2_PUBLIC_URL}/{r2_key}"
            logger.info(f"R2 cache hit (AAC fallback): {song_id}")
            return {"url": url, "cached": True}

    # 3. Download + decrypt (with concurrency limiter)
    logger.info(f"R2 cache miss, downloading: {song_id} via {account.storefront} (codec={codec})")
    if _download_semaphore is None:
        raise HTTPException(status_code=503, detail="Not initialized")

    async with _download_semaphore:
        work_dir = os.path.join(TEMP_DIR, song_id)
        os.makedirs(work_dir, exist_ok=True)

        try:
            # Build per-request interface with the requested codec_priority
            codec_priority = [SongCodec.ALAC] if codec == "alac" else [SongCodec.AAC_LEGACY]
            song_interface = AppleMusicSongInterface(
                base=account.interface.song.base,
                codec_priority=codec_priority,
            )
            request_interface = AppleMusicInterface(
                song=song_interface,
                music_video=account.interface.music_video,
                uploaded_video=account.interface.uploaded_video,
            )

            # Create downloader targeting work_dir
            base_dl = AppleMusicBaseDownloader(
                interface=request_interface,
                output_path=work_dir,
                temp_path=work_dir,
                **({"wrapper_decrypt_ip": f"{WRAPPER_HOST}:{WRAPPER_DECRYPT_PORT}"} if account.uses_wrapper else {}),
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
            catalog_data = await _request_with_backoff(
                lambda: account.api.get_song(song_id),
                description=f"get_song {song_id}",
                account=account,
            )
            song_url = catalog_data["data"][0]["attributes"]["url"]
            logger.info(f"Resolved song URL: {song_url}")

            downloaded_path = None
            item_count = 0
            last_error = None

            async def _do_download():
                nonlocal downloaded_path, item_count, last_error
                async for download_item in downloader.get_download_item_from_url(song_url):
                    item_count += 1
                    has_error = download_item.media.error if hasattr(download_item.media, 'error') else None
                    is_partial = download_item.media.partial if hasattr(download_item.media, 'partial') else None
                    logger.info(
                        f"Download item #{item_count}: partial={is_partial}, "
                        f"error={type(has_error).__name__ + ': ' + str(has_error) if has_error else None}, "
                        f"final_path={download_item.final_path}"
                    )

                    # Item #1: partial=True — gamdl yields this immediately with catalog metadata only.
                    # Stream info (M3U8, fairplay key) is NOT ready yet. Skip and wait for item #2.
                    if is_partial:
                        logger.info(f"Item #{item_count} is partial (pre-stream-info), waiting for next item...")
                        continue

                    # Item with error — log and skip (loop will end naturally if no more items)
                    if has_error:
                        last_error = has_error
                        logger.error(
                            f"Item #{item_count} has error: {type(has_error).__name__}: {has_error}",
                            exc_info=has_error,
                        )
                        continue

                    # Item #2: partial=False, no error — this has full stream info; do the actual download
                    await downloader.download(download_item)
                    if download_item.final_path and os.path.exists(download_item.final_path):
                        downloaded_path = str(download_item.final_path)
                        logger.info(f"Downloaded to final_path: {downloaded_path}")
                    else:
                        logger.warning(f"download() returned but final_path missing: {download_item.final_path}")
                    break

            try:
                await asyncio.wait_for(_do_download(), timeout=120)
            except asyncio.TimeoutError:
                logger.error(f"Download timed out after 120s for {song_id} (wrapper M3U8/decrypt may be hanging)")
                raise HTTPException(status_code=504, detail=f"Download timed out for track {song_id}")

            if not downloaded_path:
                logger.info(f"Items yielded: {item_count}. Searching work_dir recursively for .m4a...")
                for f in Path(work_dir).rglob("*.m4a"):
                    downloaded_path = str(f)
                    logger.info(f"Found .m4a: {downloaded_path}")
                    break

            if not downloaded_path or not os.path.exists(downloaded_path):
                all_files = list(Path(work_dir).rglob("*"))
                logger.error(f"No .m4a found after {item_count} items. All files in work_dir: {all_files}")
                # Return specific error messages based on the last error
                if last_error:
                    err_name = type(last_error).__name__
                    err_str = str(last_error)
                    if "DecryptionNotAvailable" in err_name:
                        raise HTTPException(status_code=403, detail=f"Decryption not available for track {song_id}. The Apple Music account may not have an active subscription.")
                    elif "explicit" in err_str.lower() or "m-allowed" in err_str.lower():
                        raise HTTPException(status_code=403, detail=f"Track {song_id} is blocked by explicit content restrictions on the Apple Music account.")
                    else:
                        raise HTTPException(status_code=500, detail=f"Download failed for track {song_id}: {err_name}: {err_str}")
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
async def track_info(
    song_id: str,
    storefront: str | None = Query(None),
):
    """Get track metadata from Apple Music catalog."""
    if not _accounts:
        raise HTTPException(status_code=503, detail="Not initialized")

    account = _get_account(storefront)

    try:
        catalog_data = await _request_with_backoff(
            lambda: account.api.get_song(song_id),
            description=f"track-info {song_id}",
            account=account,
        )
        if not catalog_data:
            raise HTTPException(status_code=404, detail=f"Track {song_id} not found")
        return catalog_data
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Track info failed for {song_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))
