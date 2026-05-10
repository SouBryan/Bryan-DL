import { getTokenForCountry, tokenCountriesMap } from '@/config/token-countries';
import { APIOptionProps, QobuzArtist, QobuzSearchResults } from './qobuz-dl';
import { getCountryForToken } from './api-logger';
import axios, { AxiosError } from 'axios';

// Functions only to be used by servers
// Do not import this file into the client

const QOBUZ_ALBUM_URL_REGEX = /https:\/\/(play|open)\.qobuz\.com\/album\/[a-zA-Z0-9]+/;
const QOBUZ_TRACK_URL_REGEX = /https:\/\/(play|open)\.qobuz\.com\/track\/\d+/;
const QOBUZ_ARTIST_URL_REGEX = /https:\/\/(play|open)\.qobuz\.com\/artist\/\d+/;

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

// Track temporarily blocked tokens (token -> unblock timestamp)
const blockedTokens = new Map<string, number>();
const TOKEN_BLOCK_DURATION_MS = 60_000; // block token for 60s after rate limit

let crypto: any;
let SocksProxyAgent: any;
let _AsyncLocalStorage: typeof import('node:async_hooks').AsyncLocalStorage | null = null;
if (typeof window === 'undefined') {
    crypto = await import('node:crypto');
    SocksProxyAgent = (await import('socks-proxy-agent'))['SocksProxyAgent'];
    _AsyncLocalStorage = (await import('node:async_hooks')).AsyncLocalStorage;
}

// Request-scoped context to pass token info from deep server functions back to route handlers
type TokenContext = { suffix: string; country: string };
const tokenContextStore = _AsyncLocalStorage ? new _AsyncLocalStorage<TokenContext>() : null;

export function runWithTokenContext<T>(fn: () => Promise<T>): Promise<T & { _tokenSuffix: string; _tokenCountry: string }> {
    const ctx: TokenContext = { suffix: '', country: '??' };
    if (!tokenContextStore) return fn().then((r) => ({ ...r as any, _tokenSuffix: ctx.suffix, _tokenCountry: ctx.country }));
    return tokenContextStore.run(ctx, async () => {
        const result = await fn();
        return { ...result as any, _tokenSuffix: ctx.suffix, _tokenCountry: ctx.country };
    });
}

function setTokenContext(token: string, country?: string) {
    const store = tokenContextStore?.getStore();
    if (store) {
        store.suffix = token.slice(-6);
        store.country = country || getCountryForToken(token);
    }
}

function getProxyAgent() {
    if (process.env.SOCKS5_PROXY) {
        return new SocksProxyAgent('socks5://' + process.env.SOCKS5_PROXY);
    }
    return undefined;
}

// Status codes that suggest IP-based blocking and warrant rotation
const BLOCKING_STATUS_CODES = new Set([429, 403, 401, 503, 502]);

function isRateLimited(error: unknown): boolean {
    if (error instanceof AxiosError) {
        const status = error.response?.status;
        return status !== undefined && BLOCKING_STATUS_CODES.has(status);
    }
    return false;
}

async function triggerIpRotation(reason: string = 'rate limit'): Promise<void> {
    try {
        const { execSync } = await import('node:child_process');
        execSync('docker restart warp-socks 2>/dev/null', { timeout: 15000 });
        await new Promise((r) => setTimeout(r, 10000));
        console.log(`[warp] IP rotated (reason: ${reason})`);
    } catch {
        console.warn('[warp] Could not trigger IP rotation (not in Docker or no permission)');
    }
}

// Proactive IP rotation every 30 minutes regardless of errors
const PROACTIVE_ROTATION_INTERVAL_MS = 30 * 60 * 1000;
if (typeof window === 'undefined') {
    setInterval(() => {
        triggerIpRotation('scheduled 30min rotation');
    }, PROACTIVE_ROTATION_INTERVAL_MS);
    console.log('[warp] Proactive rotation scheduled every 30 minutes');
}

async function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

async function axiosWithRetry(config: Parameters<typeof axios.get>[1] & { url: string }, retries = MAX_RETRIES): Promise<any> {
    const urlPath = new URL(config.url.includes('?url=') ? decodeURIComponent(config.url.split('?url=')[1] || config.url) : config.url).pathname;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const { url, ...rest } = config;
            const proxyAgent = getProxyAgent();
            const currentToken = rest.headers?.['x-user-auth-token'] as string;
            // Store token info in request-scoped context for the route handler logger
            setTokenContext(currentToken);
            const response = await axios.get(url, {
                ...rest,
                httpAgent: proxyAgent,
                httpsAgent: proxyAgent,
            });
            return response;
        } catch (error) {
            if (isRateLimited(error) && attempt < retries) {
                const oldToken = config.headers?.['x-user-auth-token'] as string;
                const status = (error as AxiosError).response?.status;
                console.warn(`[rate-limit] ${status} on ${urlPath} (attempt ${attempt + 1}/${retries + 1}), rotating token + IP...`);
                // Block current token and pick a different one
                if (oldToken) {
                    markTokenBlocked(oldToken);
                    const newToken = getRandomToken(oldToken);
                    config = { ...config, headers: { ...config.headers, 'x-user-auth-token': newToken } };
                    setTokenContext(newToken);
                }
                await triggerIpRotation(`HTTP ${status} on ${urlPath}`);
                await sleep(RETRY_DELAY_MS * (attempt + 1));
                continue;
            }
            throw error;
        }
    }
}

export function testForRequirements() {
    if (process.env.QOBUZ_APP_ID?.length === 0) throw new Error('Deployment is missing QOBUZ_APP_ID environment variable.');
    if (process.env.QOBUZ_AUTH_TOKENS?.length === 0) throw new Error('Deployment is missing QOBUZ_AUTH_TOKENS environment variable.');
    if (process.env.QOBUZ_SECRET?.length === 0) throw new Error('Deployment is missing QOBUZ_SECRET environment variable.');
    if (process.env.QOBUZ_API_BASE?.length === 0) throw new Error('Deployment is missing QOBUZ_API_BASE environment variable.');
    return true;
}

export function getRandomToken(excludeToken?: string) {
    const allTokens: string[] = tokenCountriesMap.length > 0
        ? tokenCountriesMap.map(t => t.token)
        : JSON.parse(process.env.QOBUZ_AUTH_TOKENS!);
    const now = Date.now();
    // Clean expired blocks
    for (const [t, until] of blockedTokens) {
        if (now > until) blockedTokens.delete(t);
    }
    // Filter out blocked + excluded tokens
    let available = allTokens.filter(t => t !== excludeToken && !blockedTokens.has(t));
    if (available.length === 0) available = allTokens.filter(t => t !== excludeToken);
    if (available.length === 0) available = allTokens;
    return available[Math.floor(Math.random() * available.length)] as string;
}

function markTokenBlocked(token: string) {
    blockedTokens.set(token, Date.now() + TOKEN_BLOCK_DURATION_MS);
    console.log(`[token] Blocked token ...${token.slice(-6)} for ${TOKEN_BLOCK_DURATION_MS / 1000}s (${blockedTokens.size} blocked)`);
}

export async function search(query: string, limit: number = 10, offset: number = 0, options?: APIOptionProps) {
    testForRequirements();
    const { country, ...requestOptions } = options || {};
    const token = country ? getTokenForCountry(country) : getRandomToken();

    // Test if query is a Qobuz URL
    let id: string | null = null;
    let switchTo: string | null = null;
    if (query.trim().match(QOBUZ_ALBUM_URL_REGEX)) {
        id = query.trim().match(QOBUZ_ALBUM_URL_REGEX)![0].replace('https://open', '').replace('https://play', '').replace('.qobuz.com/album/', '');
        switchTo = 'albums';
    } else if (query.trim().match(QOBUZ_TRACK_URL_REGEX)) {
        id = query.trim().match(QOBUZ_TRACK_URL_REGEX)![0].replace('https://open', '').replace('https://play', '').replace('.qobuz.com/track/', '');
        switchTo = 'tracks';
    } else if (query.trim().match(QOBUZ_ARTIST_URL_REGEX)) {
        id = query.trim().match(QOBUZ_ARTIST_URL_REGEX)![0].replace('https://open', '').replace('https://play', '').replace('.qobuz.com/artist/', '');
        switchTo = 'artists';
    }
    // Else, search Qobuz database for the song
    const url = new URL(process.env.QOBUZ_API_BASE + 'catalog/search');
    url.searchParams.append('query', id || query);
    url.searchParams.append('limit', limit.toString());
    url.searchParams.append('offset', offset.toString());
    const response = await axiosWithRetry({
        url: process.env.CORS_PROXY ? process.env.CORS_PROXY + encodeURIComponent(url.toString()) : url.toString(),
        headers: {
            'x-app-id': process.env.QOBUZ_APP_ID!,
            'x-user-auth-token': token,
            'User-Agent': process.env.CORS_PROXY ? 'Qobuz-DL' : undefined
        },
        ...requestOptions
    });
    return {
        ...response.data,
        switchTo
    } as QobuzSearchResults;
}

export async function getArtist(artistId: string, options?: APIOptionProps): Promise<QobuzArtist | null> {
    testForRequirements();
    const { country, ...requestOptions } = options || {};
    const token = country ? getTokenForCountry(country) : getRandomToken();

    const url = new URL(process.env.QOBUZ_API_BASE + '/artist/page');
    return (
        await axiosWithRetry({
            url: process.env.CORS_PROXY ? process.env.CORS_PROXY + encodeURIComponent(url.toString()) : url.toString(),
            params: { artist_id: artistId, sort: 'release_date' },
            headers: {
                'x-app-id': process.env.QOBUZ_APP_ID!,
                'x-user-auth-token': token,
                'User-Agent': process.env.CORS_PROXY ? 'Qobuz-DL' : undefined
            },
            ...requestOptions
        })
    ).data;
}

export async function getArtistReleases(
    artist_id: string,
    release_type: string = 'album',
    limit: number = 10,
    offset: number = 0,
    track_size: number = 1000,
    options?: APIOptionProps
) {
    testForRequirements();
    const { country, ...requestOptions } = options || {};
    const token = country ? getTokenForCountry(country) : getRandomToken();

    const url = new URL(process.env.QOBUZ_API_BASE + 'artist/getReleasesList');
    url.searchParams.append('artist_id', artist_id);
    url.searchParams.append('release_type', release_type);
    url.searchParams.append('limit', limit.toString());
    url.searchParams.append('offset', offset.toString());
    url.searchParams.append('track_size', track_size.toString());
    url.searchParams.append('sort', 'release_date');
    const response = await axiosWithRetry({
        url: process.env.CORS_PROXY ? process.env.CORS_PROXY + encodeURIComponent(url.toString()) : url.toString(),
        headers: {
            'x-app-id': process.env.QOBUZ_APP_ID!,
            'x-user-auth-token': token,
            'User-Agent': process.env.CORS_PROXY ? 'Qobuz-DL' : undefined
        },
        ...requestOptions
    });
    return response.data;
}

export async function getAlbumInfo(album_id: string, options?: APIOptionProps) {
    testForRequirements();
    const { country, ...requestOptions } = options || {};
    const token = country ? getTokenForCountry(country) : getRandomToken();

    const url = new URL(process.env.QOBUZ_API_BASE + 'album/get');
    url.searchParams.append('album_id', album_id);
    url.searchParams.append('extra', 'track_ids');
    const response = await axiosWithRetry({
        url: process.env.CORS_PROXY ? process.env.CORS_PROXY + encodeURIComponent(url.toString()) : url.toString(),
        headers: {
            'x-app-id': process.env.QOBUZ_APP_ID!,
            'x-user-auth-token': token,
            'User-Agent': process.env.CORS_PROXY ? 'Qobuz-DL' : undefined
        },
        ...requestOptions
    });
    return response.data;
}

export async function getDownloadURL(trackID: number, quality: string, options?: APIOptionProps) {
    testForRequirements();
    const { country, ...requestOptions } = options || {};
    const token = country ? getTokenForCountry(country) : getRandomToken();

    const timestamp = Math.floor(new Date().getTime() / 1000);
    const r_sig = `trackgetFileUrlformat_id${quality}intentstreamtrack_id${trackID}${timestamp}${process.env.QOBUZ_SECRET}`;
    const r_sig_hashed = crypto.createHash('md5').update(r_sig).digest('hex');
    const url = new URL(process.env.QOBUZ_API_BASE + 'track/getFileUrl');
    url.searchParams.append('format_id', quality);
    url.searchParams.append('intent', 'stream');
    url.searchParams.append('track_id', trackID.toString());
    url.searchParams.append('request_ts', timestamp.toString());
    url.searchParams.append('request_sig', r_sig_hashed);
    const response = await axiosWithRetry({
        url: process.env.CORS_PROXY ? process.env.CORS_PROXY + encodeURIComponent(url.toString()) : url.toString(),
        headers: {
            'x-app-id': process.env.QOBUZ_APP_ID!,
            'x-user-auth-token': token,
            'User-Agent': process.env.CORS_PROXY ? 'Qobuz-DL' : undefined
        },
        ...requestOptions
    });
    return response.data.url;
}
