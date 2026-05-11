# Qobuz-DL

![Qobuz-DL](https://github.com/user-attachments/assets/45896382-1764-4339-824a-b31f32991480)

---

> [!IMPORTANT]
> This repository does not contain any copyrighted material, or code to illegaly download music. Downloads are provided by the Qobuz API and should only be initiated by the API token owner. The author is **not responsible for the usage of this repository nor endorses it**, nor is the author responsible for any copies, forks, re-uploads made by other users, or anything else related to Qobuz-DL. Any live demo found online of this project is not associated with the authors of this repo. This is the author's only account and repository.

Qobuz-DL provides a fast and easy way to download music using Qobuz in a variety of codecs and formats entirely from the browser.

## Features

- Download any song or album from Qobuz.
- Re-encode audio provided by Qobuz to a variety of different lossless and lossy codecs using FFmpeg.
- Apply metadata to downloaded songs.
- Cross-origin API with CORS headers — works as a backend for external clients like [Monochrome](https://github.com/user/monochrome).

## Architecture

```
┌─────────────┐      ┌─────────────────┐      ┌──────────────┐
│  Browser /   │ ───► │  Cloudflare     │ ───► │  Next.js App │
│  Monochrome  │      │  Tunnel         │      │  (port 3000) │
└─────────────┘      └─────────────────┘      └──────┬───────┘
                                                      │
                                               ┌──────▼───────┐
                                               │  WARP SOCKS5  │
                                               │  Proxy (9091) │
                                               └──────┬───────┘
                                                      │
                                               ┌──────▼───────┐
                                               │  Qobuz API    │
                                               └──────────────┘
```

**Stack**: Next.js 15 (standalone) · Docker Compose · Cloudflare WARP · Cloudflare Tunnel · IPGate

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

This starts 3 services:

| Service | Description |
|---|---|
| **qobuz-dl** | Next.js app on port 3000 |
| **warp-socks** | Cloudflare WARP SOCKS5 proxy for IP privacy |
| **warp-rotator** | Automatic IP rotation every 30 minutes |

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/get-music` | `GET` | Search for tracks. Query param: `q` |
| `/api/download-music` | `GET` | Download/stream a track |
| `/api/get-album` | `GET` | Get album details |
| `/api/get-artist` | `GET` | Get artist details |
| `/api/get-releases` | `GET` | Get new releases |
| `/api/get-countries` | `GET` | List available token countries |

All endpoints return JSON and accept a `Token-Country` header for multi-region token selection.

## Project Structure

```
├── app/                    # Next.js App Router
│   ├── api/                # API route handlers
│   ├── page.tsx            # Home page (SearchView)
│   ├── not-found.tsx       # 404 page (minimal, no SSR risk)
│   └── layout.tsx          # Root layout
├── middleware.ts            # Security middleware (whitelist, CORS, etc.)
├── lib/
│   ├── ipgate.ts           # IPGate UDS client
│   ├── qobuz-dl.tsx        # Qobuz API client
│   └── qobuz-dl-server.tsx # Server-side Qobuz helpers
├── docker/
│   └── warp-socks/         # WARP proxy Docker image
├── scripts/
│   └── rotate-ip.sh        # IP rotation script
├── docker-compose.yml      # 3-service stack
├── Dockerfile              # Multi-stage Next.js standalone build
└── next.config.ts          # CORS headers, standalone output
```

## Contributing

1. Fork the repository.
2. Create a new branch: `git checkout -b feature-name`.
3. Make your changes.
4. Push your branch: `git push origin feature-name`.
5. Create a pull request.

## License

This project is licensed under the [MIT License](LICENSE).
