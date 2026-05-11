# Apple Music Integration — Plano de Implementação

> Plano detalhado para integrar Apple Music como fallback no Qobuz-DL, servindo o Monochrome.
> Criado em: 10 de maio de 2026.
> Atualizado em: 11 de maio de 2026 (pós Fase 0 — DRM confirmado).

---

## Decisões de Arquitetura

### Por que integrar no mesmo repo (e não separado)?

1. **Endpoint único** — Monochrome já aponta para `bryanhifi.dpdns.org`. Manter tudo num backend evita configurar segundo domínio/tunnel.
2. **Infra compartilhada** — WARP proxy, IPGate, middleware de segurança, Docker Compose.
3. **Fallback transparente** — a lógica "tenta Qobuz → se não achar, tenta Apple Music" fica server-side, invisível pro Monochrome.
4. **Tokens multi-país** — mesmo padrão do `token-countries.ts`, reaproveitado.

### Por que o gamdl?

- API Python async nativa (`AppleMusicApi`, `AppleMusicSongInterface`)
- AAC 256kbps funciona **sem wrapper/Widevine** — só precisa de cookies
- MIT license
- `pip install gamdl` — 88 releases, 1.210 commits, projeto maduro
- Padrão de integração idêntico ao que já fazemos com o Qobuz

### Como obter cookies?

O `main.py` (do Discord) faz login web automatizado via SRP e gera os cookies necessários (incluindo `media-user-token`). Precisamos convertê-lo para gerar cookies no formato Netscape `.txt` (que é o que o gamdl aceita), e rodá-lo periodicamente para refresh.

### Streaming vs Download — ⚠️ ATUALIZADO PÓS FASE 0

**Descoberta crítica da Fase 0**: TODAS as streams da Apple Music são protegidas por DRM (FairPlay/Widevine), incluindo AAC Legacy 256kbps. Não existe URL direta reproduzível.

**O que confirmamos:**
- Stream URL é HLS (`.m3u8`): `https://aod-ssl.itunes.apple.com/.../mzaf_XXX.rphq.aac.wa.m3u8`
- Segmentos são `.m4p` (m4a encriptado com FairPlay)
- `extendedAssetUrls` (lightweight, plus, etc.) também são `.m4p` protegidos
- gamdl obtém a decryption key automaticamente via Widevine license exchange
- Key exemplo: `kid=0000000069b25019001dc67aa017f945`, `key=2cbd89ef9fffa62bfdb306af169f33db`

**Fluxo obrigatório (com Cloudflare R2):**
1. Monochrome chama `/api/download-music?track_id=apple:XXXX`
2. Next.js checa se o arquivo já existe no R2 (`apple/XXXX.m4a`)
   - **SIM**: retorna `{ success: true, data: { url: "https://cdn.bryanhifi.dpdns.org/apple/XXXX.m4a" } }`
   - **NÃO**: chama sidecar Python → gamdl baixa + decripta → upload pro R2 → retorna URL do R2
3. Monochrome faz `fetch(url)` na URL do R2 — identicamente igual ao fluxo Qobuz

**Formato de resposta idêntico ao Qobuz**: `{ success: true, data: { url } }`. Confirmado no código do Monochrome (`api.js` L1774-1797, `getQobuzStreamUrl`).

### Cache com Cloudflare R2 ✅ CONFIGURADO

| Recurso | Free tier |
|---|---|
| Storage | 10 GB/mês |
| Class A (uploads) | 1M ops/mês |
| Class B (downloads) | 10M ops/mês |
| **Egress** | **$0 (grátis)** |

- **Bucket**: `media-cache`
- **Custom domain**: `cdn.bryanhifi.dpdns.org` (ativo)
- **S3 endpoint**: `https://4c37251dab5d9850c7bbdfb85ea0ea7a.r2.cloudflarestorage.com`
- **Lifecycle rule**: auto-delete após 5 dias
- Track AAC 256kbps ≈ 5-8 MB. Com 10 GB cabem ~1.500 tracks simultaneamente
- Na 2ª vez que alguém pede a mesma track: resposta instantânea (já está no R2)
- Servido pelo edge global da Cloudflare = CDN real

**Implicação de tempo**: primeira request leva ~3-8s (download HLS + decrypt + upload R2). Requests subsequentes para a mesma track são instantâneas.

### Princípio: Zero mudanças no Monochrome

Toda a integração Apple Music é **transparente** — o Monochrome continua chamando os mesmos endpoints (`/api/get-music`, `/api/download-music`) e recebe respostas no **mesmo formato Qobuz**. O backend faz a tradução internamente:

- `/api/get-music?q=...` → busca no Qobuz, se poucos resultados busca também na Apple Music, retorna tudo no formato `QobuzSearchResults`
- `/api/download-music?track_id=...` → detecta a fonte pelo prefixo do ID e roteia

IDs Apple Music são prefixados com `apple:` para distinguir de IDs Qobuz (ex: `apple:1624945512`). O Monochrome não precisa saber disso — ele recebe o ID na busca e envia de volta no download.

### Requisito: Conta Apple Music com plano ativo

O `media-user-token` (necessário para stream URLs) só é emitido para assinantes Apple Music. Qualquer plano individual funciona. Um plano por storefront que você quiser cobrir (US, JP, etc.).

---

## Fase 0 — Prova de Conceito (local, sem Docker) ✅ CONCLUÍDA

**Objetivo**: Validar que conseguimos buscar e obter stream URLs via gamdl + cookies do `main.py`.

### Resultados

- [x] Cookies gerados via `main.py` (SRP login) → `applemusic_auth_cookies.json`
- [x] Conversão JSON → Netscape `.txt` → `apple_cookies_netscape.txt`
- [x] gamdl inicializado com sucesso: `Subscription: True`, storefront `br`
- [x] Busca funcional: YOASOBI アイドル, Ado 踊, Rick Astley — todos encontrados
- [x] Stream URL obtida: HLS `.m3u8` (AAC Legacy 256kbps)
- [x] **DRM CONFIRMADO**: streams são `.m4p` (FairPlay), decryption key obtida via Widevine
- [x] **URL direta NÃO é possível** — precisa download + decrypt

### Dados coletados

| Campo | Valor |
|---|---|
| `stream_url` | `https://aod-ssl.itunes.apple.com/.../mzaf_A1773293593.rphq.aac.wa.m3u8` |
| `decryption_key` | `kid=0000000069b25019001dc67aa017f945`, `key=2cbd89ef...` |
| `file_format` | m4a (mas extensão real é `.m4p` — protegido) |
| `codec` | None (AAC Legacy) |
| `webplayback flavors` | cbcp256, ctrp256, ibhp256, cbcp64 |
| `extendedAssetUrls` | lightweight, lightweightPlus, plus (todas `.m4p` com accessKey) |

### Conclusão

**Streaming direto é impossível.** O sidecar precisa usar o pipeline completo do gamdl (`downloader.download()`) para baixar HLS segments → decriptar com Widevine key → gerar `.m4a` limpo → servir via HTTP.

---

## Fase 1 — Sidecar FastAPI (Apple Music Bridge) ✅ IMPLEMENTADA

**Objetivo**: Criar o serviço Python que o Next.js vai chamar via HTTP interno. O sidecar faz **busca + download + decrypt** e serve áudio limpo.

### 1.1 — Criar `apple-music/main.py` (FastAPI) ✅

Serviço HTTP interno (não exposto ao público):

```
Endpoints implementados:
  GET  /search?term=...&limit=10          → JSON com resultados de busca
  GET  /download/{song_id}                 → Download+decrypt → upload R2 → retorna URL
  GET  /track-info/{song_id}              → Metadata do catálogo Apple Music
  GET  /health                             → JSON com {status, subscription, storefront}
```

**Endpoint `/download/{song_id}` — fluxo implementado:**
1. Recebe song_id da Apple Music
2. Checa cache R2 (`apple/{song_id}.m4a`) — se já existe, retorna URL imediatamente
3. Usa gamdl `downloader.download()` para baixar HLS + decriptar → arquivo `.m4a` temp
4. Upload do `.m4a` limpo para Cloudflare R2 (bucket `media-cache`, key `apple/{song_id}.m4a`)
5. Retorna JSON: `{ "url": "https://cdn.bryanhifi.dpdns.org/apple/{song_id}.m4a" }`
6. Deleta arquivo temp local

- [x] Inicializar gamdl com cookies do bind mount (`./apple-music/cookies/cookies.txt`)
- [x] Implementar endpoints: `/health`, `/search`, `/download/{song_id}`, `/track-info/{song_id}`
- [x] Upload para R2 via boto3/S3 API (R2 é S3-compatível)
- [x] Diretório temp para processamento (`/tmp/apple-music-processing/`)
- [x] Error handling com status codes HTTP (200, 404, 401, 503)
- [x] Dockerfile: Python 3.12-slim + ffmpeg + gamdl + fastapi + uvicorn + boto3
- [x] Docker Compose: serviço `apple-music-api` (interno, rede `qobuz-network`)
- [x] R2 lifecycle rule: auto-delete após 5 dias (**ação manual no Cloudflare Dashboard**)

### 1.2 — Multi-storefront (multi-país) — ⏳ FUTURO

Mesma lógica do Qobuz: múltiplos tokens de países diferentes. **Não implementado na v1** — começa com um storefront só.

- [ ] Cada conta gera um par `(devToken, media-user-token)` para seu storefront
- [ ] O bridge mantém instâncias gamdl por storefront
- [ ] Storefront `jp` é crítico — é o principal caso de uso (músicas japonesas)

### 1.3 — Cookie refresh automático — ⏳ FUTURO

O `media-user-token` expira. Na v1, refresh é manual via SFTP.

- [ ] Adaptar `main.py` como módulo: `apple-music/auth.py`
- [ ] Função `refresh_cookies(email, password, storefront) → {devToken, media_user_token, cookies}`
- [ ] Rodar via cron (a cada 12-24h) ou on-demand quando o gamdl retornar 401
- [ ] Salvar tokens refreshed no `.env` ou em arquivo persistente no volume Docker

### 1.4 — Rate limit avoidance

A Apple é mais agressiva que o Qobuz com rate limits.

- [ ] Usar WARP proxy (já temos) para todas as requests da API Apple Music
- [ ] Implementar delay entre requests (configurável, default 500ms)
- [ ] Implementar backoff exponencial em 429s
- [ ] Rotacionar storefront em caso de rate limit (US → JP → GB → ...)
- [ ] Token rotation: se uma conta leva 429, usar outra por X minutos (mesma lógica do `blockedTokens` Map no qobuz-dl-server.tsx)

---

## Fase 2 — Camada TypeScript (integração Next.js) ✅ IMPLEMENTADA

**Objetivo**: Integrar o sidecar FastAPI (Fase 1) nos endpoints existentes do Next.js. O Monochrome **não é tocado** — tudo é transparente.

### 2.1 — Criar `lib/apple-music-server.ts` ✅

Cliente HTTP TypeScript que chama o sidecar:

- [x] `searchAppleMusic(term, limit)` → chama sidecar `/search`
- [x] `downloadAppleMusicTrack(songId)` → checa R2 cache (HEAD) → se miss, chama sidecar `/download/{songId}` → retorna URL R2
- [x] `convertAppleMusicToQobuzFormat(songs)` → converte para formato Qobuz (IDs com `apple:` prefix)
- [x] `extractSongsFromAppleResponse(response)` → extrai array de songs da resposta Apple Music
- [x] `getAppleMusicHealth()` → health check do sidecar
- [x] Timeout configurado: 15s (search), 60s (download), 3s (health/HEAD)

### 2.3 — Modificar rotas existentes (fallback transparente) ✅

**Nenhuma rota nova criada.** Os endpoints existentes ganharam fallback:

#### `/api/get-music/route.ts` ✅

- [x] Modificar `app/api/get-music/route.ts` com fallback Apple Music
- [x] Se Qobuz retorna 0 tracks → busca Apple Music → converte → retorna no mesmo formato
- [x] A resposta continua no formato `QobuzSearchResults` — Monochrome não percebe
- [x] Tracks Apple Music têm `track_id` prefixado: `"apple:1624945512"`

#### `/api/download-music/route.ts` ✅

- [x] Schema Zod alterado: `track_id` agora é `z.string()` (aceita `apple:XXX` e numéricos)
- [x] Se `track_id` começa com `apple:` → checa R2 cache, se miss chama sidecar
- [x] Se numérico puro → fluxo Qobuz existente (sem mudança)
- [x] Resposta: `{ success: true, data: { url: "https://cdn.bryanhifi.dpdns.org/apple/XXX.m4a" } }`
- [x] Formato **idêntico ao Qobuz** — confirmado no código do Monochrome

### 2.4 — Middleware update ✅

- [x] Não precisa de rotas novas na whitelist (usamos os mesmos endpoints)
- [x] Não precisa de proxy HLS — o sidecar faz download+decrypt internamente

---

## Riscos e Mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| ~~AAC Legacy requer DRM/decryption~~ | ~~Média~~ | ~~Alto~~ | **CONFIRMADO na Fase 0.** Solução: gamdl faz download+decrypt automaticamente. Sidecar serve arquivo .m4a limpo |
| Latência de download+decrypt | Alta | Médio | ~3-8s na 1ª request. Cache R2 elimina latência em requests subsequentes (5 dias de retenção) |
| Custo R2 excede free tier | Baixa | Baixo | 10GB free = ~1.500 tracks simultâneas. Lifecycle 5 dias impede acúmulo. Uso pessoal jamais excede |
| Apple bloqueia IP da VPS | Média | Médio | WARP proxy + rotação de IP (já temos). Apple é menos agressiva que Qobuz com IPs de datacenter |
| `media-user-token` expira frequentemente | Alta | Médio | Auto-refresh via `auth.py` adaptado (cron a cada 12h) |
| Rate limits da Apple | Alta | Médio | Delay entre requests + token rotation + backoff exponencial |
| ~~Stream URL HLS em vez de direta~~ | ~~Alta~~ | ~~Médio~~ | **CONFIRMADO.** Sidecar usa gamdl para resolver HLS internamente. Monochrome recebe stream limpo |
| SRP login falha (2FA, CAPTCHA) | Baixa | Alto | Monitorar. Apple raramente pede 2FA em logins programáticos com cookies persistidos |
| gamdl breaking changes | Baixa | Médio | Pinnar versão no requirements.txt |
| Formato de resposta quebra Monochrome | Baixa | Alto | Conversão Apple→Qobuz format é testada na Fase 2. IDs prefixados com `apple:` são opacos pro Monochrome |

---

## Ordem de Execução

```
Fase 0 ✅ CONCLUÍDA  →  Fase 1 ✅ IMPLEMENTADA  →  Fase 2 ✅ IMPLEMENTADA  →  Fase 3 (Deploy VPS)
```

**Fase 0 concluída**: DRM confirmado. Abordagem: download+decrypt → upload R2 → retorna URL.

**Validação do Monochrome**: código analisado (`api.js` L1728-1797, `getQobuzStreamUrl`). Contrato:
```
1. GET /api/get-music?q={isrc}        → { data: { tracks: { items: [...] } } }
2. GET /api/download-music?track_id=X  → { success: true, data: { url: "https://..." } }
3. fetch(url)                          → áudio binário
```
Qualquer URL HTTP que retorne áudio funciona. R2 URL é perfeita.

**Zero mudanças no Monochrome** — tudo é transparente. O Monochrome chama os mesmos endpoints e recebe respostas no mesmo formato. As tracks Apple Music aparecem misturadas nos resultados com IDs prefixados (`apple:...`) que o Monochrome trata como opacos.

---

## Estrutura de Arquivos (implementada)

```
qobuz-dl/
├── app/api/
│   ├── download-music/route.ts   # ✅ MODIFICADO (+ detecção apple: prefix + R2 cache)
│   ├── get-music/route.ts        # ✅ MODIFICADO (+ fallback Apple Music)
│   ├── get-album/route.ts        # existente (sem mudança)
│   ├── get-artist/route.ts       # existente (sem mudança)
│   ├── get-releases/route.ts     # existente (sem mudança)
│   └── get-countries/route.ts    # existente (sem mudança)
├── lib/
│   ├── apple-music-server.ts     # ✅ NOVO — cliente HTTP pro sidecar + R2 check + conversão formato
│   ├── qobuz-dl-server.tsx       # existente (sem mudança)
│   └── ...
├── apple-music/                  # ✅ NOVO — sidecar FastAPI (container separado)
│   ├── Dockerfile                # ✅ Python 3.12-slim + ffmpeg + gamdl
│   ├── requirements.txt          # ✅ gamdl, fastapi, uvicorn, boto3
│   ├── main.py                   # ✅ FastAPI app (search, download+decrypt+upload R2, health)
│   └── cookies/                  # ✅ Bind mount — colocar cookies.txt via SFTP
│       └── .gitkeep
├── config/
│   └── token-countries.ts        # existente (Qobuz, sem mudança)
├── docker-compose.yml            # ✅ MODIFICADO (+apple-music-api service, bind mount cookies)
├── .env                          # ✅ MODIFICADO (+R2 vars) — NÃO no git
├── .env.example                  # ✅ MODIFICADO (+R2 vars vazias, sem dados reais)
├── middleware.ts                  # existente (sem mudança — mesmos endpoints)
└── APPLE_MUSIC_PLAN.md           # este arquivo (no .gitignore)
```

### Setup Cloudflare R2 (manual, uma vez)

1. ✅ **Criar bucket** no Cloudflare Dashboard: `media-cache`
2. ✅ **Custom domain**: `cdn.bryanhifi.dpdns.org` → ativo
3. ✅ **Lifecycle rule** (auto-delete 5 dias): Cloudflare Dashboard > R2 > `media-cache` > Settings > Object lifecycle
4. ✅ **API token** R2 (read/write) → configurado no `.env`

### Deploy na VPS (checklist)

```bash
# 1. Upload cookies via SFTP
# Colocar o arquivo apple_cookies_netscape.txt em:
#   ~/home-server/qobuz-dl/apple-music/cookies/cookies.txt

# 2. Conferir .env na VPS (adicionar R2 vars se não existem)
# R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
# R2_BUCKET_NAME, R2_PUBLIC_URL, R2_ENDPOINT_URL

# 3. Pull + rebuild
cd ~/home-server/qobuz-dl
git pull
docker compose up -d --build
```

### Resumo de mudanças por arquivo

| Arquivo | Status | Mudança |
|---|---|---|
| `app/api/get-music/route.ts` | ✅ | +20 linhas — fallback Apple Music quando Qobuz retorna vazio |
| `app/api/download-music/route.ts` | ✅ | +20 linhas — detecção `apple:` prefix + R2 cache check |
| `lib/apple-music-server.ts` | ✅ | NOVO — ~160 linhas, cliente HTTP sidecar + conversão formato |
| `apple-music/main.py` | ✅ | NOVO — ~280 linhas, FastAPI sidecar (search, download, R2) |
| `apple-music/Dockerfile` | ✅ | NOVO — Python 3.12 + ffmpeg + gamdl |
| `apple-music/requirements.txt` | ✅ | NOVO — gamdl, fastapi, uvicorn, boto3 |
| `docker-compose.yml` | ✅ | +15 linhas — serviço apple-music-api, bind mount, env var |
| `.env` | ✅ | +6 variáveis R2 (não commitado) |
| `.env.example` | ✅ | +6 vars R2 vazias (seguro no repo público) |
| `.gitignore` | ✅ | +1 linha (apple-music/cookies/) |
| `middleware.ts` | — | Sem mudança |
| **Monochrome** | — | **Sem mudança** |
