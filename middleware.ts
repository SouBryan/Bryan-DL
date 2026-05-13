import { NextRequest, NextResponse } from 'next/server';

// --- CORS headers (needed for Monochrome and other cross-origin clients) ---
const CORS_HEADERS: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Token-Country, Music-Source',
};

function corsResponse(body: string | null, status: number, extra?: Record<string, string>): NextResponse {
    return new NextResponse(body, { status, headers: { ...CORS_HEADERS, ...extra } });
}

// --- WHITELIST: only these paths are valid app routes ---
// Everything else gets 404 immediately (no SSR rendering = no returnNaN/let exploits)
const VALID_PATHS = [
    /^\/$/,                         // home page
    /^\/api\/(get-music|download-music|get-album|get-artist|get-releases|get-countries|get-apple-capabilities)(\/|$)/,
    /^\/manifest/,                  // PWA manifest
    /^\/flac\//,                    // public/flac
    /^\/logo\//,                    // public/logo
    /^\/_next\/webpack-hmr/,        // HMR (dev only, harmless in prod)
];

// --- Malicious Payload Detection ---
const MALICIOUS_PATTERNS = [
    /\beval\s*\(/i,
    /\bFunction\s*\(/i,
    /\brequire\s*\(/i,
    /\bimport\s*\(/i,
    /\b__proto__\b/i,
    /\bconstructor\s*\[/i,
    /\bprocess\.env/i,
    /\bchild_process/i,
    /\bexec\s*\(/i,
    /\bspawn\s*\(/i,
    /\.\.\/|\.\.\\/, // path traversal
    /<script/i,
    /javascript:/i,
    /\bon\w+\s*=/i, // event handlers
    /\breturnNaN\b/i,
];

// Bot user agents to block on API routes
const BLOCKED_UA_PATTERNS = [
    /sqlmap/i,
    /nikto/i,
    /nmap/i,
    /masscan/i,
    /zgrab/i,
    /gobuster/i,
    /dirbuster/i,
    /nuclei/i,
    /httpx/i,
    /scrapy/i,
    /python-requests\/[0-9]/i,
    /go-http-client/i,
    /java\/[0-9]/i,
];

// Hardcoded blocked IPs (known attackers)
const BLOCKED_IPS = new Set([
    '2600:387:15:3613::1', // Residential proxy bot - returnNaN/let attacks
    '45.94.31.32', // WordPress scanner bot - 1337 Services GmbH NL (AbuseIPDB flagged)
    '45.205.1.43', // SSR injection bot - POST / with returnNaN payload, rotating UAs
    '212.113.98.30', // Cryptominer dropper - POST / with base64 bash payload downloading from 78.153.140.16
    '34.246.163.208', // WordPress scanner bot - Tentou por muito tempo varios endpoints, como .env e outros
    '35.240.247.11', // WordPress scanner bot - (AbuseIPDB flagged)
    '164.92.178.95', // .env & docker scanner bot - DigitalOcean droplet
    '193.32.162.28', // Tentou acessar uma vez /api/route - provavelmente um scanner de vulnerabilidades (AbuseIPDB flagged)
]);

function getClientIp(request: NextRequest): string {
    return (
        request.headers.get('cf-connecting-ip') ||
        request.headers.get('x-real-ip') ||
        request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        'unknown'
    );
}

function containsMaliciousPayload(url: string, params: URLSearchParams): boolean {
    const fullString = url + ' ' + Array.from(params.values()).join(' ');
    return MALICIOUS_PATTERNS.some((pattern) => pattern.test(fullString));
}

function isBlockedBot(ua: string | null): boolean {
    if (!ua) return true; // No UA = bot
    return BLOCKED_UA_PATTERNS.some((pattern) => pattern.test(ua));
}

export function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // Skip only static assets — matcher already excludes _next/static and _next/image
    // DO NOT skip all /_next/ — attackers exploit /_next/data/BUILD_ID/returnNaN.json
    if (
        pathname.startsWith('/favicon') ||
        pathname.match(/\.(ico|png|jpg|jpeg|svg|webp|css|woff2?|ttf|map)$/)
    ) {
        return NextResponse.next();
    }

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
        return corsResponse(null, 204);
    }

    // Block non-GET/HEAD methods on non-API routes (POST / is used for SSR injection)
    if (!pathname.startsWith('/api/') && request.method !== 'GET' && request.method !== 'HEAD') {
        return corsResponse('Method Not Allowed', 405);
    }

    const ip = getClientIp(request);
    const ua = request.headers.get('user-agent');

    // 1. Block hardcoded attacker IPs
    if (BLOCKED_IPS.has(ip)) {
        return corsResponse('Forbidden', 403);
    }

    // 2. WHITELIST — block any path that isn't a known valid route
    //    This kills returnNaN/let/directory-traversal attacks at the gate
    if (!VALID_PATHS.some((pattern) => pattern.test(pathname))) {
        console.warn(`[middleware] Blocked: ${ip} → ${pathname}`);
        return corsResponse('Not Found', 404);
    }

    // 3. Block known malicious bots (API routes only — pages need browsers)
    if (pathname.startsWith('/api/') && isBlockedBot(ua)) {
        return corsResponse('Forbidden', 403);
    }

    // 4. Malicious payload detection (URL + query params)
    const params = request.nextUrl.searchParams;
    if (containsMaliciousPayload(request.url, params)) {
        return corsResponse('Bad Request', 400);
    }

    // 5. Validate query params for search endpoints
    if (pathname === '/api/get-music') {
        const q = params.get('q');
        if (q && q.length > 500) {
            return corsResponse(JSON.stringify({ error: 'Query too long' }), 400, {
                'Content-Type': 'application/json',
            });
        }
    }

    // Pass through — add CORS headers to the response
    const response = NextResponse.next();
    for (const [key, value] of Object.entries(CORS_HEADERS)) {
        response.headers.set(key, value);
    }
    return response;
}

export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
