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

## Fase 1 — Sidecar FastAPI (Apple Music Bridge)

**Objetivo**: Criar o serviço Python que o Next.js vai chamar via HTTP interno. O sidecar faz **busca + download + decrypt** e serve áudio limpo.

### 1.1 — Criar `apple-music/main.py` (FastAPI)

Serviço HTTP interno (não exposto ao público):

```
Endpoints:
  GET  /search?term=...&limit=10          → JSON com resultados de busca
  GET  /download/{song_id}                 → Stream HTTP do arquivo .m4a decriptado
  GET  /album/{album_id}                   → JSON com detalhes do álbum
  GET  /artist/{artist_id}                 → JSON com detalhes do artista
  GET  /health                             → JSON com {status, subscription, storefront}
  POST /refresh-cookies                    → Força refresh dos cookies
```

**Endpoint `/download/{song_id}` — fluxo detalhado:**
1. Recebe song_id da Apple Music
2. Usa gamdl para obter media info (webplayback → stream URL + decryption key)
3. Usa gamdl `downloader.download()` para baixar HLS + decriptar → arquivo `.m4a` temp
4. Upload do `.m4a` limpo para Cloudflare R2 (bucket `apple-music-cache`, key `apple/{song_id}.m4a`)
5. Retorna JSON: `{ "url": "https://cdn.bryanhifi.dpdns.org/apple/{song_id}.m4a" }`
6. Deleta arquivo temp local

- [ ] Inicializar gamdl com cookies do volume Docker
- [ ] Implementar cada endpoint
- [ ] Upload para R2 via boto3/S3 API (R2 é S3-compatível)
- [ ] Diretório temp para processamento (`/tmp/apple-music-processing/`)
- [ ] R2 lifecycle rule: auto-delete após 5 dias
- [ ] Error handling com status codes HTTP (200, 404, 401, 429)

### 1.2 — Multi-storefront (multi-país)

Mesma lógica do Qobuz: múltiplos tokens de países diferentes.

```env
# .env
APPLE_MUSIC_ACCOUNTS=[
  {"storefront":"us","email":"...","password":"..."},
  {"storefront":"jp","email":"...","password":"..."},
  {"storefront":"gb","email":"...","password":"..."}
]
```

- [ ] Cada conta gera um par `(devToken, media-user-token)` para seu storefront
- [ ] O bridge mantém instâncias gamdl por storefront
- [ ] Storefront `jp` é crítico — é o principal caso de uso (músicas japonesas)

### 1.3 — Cookie refresh automático

O `media-user-token` expira. O `main.py` do Discord faz o login completo via SRP.

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

## Fase 2 — Camada TypeScript (integração Next.js)

**Objetivo**: Integrar o sidecar FastAPI (Fase 1) nos endpoints existentes do Next.js. O Monochrome **não é tocado** — tudo é transparente.

### 2.1 — Criar `lib/apple-music-server.ts`

Cliente HTTP TypeScript que chama o sidecar:

- [ ] `searchAppleMusic(term, limit, storefront)` → resultados **já convertidos para formato Qobuz**
- [ ] `downloadAppleMusicTrack(songId)` → URL pública do R2 (string) ou null se falhar
- [ ] Checa R2 antes de chamar sidecar (HEAD request no objeto)
- [ ] Conversão Apple Music → formato `QobuzSearchResults` / `QobuzTrack`:
  - `media_id` → `track_id` (prefixado com `apple:`)
  - `attributes.name` → `title`
  - `attributes.artistName` → `performer.name`
  - `attributes.albumName` → `album.title`
  - `attributes.durationInMillis` → `duration`
  - `attributes.artwork.url` → `album.image`
  - etc.
- [ ] Token context (AsyncLocalStorage) para logging
- [ ] Retry com backoff (mesma lógica do `axiosWithRetry` do Qobuz)

### 2.3 — Modificar rotas existentes (fallback transparente)

**Nenhuma rota nova é criada.** Os endpoints existentes ganham fallback:

#### `/api/get-music/route.ts`

```typescript
// Fluxo atual:
const qobuzResults = await search(q, 10, offset);
return qobuzResults;

// Fluxo novo:
const qobuzResults = await search(q, 10, offset);
if (qobuzResults.tracks.items.length === 0) {
    // Fallback: buscar na Apple Music e converter pro formato Qobuz
    const appleResults = await searchAppleMusic(q, 10);
    return mergeResults(qobuzResults, appleResults);
}
return qobuzResults;
```

- [ ] Modificar `app/api/get-music/route.ts` com fallback Apple Music
- [ ] A resposta continua no formato `QobuzSearchResults` — Monochrome não percebe
- [ ] Tracks Apple Music têm `track_id` prefixado: `"apple:1624945512"`

#### `/api/download-music/route.ts`

```typescript
// Fluxo novo:
const { track_id } = params;
if (typeof track_id === 'string' && track_id.startsWith('apple:')) {
    const appleId = track_id.replace('apple:', '');
    // 1. Checa cache R2
    // 2. Se não existe: chama sidecar → download+decrypt → upload R2
    // 3. Retorna URL do R2 (formato idêntico ao Qobuz)
    const url = await downloadAppleMusicTrack(appleId);
    return NextResponse.json({ success: true, data: { url } });
} else {
    // fluxo Qobuz existente (sem mudança)
}
```

- [ ] Modificar `app/api/download-music/route.ts` com detecção de source
- [ ] Se `track_id` começa com `apple:` → checa R2 cache, se miss chama sidecar
- [ ] Se numérico puro → fluxo Qobuz existente (sem mudança)
- [ ] Resposta: `{ success: true, data: { url: "https://cdn.bryanhifi.dpdns.org/apple/XXX.m4a" } }`
- [ ] Formato **idêntico ao Qobuz** — confirmado no código do Monochrome (`getQobuzStreamUrl`, L1774-1797)
- [ ] Latência: ~3-8s (1º request) / instantâneo (cache hit R2)

### 2.4 — Middleware update

- [ ] Não precisa de rotas novas na whitelist (usamos os mesmos endpoints)
- [ ] Não precisa de proxy HLS — o sidecar faz download+decrypt internamente

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

## Ordem de Execução Recomendada

```
Fase 0 ✅ CONCLUÍDA  →  Fase 1 (sidecar FastAPI + R2)  →  Fase 2 (Next.js integration)  →  Fase 3 (Docker deploy + R2 setup)
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

## Estrutura de Arquivos Final (projeção)

```
qobuz-dl/
├── app/api/
│   ├── download-music/route.ts   # MODIFICADO (+ detecção apple: prefix + R2 cache)
│   ├── get-music/route.ts        # MODIFICADO (+ fallback Apple Music)
│   ├── get-album/route.ts        # existente (sem mudança)
│   ├── get-artist/route.ts       # existente (sem mudança)
│   ├── get-releases/route.ts     # existente (sem mudança)
│   └── get-countries/route.ts    # existente (sem mudança)
├── lib/
│   ├── apple-music-server.ts     # NOVO — cliente HTTP pro sidecar + R2 check + conversão formato
│   ├── r2-client.ts              # NOVO — cliente S3/R2 (HEAD check + upload)
│   ├── qobuz-dl-server.tsx       # existente (sem mudança)
│   └── ...
├── apple-music/                  # NOVO — sidecar FastAPI (container separado)
│   ├── Dockerfile
│   ├── requirements.txt          # gamdl, fastapi, uvicorn, boto3
│   ├── main.py                   # FastAPI app (search, download+decrypt+upload R2, health)
│   ├── auth.py                   # Login SRP (adaptado do main.py do Discord)
│   └── cookies/                  # Volume Docker: cookies por storefront
│       ├── us.txt
│       ├── jp.txt
│       └── gb.txt
├── config/
│   └── token-countries.ts        # existente (Qobuz, sem mudança)
├── docker-compose.yml            # MODIFICADO (+apple-music-api service)
├── middleware.ts                  # existente (sem mudança — mesmos endpoints)
└── APPLE_MUSIC_PLAN.md           # este arquivo
```

### Setup Cloudflare R2 (manual, uma vez)

1. **Criar bucket** no Cloudflare Dashboard: `apple-music-cache`
2. **Custom domain**: `r2.bryanhifi.dpdns.org` → apontar pro bucket (Dashboard > R2 > Settings > Public Access > Custom Domain)
3. **Lifecycle rule** via S3 API ou Dashboard:
   ```json
   {
     "Rules": [{
       "ID": "auto-delete-5-days",
       "Status": "Enabled",
       "Expiration": { "Days": 5 }
     }]
   }
   ```
4. **API token** com permissão R2 (read/write) → `.env`: ✅ CONFIGURADO
   ```env
   R2_ACCOUNT_ID=4c37251dab5d9850c7bbdfb85ea0ea7a
   R2_ACCESS_KEY_ID=***
   R2_SECRET_ACCESS_KEY=***
   R2_BUCKET_NAME=media-cache
   R2_PUBLIC_URL=https://cdn.bryanhifi.dpdns.org
   R2_ENDPOINT_URL=https://4c37251dab5d9850c7bbdfb85ea0ea7a.r2.cloudflarestorage.com
   ```

### Resumo de mudanças por arquivo

| Arquivo | Mudança |
|---|---|
| `app/api/get-music/route.ts` | +20 linhas — fallback Apple Music quando Qobuz retorna vazio |
| `app/api/download-music/route.ts` | +15 linhas — detecção `apple:` prefix + R2 cache check |
| `lib/apple-music-server.ts` | NOVO — ~150 linhas, cliente HTTP sidecar + conversão formato |
| `lib/r2-client.ts` | NOVO — ~50 linhas, HEAD check + upload R2 via S3 API |
| `apple-music/*` | NOVO — sidecar FastAPI (~350 linhas total, inclui R2 upload) |
| `docker-compose.yml` | +15 linhas — novo serviço |
| `.env` | +4 variáveis Apple Music + 5 variáveis R2 |
| `middleware.ts` | Sem mudança |
| **Monochrome** | **Sem mudança** |
