import base64
import hashlib
import json
import logging
import re
import secrets
import string
import time
import uuid
import requests
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urljoin, urlparse
from bs4 import BeautifulSoup

logging.basicConfig(level=logging.INFO, format="%(name)s - %(levelname)s - %(message)s")
log = logging.getLogger("applemusic_web_login")

EMAIL = "sneak-easel-duller@duck.com"
PASS = "%UyKg7Zi3if#"

BASE_DIR = Path(__file__).resolve().parent
APPLE_COOKIES_PATH = BASE_DIR / "applemusic_auth_cookies.json"

MUSIC_HOME_URL = "https://music.apple.com/us/home"
MUSIC_ROOT_URL = "https://music.apple.com/"
APPLE_WIDGET_KEY = "06f8d74b71c73757a2f82158d5e948ae7bae11ec45fda9a58690f55e35945c51"
APPLE_REDIRECT_URI = "https://music.apple.com"
APPLE_LANGUAGE = "en_us"
APPLE_STOREFRONT = "143441-1,8"
APPLE_OFFERS_STOREFRONT = "143441-15,8"
APPLE_OAUTH_CLIENT_TYPE = "firstPartyAuth"
APPLE_OAUTH_RESPONSE_MODE = "web_message"
APPLE_OAUTH_RESPONSE_TYPE = "code"

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/147.0.0.0 Safari/537.36 Edg/147.0.0.0"
)
SEC_CH_UA = '"Microsoft Edge";v="147", "Not.A/Brand";v="8", "Chromium";v="147"'
SEC_CH_UA_PLATFORM = '"Windows"'
SEC_CH_UA_MOBILE = "?0"

NAVIGATOR_PRODUCT_VERSION = "2616.2.0-external"

APPLE_IFD_CLIENT_INFO = json.dumps(
    {
        "U": USER_AGENT,
        "L": "en-US",
        "Z": "GMT-05:00",
        "V": "1.1",
        "F": "".join(
            secrets.choice(string.ascii_letters + string.digits + "._")
            for _ in range(120)
        ),
    },
    separators=(",", ":"),
)

RFC5054_2048_N_HEX = (
    "AC6BDB41324A9A9BF166DE5E1389582FAF72B6651987EE07FC3192943DB56050"
    "A37329CBB4A099ED8193E0757767A13DD52312AB4B03310DCD7F48A9DA04FD50"
    "E8083969EDB767B0CF6095179A163AB3661A05FBD5FAAAE82918A9962F0B93B8"
    "55F97993EC975EEAA80D740ADBF4FF747359D041D5C33EA71D281E446B14773B"
    "CA97B43A23FB801676BD207A436C6481F1D2B9078717461A5B9D32E688F87748"
    "544523B524B0D57D5EA77A2775D2ECFA032CFBDBF52FB3786160279004E57AE6"
    "AF874E7303CE53299CCC041C7BC308D82A5698F3A8D0C38271AE35F8E9DBFBB6"
    "94B5C803D89F7AE435DE236D525F54759B65E372FCD68EF20FA7111F9E4AFF73"
)
N_INT = int(RFC5054_2048_N_HEX, 16)
G_INT = 2
GROUP_BYTES = len(bytes.fromhex(RFC5054_2048_N_HEX))

session = requests.Session()
session.headers.update({"User-Agent": USER_AGENT})

common_html_headers = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "sec-ch-ua": SEC_CH_UA,
    "sec-ch-ua-mobile": SEC_CH_UA_MOBILE,
    "sec-ch-ua-platform": SEC_CH_UA_PLATFORM,
    "Upgrade-Insecure-Requests": "1",
}

common_js_headers = {
    "User-Agent": USER_AGENT,
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "sec-ch-ua": SEC_CH_UA,
    "sec-ch-ua-mobile": SEC_CH_UA_MOBILE,
    "sec-ch-ua-platform": SEC_CH_UA_PLATFORM,
}

log.info("Seeding baseline cookies")
for domain in (".apple.com", "music.apple.com", ".music.apple.com"):
    session.cookies.set("geo", "US", domain=domain)
    session.cookies.set("dslang", "US-EN", domain=domain)
    session.cookies.set("site", "USA", domain=domain)
    session.cookies.set("itre", "0", domain=domain)

log.info("Opening Apple Music landing page")
response_home = session.get(MUSIC_HOME_URL,
                            headers=common_html_headers,
                            timeout=30)
response_home.raise_for_status()
home_html = response_home.text
home_soup = BeautifulSoup(home_html, "html.parser")

match = re.search(r'<meta name="version" content="([^"]+)"', home_html)
if match:
    NAVIGATOR_PRODUCT_VERSION = match.group(1)

script_urls = []
for script_tag in home_soup.find_all("script", src=True):
    script_urls.append(urljoin(MUSIC_ROOT_URL, script_tag["src"]))

dev_token_match = re.search(
    r'(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)',
    home_html,
)
NAVIGATOR_DEV_TOKEN = dev_token_match.group(1) if dev_token_match else ""

for candidate in re.findall(r'https://music\.apple\.com/includes/commerce/[^"\']+', home_html):
    parsed_candidate = urlparse(candidate)
    candidate_qs = parse_qs(parsed_candidate.query)
    if candidate_qs.get("devToken"):
        NAVIGATOR_DEV_TOKEN = candidate_qs["devToken"][0]
        break

if not NAVIGATOR_DEV_TOKEN:
    log.info("Searching Apple Music scripts for web playback token")
    for script_url in script_urls:
        try:
            response_script = session.get(script_url,
                                          headers={
                                              **common_js_headers,
                                              "Referer": MUSIC_ROOT_URL,
                                              "Origin": "https://music.apple.com"
                                          },
                                          timeout=30)
            if response_script.status_code != 200:
                continue
            script_text = response_script.text
            token_match = re.search(
                r'(eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IldlYlBsYXlLaWQifQ\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)',
                script_text,
            )
            if not token_match:
                token_match = re.search(r'devToken["\']?\s*[:=]\s*["\']([^"\']+)["\']', script_text)
            if token_match:
                NAVIGATOR_DEV_TOKEN = token_match.group(1)
                break
        except requests.RequestException:
            continue

if not NAVIGATOR_DEV_TOKEN:
    log.error("Apple Music web playback token was not found")
    raise SystemExit(1)

token_parts = NAVIGATOR_DEV_TOKEN.split(".")
if len(token_parts) != 3:
    log.error("Apple Music web playback token format is invalid")
    raise SystemExit(1)

try:
    token_header = json.loads(base64.urlsafe_b64decode(token_parts[0] + "=" * (-len(token_parts[0]) % 4)).decode("utf-8"))
    token_payload = json.loads(base64.urlsafe_b64decode(token_parts[1] + "=" * (-len(token_parts[1]) % 4)).decode("utf-8"))
except Exception as exc:
    log.error("Apple Music web playback token decode failed: %s", exc)
    raise SystemExit(1)

token_iat = int(token_payload.get("iat", 0) or 0)
token_exp = int(token_payload.get("exp", 0) or 0)
token_remaining = token_exp - int(time.time())

log.info("Checking Apple Music web playback token")
if token_iat:
    log.info("Token issued: %s", datetime.fromtimestamp(token_iat, timezone.utc).isoformat().replace("+00:00", "Z"),)
if token_exp:
    log.info("Token expiry: %s", datetime.fromtimestamp(token_exp, timezone.utc).isoformat().replace("+00:00", "Z"),)

if token_remaining <= 0:
    log.error("Apple Music web playback token expired")
    raise SystemExit(1)

if token_remaining <= 604800:
    log.warning("Apple Music web playback token is near expiry")

fetch_proxy_params = {
    "product": "music",
    "devToken": NAVIGATOR_DEV_TOKEN,
    "authType": "web",
    "authDisplayType": "inline",
    "locale": "en-US",
    "useRelativeIframeSrc": "true",
    "iso2code": "us",
    "isFullscreen": "true",
    "hostedAppSubdomain": "music",
}
FETCH_PROXY_URL = "https://music.apple.com/includes/commerce/fetch-proxy.html?" + urlencode(fetch_proxy_params)

log.info("Opening Apple Music commerce fetch proxy")
response_fetch_proxy = session.get(FETCH_PROXY_URL,
                                   headers={
                                       **common_html_headers,
                                       "Referer": MUSIC_ROOT_URL
                                   },
                                   timeout=30)
response_fetch_proxy.raise_for_status()

frame_id = f"auth-{uuid.uuid4()}"
authorize_url = (
    "https://idmsa.apple.com/appleauth/auth/authorize/signin"
    f"?frame_id={frame_id}"
    f"&language={APPLE_LANGUAGE}"
    "&skVersion=7"
    f"&iframeId={frame_id}"
    f"&client_id={APPLE_WIDGET_KEY}"
    f"&redirect_uri={APPLE_REDIRECT_URI}"
    f"&response_type={APPLE_OAUTH_RESPONSE_TYPE}"
    f"&response_mode={APPLE_OAUTH_RESPONSE_MODE}"
    "&account_ind=1"
    f"&state={frame_id}"
    "&authVersion=latest"
)

log.info("Opening Apple sign-in frame for Apple Music")
response_authorize = session.get(authorize_url,
                                 headers={
                                     **common_html_headers,
                                     "Referer": MUSIC_ROOT_URL
                                 },
                                 timeout=30)
response_authorize.raise_for_status()

apple_id_session_id = response_authorize.headers.get("X-Apple-ID-Session-Id", "")
scnt = response_authorize.headers.get("scnt", "")
auth_attributes = response_authorize.headers.get("X-Apple-Auth-Attributes", "")
hashcash_bits = response_authorize.headers.get("X-Apple-HC-Bits", "")
hashcash_challenge = response_authorize.headers.get("X-Apple-HC-Challenge", "")
password_second_step = None

authorize_soup = BeautifulSoup(response_authorize.text, "html.parser")
for node in authorize_soup.find_all("script", attrs={"class": "boot_args", "type": "application/json"}):
    try:
        payload = json.loads(node.get_text(strip=True))
    except Exception:
        continue
    direct_payload = payload.get("direct", {})
    if "isPasswordSecondStep" in direct_payload:
        password_second_step = direct_payload.get("isPasswordSecondStep")
    if direct_payload.get("authAttributes") and not auth_attributes:
        auth_attributes = direct_payload.get("authAttributes")
    if isinstance(direct_payload.get("hashcash"), dict):
        if direct_payload["hashcash"].get("hcBits") and not hashcash_bits:
            hashcash_bits = str(direct_payload["hashcash"].get("hcBits"))
        if direct_payload["hashcash"].get("hcChallenge") and not hashcash_challenge:
            hashcash_challenge = direct_payload["hashcash"].get("hcChallenge")

log.info("Password path: %s", bool(password_second_step))

apple_headers = {
    "User-Agent": USER_AGENT,
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "en-US,en;q=0.9",
    "Content-Type": "application/json",
    "Origin": "https://idmsa.apple.com",
    "Referer": "https://idmsa.apple.com/",
    "X-Apple-Widget-Key": APPLE_WIDGET_KEY,
    "X-Apple-OAuth-Client-Id": APPLE_WIDGET_KEY,
    "X-Apple-OAuth-Client-Type": APPLE_OAUTH_CLIENT_TYPE,
    "X-Apple-OAuth-Response-Mode": APPLE_OAUTH_RESPONSE_MODE,
    "X-Apple-OAuth-Response-Type": APPLE_OAUTH_RESPONSE_TYPE,
    "X-Apple-OAuth-Redirect-URI": APPLE_REDIRECT_URI,
    "X-Apple-Frame-Id": frame_id,
    "X-Apple-I-FD-Client-Info": APPLE_IFD_CLIENT_INFO,
    "X-Requested-With": "XMLHttpRequest",
    "sec-ch-ua": SEC_CH_UA,
    "sec-ch-ua-mobile": SEC_CH_UA_MOBILE,
    "sec-ch-ua-platform": SEC_CH_UA_PLATFORM,
}
if apple_id_session_id:
    apple_headers["X-Apple-ID-Session-Id"] = apple_id_session_id
if scnt:
    apple_headers["scnt"] = scnt
if auth_attributes:
    apple_headers["X-Apple-Auth-Attributes"] = auth_attributes
if hashcash_bits:
    apple_headers["X-Apple-HC-Bits"] = hashcash_bits
if hashcash_challenge:
    apple_headers["X-Apple-HC-Challenge"] = hashcash_challenge

music_auth_headers = {
    "User-Agent": USER_AGENT,
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Content-Type": "application/json",
    "Origin": "https://music.apple.com",
    "Referer": "https://music.apple.com/",
    "x-apple-store-front": APPLE_STOREFRONT,
    "sec-ch-ua": SEC_CH_UA,
    "sec-ch-ua-mobile": SEC_CH_UA_MOBILE,
    "sec-ch-ua-platform": SEC_CH_UA_PLATFORM,
}
if apple_id_session_id:
    music_auth_headers["X-Apple-ID-Session-Id"] = apple_id_session_id
if scnt:
    music_auth_headers["scnt"] = scnt
if auth_attributes:
    music_auth_headers["X-Apple-Auth-Attributes"] = auth_attributes
if hashcash_bits:
    music_auth_headers["X-Apple-HC-Bits"] = hashcash_bits
if hashcash_challenge:
    music_auth_headers["X-Apple-HC-Challenge"] = hashcash_challenge

log.info("Calling federate")
federate_body = {"accountName": EMAIL, "rememberMe": False}
response_federate = session.post("https://idmsa.apple.com/appleauth/auth/federate?isRememberMeEnabled=false",
                                 headers=apple_headers,
                                 json=federate_body,
                                 timeout=30)
response_federate.raise_for_status()
if response_federate.headers.get("scnt"):
    scnt = response_federate.headers.get("scnt")
    apple_headers["scnt"] = scnt
    music_auth_headers["scnt"] = scnt

log.info("Calling device challenge")
response_verify_device_key = session.post("https://idmsa.apple.com/appleauth/auth/verify/device/key/challenge",
                                          headers=apple_headers,
                                          json={"passkeyAutofill": False},
                                          timeout=30)
response_verify_device_key.raise_for_status()
if response_verify_device_key.headers.get("scnt"):
    scnt = response_verify_device_key.headers.get("scnt")
    apple_headers["scnt"] = scnt
    music_auth_headers["scnt"] = scnt

log.info("Refreshing Apple sign-in frame")
frame_id = f"auth-{uuid.uuid4()}"
authorize_url = (
    "https://idmsa.apple.com/appleauth/auth/authorize/signin"
    f"?frame_id={frame_id}"
    f"&language={APPLE_LANGUAGE}"
    "&skVersion=7"
    f"&iframeId={frame_id}"
    f"&client_id={APPLE_WIDGET_KEY}"
    f"&redirect_uri={APPLE_REDIRECT_URI}"
    f"&response_type={APPLE_OAUTH_RESPONSE_TYPE}"
    f"&response_mode={APPLE_OAUTH_RESPONSE_MODE}"
    "&account_ind=1"
    f"&state={frame_id}"
    "&authVersion=latest"
)
response_authorize = session.get(authorize_url,
                                 headers={
                                     **common_html_headers,
                                     "Referer": MUSIC_ROOT_URL
                                 },
                                 timeout=30)
response_authorize.raise_for_status()

apple_id_session_id = response_authorize.headers.get("X-Apple-ID-Session-Id", apple_id_session_id)
scnt = response_authorize.headers.get("scnt", scnt)
auth_attributes = response_authorize.headers.get("X-Apple-Auth-Attributes", auth_attributes)
hashcash_bits = response_authorize.headers.get("X-Apple-HC-Bits", hashcash_bits)
hashcash_challenge = response_authorize.headers.get("X-Apple-HC-Challenge", hashcash_challenge)

apple_headers["X-Apple-Frame-Id"] = frame_id
music_auth_headers["X-Apple-Frame-Id"] = frame_id
if apple_id_session_id:
    apple_headers["X-Apple-ID-Session-Id"] = apple_id_session_id
    music_auth_headers["X-Apple-ID-Session-Id"] = apple_id_session_id
if scnt:
    apple_headers["scnt"] = scnt
    music_auth_headers["scnt"] = scnt
if auth_attributes:
    apple_headers["X-Apple-Auth-Attributes"] = auth_attributes
    music_auth_headers["X-Apple-Auth-Attributes"] = auth_attributes
if hashcash_bits:
    apple_headers["X-Apple-HC-Bits"] = hashcash_bits
    music_auth_headers["X-Apple-HC-Bits"] = hashcash_bits
if hashcash_challenge:
    apple_headers["X-Apple-HC-Challenge"] = hashcash_challenge
    music_auth_headers["X-Apple-HC-Challenge"] = hashcash_challenge

log.info("Calling federate again")
response_federate_second = session.post("https://idmsa.apple.com/appleauth/auth/federate?isRememberMeEnabled=false",
                                        headers=apple_headers,
                                        json=federate_body,
                                        timeout=30)
response_federate_second.raise_for_status()
if response_federate_second.headers.get("scnt"):
    scnt = response_federate_second.headers.get("scnt")
    apple_headers["scnt"] = scnt
    music_auth_headers["scnt"] = scnt

log.info("Preparing SRP")
private_a_bytes = secrets.token_bytes(GROUP_BYTES)
private_a_int = int.from_bytes(private_a_bytes, "big")
public_a_int = pow(G_INT, private_a_int, N_INT)
public_a_bytes = public_a_int.to_bytes(GROUP_BYTES, "big")

signin_init_body = {
    "a": base64.b64encode(public_a_bytes).decode("utf-8"),
    "accountName": EMAIL,
    "protocols": ["s2k", "s2k_fo"],
}

log.info("Calling signin init")
response_signin_init = session.post("https://idmsa.apple.com/appleauth/auth/signin/init",
                                    headers=apple_headers,
                                    json=signin_init_body,
                                    timeout=30)
response_signin_init.raise_for_status()
signin_init_json = response_signin_init.json()
if response_signin_init.headers.get("scnt"):
    scnt = response_signin_init.headers.get("scnt")
    apple_headers["scnt"] = scnt
    music_auth_headers["scnt"] = scnt

iterations = int(signin_init_json["iteration"])
salt_bytes = base64.b64decode(signin_init_json["salt"])
server_public_b_bytes = base64.b64decode(signin_init_json["b"])
server_public_b_int = int.from_bytes(server_public_b_bytes, "big")
c_value = signin_init_json["c"]

password_hash = hashlib.sha256(PASS.encode("utf-8")).digest()
password_derived = hashlib.pbkdf2_hmac("sha256", password_hash, salt_bytes, iterations, dklen=32)
x_bytes = hashlib.sha256(salt_bytes + hashlib.sha256(b":" + password_derived).digest()).digest()
x_int = int.from_bytes(x_bytes, "big")
k_bytes = hashlib.sha256(bytes.fromhex(RFC5054_2048_N_HEX) + G_INT.to_bytes(1, "big").rjust(GROUP_BYTES, b"\x00")).digest()
k_int = int.from_bytes(k_bytes, "big")
u_bytes = hashlib.sha256(public_a_bytes + server_public_b_bytes).digest()
u_int = int.from_bytes(u_bytes, "big")
gx_int = pow(G_INT, x_int, N_INT)
base_int = (server_public_b_int - (k_int * gx_int)) % N_INT
exp_int = private_a_int + (u_int * x_int)
shared_secret_int = pow(base_int, exp_int, N_INT)
shared_secret_bytes = shared_secret_int.to_bytes(GROUP_BYTES, "big")
shared_key_bytes = hashlib.sha256(shared_secret_bytes).digest()
hn = hashlib.sha256(bytes.fromhex(RFC5054_2048_N_HEX)).digest()
hg = hashlib.sha256(G_INT.to_bytes(1, "big").rjust(GROUP_BYTES, b"\x00")).digest()
hi = hashlib.sha256(EMAIL.lower().encode("utf-8")).digest()
xor_ng = bytes(a ^ b for a, b in zip(hn, hg))
m1_bytes = hashlib.sha256(xor_ng + hi + salt_bytes + public_a_bytes + server_public_b_bytes + shared_key_bytes).digest()
m2_bytes = hashlib.sha256(public_a_bytes + m1_bytes + shared_key_bytes).digest()

signin_complete_body = {
    "accountName": EMAIL,
    "rememberMe": False,
    "m1": base64.b64encode(m1_bytes).decode("utf-8"),
    "c": c_value,
    "m2": base64.b64encode(m2_bytes).decode("utf-8"),
}

log.info("Calling signin complete")
response_signin_complete = session.post("https://idmsa.apple.com/appleauth/auth/signin/complete?isRememberMeEnabled=false",
                                        headers=apple_headers,
                                        json=signin_complete_body,
                                        timeout=30)
response_signin_complete.raise_for_status()
if response_signin_complete.headers.get("scnt"):
    scnt = response_signin_complete.headers.get("scnt")
    apple_headers["scnt"] = scnt
    music_auth_headers["scnt"] = scnt

log.info("Calling Apple Music final auth")
response_final_auth = session.post("https://auth.music.apple.com/auth/v1/web",
                                   headers=music_auth_headers,
                                   json={"webAuthorizationFlowContext": "music"},
                                   timeout=30)
response_final_auth.raise_for_status()

music_api_headers = {
    "User-Agent": USER_AGENT,
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Content-Type": "application/json",
    "Origin": "https://music.apple.com",
    "Referer": "https://music.apple.com/",
    "Authorization": f"Bearer {NAVIGATOR_DEV_TOKEN}",
    "x-apple-store-front": APPLE_STOREFRONT,
    "sec-ch-ua": SEC_CH_UA,
    "sec-ch-ua-mobile": SEC_CH_UA_MOBILE,
    "sec-ch-ua-platform": SEC_CH_UA_PLATFORM,
}

media_user_token = session.cookies.get("media-user-token", domain=".music.apple.com") or session.cookies.get("media-user-token")
if media_user_token:
    music_api_headers["media-user-token"] = media_user_token

log.info("Refreshing Apple Music account info")
response_account_info = session.get("https://buy.music.apple.com/account/web/info",
                                    headers=music_api_headers,
                                    timeout=30)
response_account_info.raise_for_status()

response_account_info_refresh = session.get("https://buy.music.apple.com/account/web/infoRefresh",
                                            headers=music_api_headers,
                                            timeout=30)
response_account_info_refresh.raise_for_status()

log.info("Refreshing Apple Music auth v2")
response_music_auth_v2 = session.post("https://auth.music.apple.com/auth/v2/web",
                                      headers={
                                          "User-Agent": USER_AGENT,
                                          "Accept": "*/*",
                                          "Accept-Language": "en-US,en;q=0.9",
                                          "Origin": "https://music.apple.com",
                                          "Referer": "https://music.apple.com/",
                                          "sec-ch-ua": SEC_CH_UA,
                                          "sec-ch-ua-mobile": SEC_CH_UA_MOBILE,
                                          "sec-ch-ua-platform": SEC_CH_UA_PLATFORM
                                      },
                                      timeout=30)
response_music_auth_v2.raise_for_status()

media_user_token = session.cookies.get("media-user-token", domain=".music.apple.com") or session.cookies.get("media-user-token")
if media_user_token:
    music_api_headers["media-user-token"] = media_user_token

log.info("Fetching Apple Music subscription account state")

response_amp_account_full = session.get("https://amp-api.music.apple.com/v1/me/account",
                                        params={
                                            "art[url]": "f",
                                            "challenge[subscriptionCapabilities]": "voice,premium",
                                            "meta": "subscription",
                                            "platform": "web"
                                        },
                                        headers=music_api_headers,
                                        timeout=30)
response_amp_account_full.raise_for_status()

response_amp_account_basic = session.get("https://amp-api.music.apple.com/v1/me/account",
                                         params={
                                             "meta": "subscription",
                                             "challenge[subscriptionCapabilities]": "voice,premium"
                                         },
                                         headers=music_api_headers,
                                         timeout=30)
response_amp_account_basic.raise_for_status()

log.info("Refreshing Apple Music account info again")
response_account_info = session.get("https://buy.music.apple.com/account/web/info",
                                    headers=music_api_headers,
                                    timeout=30)
response_account_info.raise_for_status()

response_account_info_refresh = session.get("https://buy.music.apple.com/account/web/infoRefresh",
                                            headers=music_api_headers,
                                            timeout=30)
response_account_info_refresh.raise_for_status()

log.info("Fetching Apple Music account config")
response_amp_account_config = session.get("https://amp-account.music.apple.com/account/web/config",
                                          headers=music_api_headers,
                                          timeout=30)
response_amp_account_config.raise_for_status()

log.info("Fetching Apple Music subscription offers")
response_offers = session.get("https://buy.music.apple.com/commerce/web/subscription/offers/music",
                              headers={
                                  **music_api_headers,
                                  "x-apple-store-front": APPLE_OFFERS_STOREFRONT
                              },
                              timeout=30)
response_offers.raise_for_status()

navigator_params = {
    "product": "music",
    "devToken": NAVIGATOR_DEV_TOKEN,
    "authType": "web",
    "authDisplayType": "inline",
    "locale": "en-US",
    "useRelativeIframeSrc": "true",
    "iso2code": "us",
    "isModal": "true",
    "hideCurtain": "true",
    "hostedAppSubdomain": "music",
}
NAVIGATOR_URL = "https://music.apple.com/includes/commerce/navigator?" + urlencode(navigator_params)

log.info("Opening Apple Music navigator")
response_navigator = session.get(NAVIGATOR_URL,
                                 headers={
                                     **common_html_headers,
                                     "Referer": MUSIC_ROOT_URL
                                 },
                                 timeout=30)
response_navigator.raise_for_status()

parsed_navigator_url = urlparse(response_navigator.request.url)
parsed_navigator_qs = parse_qs(parsed_navigator_url.query)
if parsed_navigator_qs.get("devToken"):
    NAVIGATOR_DEV_TOKEN = parsed_navigator_qs["devToken"][0]

log.info("Normalizing cookies")
apple_cookies = {}
for cookie in session.cookies:
    apple_cookies[cookie.name] = cookie.value

apple_cookies["geo"] = apple_cookies.get("geo") or "US"
apple_cookies["dslang"] = apple_cookies.get("dslang") or "US-EN"
apple_cookies["site"] = apple_cookies.get("site") or "USA"
apple_cookies["itre"] = apple_cookies.get("itre") or "0"

required_cookie_names = [
    "dslang",
    "geo",
    "itspod",
    "myacinfo",
    "site",
    "commerce-authorization-token",
    "itre",
    "itua",
    "media-user-token",
    "mut-refresh",
    "pldfltcid",
    "pltvcid",
]

missing_cookie_names = [name for name in required_cookie_names if not apple_cookies.get(name)]

if missing_cookie_names:
    log.error("Missing cookies: %s", ", ".join(missing_cookie_names))

APPLE_COOKIES_PATH.write_text(json.dumps(apple_cookies, ensure_ascii=False, indent=2), encoding="utf-8")

log.info("Apple Music login completed")
log.info("Web playback token source: Apple Music web assets")
log.info("Cookies saved: %s", APPLE_COOKIES_PATH.name)
log.info("Cookie count: %s", len(apple_cookies))