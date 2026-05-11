# Qobuz-DL

![Qobuz-DL](https://github.com/user-attachments/assets/45896382-1764-4339-824a-b31f32991480)

---

> [!IMPORTANT]
> This repository does not contain any copyrighted material, or code to illegaly download music. Downloads are provided by the Qobuz API and should only be initiated by the API token owner. The author is **not responsible for the usage of this repository nor endorses it**, nor is the author responsible for any copies, forks, re-uploads made by other users, or anything else related to Qobuz-DL. Any live demo found online of this project is not associated with the authors of this repo. This is the author's only account and repository.

Qobuz-DL provides a fast and easy way to download music from **Qobuz** and **Apple Music** in a variety of codecs and formats entirely from the browser. This fork adds Apple Music lossless (ALAC up to 24-bit/192kHz), WARP proxy for IP privacy, and security hardening.

## Features

- Download any song or album from **Qobuz** (up to Hi-Res 24-bit/192kHz).
- Download from **Apple Music** with full lossless support (ALAC 24-bit/192kHz via FairPlay wrapper).
- Search both services in parallel with ISRC cross-matching.
- Re-encode to FLAC, WAV, ALAC, AAC, MP3, or OPUS using FFmpeg.wasm in the browser.
- Apply metadata and album art to downloaded songs.
- Cloudflare WARP SOCKS5 proxy with automatic IP rotation every 30 minutes.
- Cloudflare R2 cache for Apple Music tracks (5-day auto-delete).
- Security middleware: route whitelist, bot detection, IPGate (~612M blocked IPs).
- Cross-origin API with CORS headers — works as a backend for external clients.

## Architecture

```
Browser / Monochrome → Cloudflare Tunnel (bryanhifi.dpdns.org) → Next.js (:3000)
                                                                       │
                                                        ┌──────────────┼──────────────┐
                                                        │              │              │
                                                  WARP SOCKS5    Apple Music    Apple Music
                                                   (:9091)        API (:8000)    Wrapper
                                                        │              │         (10020/20020/30020)
                                                        │              │              │
                                                   Qobuz API     Cloudflare R2    FairPlay
                                                              (cdn.bryanhifi.dpdns.org)  Decrypt
```

**Stack**: Next.js 15.5.4 (standalone) · Docker Compose · gamdl 3.5.1 · Cloudflare WARP · Cloudflare Tunnel · Cloudflare R2 · IPGate

## Security

The middleware (`middleware.ts`) implements a layered defense:

| Layer | What it does |
|---|---|
| **Route Whitelist** | Only known valid paths are allowed (`/`, `/api/*`, `/manifest`, `/flac/*`, `/logo/*`). Everything else → 404. Prevents SSR injection via arbitrary routes. |
| **HTTP Method Lock** | Only `GET`/`HEAD`/`OPTIONS` on non-API routes. `POST /` (used for SSR injection) → 405. |
| **IP Blocklist** | Hardcoded `Set` of known attacker IPs (residential proxies, scanner bots, cryptominer droppers). |
| **Bot UA Detection** | Blocks known scanner user-agents (sqlmap, nikto, zgrab, nuclei, etc.) on API routes. |
| **Payload Detection** | Regex-based detection of `eval()`, `require()`, `__proto__`, path traversal, XSS, `returnNaN` probes. |
| **Query Validation** | Max 500 chars on `/api/get-music` search queries. |
| **CORS** | `Access-Control-Allow-Origin: *` on all responses for cross-origin clients. |
| **IPGate** | Host-level firewall checking ~612M IPs from FireHOL blocklists via Unix Domain Socket (O(1) lookup). |

## Table of Contents

- [Installation](#installation)
- [Docker Installation](#docker-installation)
- [API Endpoints](#api-endpoints)
- [Contributing](#contributing)
- [License](#license)

## Installation

Before you begin, ensure you have the following installed:

- **Node.js** (LTS version recommended)  
  Download from: [https://nodejs.org/](https://nodejs.org/)

- **npm** (comes with Node.js)  
  To check if npm is installed, run:
    ```bash
    npm -v
    ```

### 1. Clone the repo

```bash
git clone https://github.com/SouBryan/Qobuz-DL.git
```

### 2. Install Dependencies

```bash
cd Qobuz-DL && npm i
```

### 3. Configure .env

Copy `.env.example` to `.env` and set:
- `QOBUZ_APP_ID` / `QOBUZ_SECRET` — use [this tool](https://github.com/QobuzDL/Qobuz-AppID-Secret-Tool)
- `QOBUZ_TOKEN_*` — from `localuser.token` in localStorage on [play.qobuz.com](https://play.qobuz.com/) (paying members only)

### 4. Run the development server

```bash
npm run dev
```

## Docker Installation

```bash
git clone https://github.com/SouBryan/Qobuz-DL.git
cd Qobuz-DL
cp .env.example .env   # edit with your tokens
docker compose up -d
```

This starts 5 services:

| Service | Description |
|---|---|
| **qobuz-dl** | Next.js app on port 3000 |
| **warp-socks** | Cloudflare WARP SOCKS5 proxy for IP privacy |
| **warp-rotator** | Automatic IP rotation every 30 minutes |
| **apple-music-api** | FastAPI sidecar — downloads/decrypts/caches Apple Music via gamdl |
| **apple-music-wrapper** | FairPlay wrapper for ALAC decryption (ARM64) |

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/get-music` | `GET` | Search for tracks (Qobuz + Apple Music in parallel) |
| `/api/download-music` | `GET` | Download/stream a track (Qobuz or Apple Music) |
| `/api/get-album` | `GET` | Get album details |
| `/api/get-artist` | `GET` | Get artist details |
| `/api/get-releases` | `GET` | Get new releases |
| `/api/get-countries` | `GET` | List available token countries |
| `/api/get-apple-capabilities` | `GET` | Check Apple Music lossless availability |

All endpoints return JSON and accept a `Token-Country` header for multi-region token selection.

## Project Structure

```
├── app/                    # Next.js App Router
│   ├── api/                # API route handlers (Qobuz + Apple Music)
│   ├── page.tsx            # Home page (SearchView)
│   ├── not-found.tsx       # 404 page (minimal, no SSR risk)
│   └── layout.tsx          # Root layout
├── apple-music/            # FastAPI sidecar for Apple Music
│   ├── main.py             # Download/decrypt/upload pipeline (gamdl 3.5.1)
│   ├── Dockerfile          # Python image
│   └── requirements.txt    # gamdl, httpx[socks], boto3
├── middleware.ts           # Security middleware (whitelist, CORS, etc.)
├── lib/
│   ├── apple-music-server.ts  # Apple Music sidecar client
│   ├── download-job.tsx       # Download pipeline (both sources)
│   ├── ffmpeg-functions.tsx   # FFmpeg.wasm codec conversion
│   ├── settings-provider.tsx  # User settings (7 output codecs)
│   ├── ipgate.ts              # IPGate UDS client
│   ├── qobuz-dl.tsx           # Qobuz API client
│   └── qobuz-dl-server.tsx    # Server-side Qobuz helpers
├── docker/
│   ├── apple-music-wrapper/   # FairPlay wrapper Docker image (ARM64)
│   └── warp-socks/            # WARP proxy Docker image
├── scripts/
│   └── rotate-ip.sh        # IP rotation script
├── docker-compose.yml      # 5-service stack
├── Dockerfile              # Multi-stage Next.js standalone build
└── next.config.ts          # CORS headers, standalone output
```

## Contributing

1. Fork the repository.
2. Create a new branch: `git checkout -b feature-name`.
3. Make your changes.
4. Push your branch: `git push origin feature-name`.
5. Create a pull request.

## Acknowledgements

This project uses the following third-party tools for Apple Music functionality:

| Project | Author | Usage | License |
|---|---|---|---|
| [gamdl](https://github.com/glomatico/gamdl) | [@glomatico](https://github.com/glomatico) | Apple Music download, decryption, and metadata tagging (AAC 256kbps + ALAC lossless) | [MIT](https://github.com/glomatico/gamdl/blob/main/LICENSE) |
| [wrapper](https://github.com/WorldObservationLog/wrapper) | [@WorldObservationLog](https://github.com/WorldObservationLog) | FairPlay decryption server enabling ALAC lossless downloads (up to 24-bit/192kHz) | No license specified |

Additionally, this project is a fork of [Monochrome-DL/qobuz-dl](https://github.com/kiraleos/qobuz-dl) (MIT License).

## Disclaimer

This project does not contain any copyrighted material. Apple Music downloads require an **active Apple Music subscription**. Qobuz downloads require a **valid Qobuz API token** from a paying account. The authors are not responsible for misuse.

## License

This project is licensed under the [MIT License](LICENSE).
