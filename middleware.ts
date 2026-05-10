import { NextRequest, NextResponse } from 'next/server';

// --- CORS headers (needed for Monochrome and other cross-origin clients) ---
const CORS_HEADERS: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Token-Country',
};

function corsResponse(body: string | null, status: number, extra?: Record<string, string>): NextResponse {
    return new NextResponse(body, { status, headers: { ...CORS_HEADERS, ...extra } });
}

// --- Rate Limiting (in-memory, per IP) ---
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 60; // 60 requests per minute per IP

// --- WHITELIST: only these paths are valid app routes ---
// Everything else gets 404 immediately (no SSR rendering = no returnNaN/let exploits)
const VALID_PATHS = [
    /^\/$/,                         // home page
    /^\/api\/(get-music|download-music|get-album|get-artist|get-releases|get-countries)(\/|$)/,
    /^\/manifest/,                  // PWA manifest
    /^\/flac\//,                    // public/flac
    /^\/logo\//,                    // public/logo
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
    '2601:281:c800:1ab0:cca1:36cc:4524:60e7', // Mass album downloader bot (Opera)
]);

function getClientIp(request: NextRequest): string {
    return (
        request.headers.get('cf-connecting-ip') ||
        request.headers.get('x-real-ip') ||
        request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        'unknown'
    );
}

function isRateLimited(ip: string): boolean {
    const now = Date.now();
    const entry = rateLimitMap.get(ip);
    if (!entry || now > entry.resetAt) {
        rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
        return false;
    }
    entry.count++;
    return entry.count > RATE_LIMIT_MAX_REQUESTS;
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

    // Skip Next.js internals and static assets — always allow
    if (
        pathname.startsWith('/_next/') ||
        pathname.startsWith('/favicon') ||
        pathname.match(/\.(ico|png|jpg|jpeg|svg|webp|css|js|woff2?|ttf|map)$/)
    ) {
        return NextResponse.next();
    }

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
        return corsResponse(null, 204);
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
        return corsResponse('Not Found', 404);
    }

    // 3. Block known malicious bots (API routes only — pages need browsers)
    if (pathname.startsWith('/api/') && isBlockedBot(ua)) {
        return corsResponse('Forbidden', 403);
    }

    // 4. Rate limiting
    if (isRateLimited(ip)) {
        return corsResponse(JSON.stringify({ error: 'Too many requests' }), 429, {
            'Content-Type': 'application/json',
            'Retry-After': '60',
        });
    }

    // 5. Malicious payload detection (URL + query params)
    const params = request.nextUrl.searchParams;
    if (containsMaliciousPayload(request.url, params)) {
        console.warn(`[security] Blocked malicious payload from ${ip}: ${request.url.slice(0, 200)}`);
        return corsResponse('Bad Request', 400);
    }

    // 6. Validate query params for search endpoints
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
