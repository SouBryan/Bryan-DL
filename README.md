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

## Security & Infrastructure

This fork includes hardened production infrastructure:

- **WARP Proxy**: All Qobuz API requests are routed through Cloudflare WARP (SOCKS5 proxy) for IP privacy. Custom Docker image with `warp-cli` + `socat` forwarding.
- **IP Rotation**: Automatic IPv4 rotation every 30 minutes via `warp-cli disconnect/connect`, plus on-demand rotation triggered by 429/403/401/502/503 responses from Qobuz.
- **Rate Limiting**: 60 requests/minute per IP via Next.js middleware.
- **Bot Protection**: Blocks known scanner user-agents (sqlmap, nikto, zgrab, nuclei, etc.) and requests without a user-agent.
- **Payload Validation**: Detects and blocks malicious payloads (eval, require, path traversal, XSS, `returnNaN` probes, `/let` attacks).
- **Attack Path Blocking**: Returns 404 for known scanner paths (`/.env`, `/wp-admin`, `/phpmyadmin`, `/.git`, `/actuator`, etc.).
- **IPGate Integration**: All API routes check incoming IPs against [FireHOL](https://github.com/firehol/blocklist-ipsets) blocklists (~612M blocked IPs) via Unix Domain Socket for O(1) lookup.
- **IP Blocklist**: Hardcoded block for known persistent attacker IPs.
- **Cloudflare Tunnel**: Service exposed via `cloudflared` tunnel — no open ports on the server.

## Table of Contents

- [Installation](#installation)
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

## Getting Started

### 1. Clone the repo

```bash
git clone https://github.com/SouBryan/Qobuz-DL.git
```

### 2. Navigate to the project directory

```bash
cd Qobuz-DL
```

### 3. Install Dependencies

```bash
npm i
```

### 4. Run the development server

```bash
npm run dev
```

## Docker Installation

### 1. Clone the repo

```bash
git clone https://github.com/SouBryan/Qobuz-DL.git
```

### 2. Navigate to the project directory

```bash
cd Qobuz-DL
```

### 3. Docker Compose (recommended)

```bash
docker compose up -d
```

This starts 3 services:
- **qobuz-dl**: The Next.js app on port 3000
- **warp-socks**: Cloudflare WARP SOCKS5 proxy for IP privacy
- **warp-rotator**: Automatic IP rotation every 30 minutes

### Setup .env (IMPORTANT)

Before you can use Qobuz-DL, you need to change the .env file in the root directory. The default configuration will NOT work. QOBUZ_APP_ID and QOBUZ_SECRET must be set to the correct values. To find these you can use [this tool](https://github.com/QobuzDL/Qobuz-AppID-Secret-Tool).
Additionally, in order to download files longer than 30 seconds, a valid Qobuz token is needed. This can be found in the localuser.token key of localstorage on the [official Qobuz website](https://play.qobuz.com/) for any paying members.

## Contributing

1. Fork the repository.
2. Create a new branch: `git checkout -b feature-name`.
3. Make your changes.
4. Push your branch: `git push origin feature-name`.
5. Create a pull request.

## License

This project is licensed under the [MIT License](LICENSE).
