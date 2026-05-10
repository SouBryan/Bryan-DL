import { NextRequest, NextResponse } from 'next/server';

// --- Rate Limiting (in-memory, per IP) ---
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 60; // 60 requests per minute per IP

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
    /\bopen\s*\(\s*['"`]let/i,
];

// Paths that are clearly attack probes (not valid app routes)
const BLOCKED_PATHS = [
    /^\/let$/i,
    /\/let$/i, // /dev/let, /app/let, /var/let, /etc/let
    /^\/\.env/i,
    /^\/wp-/i, // WordPress probes
    /^\/admin/i,
    /^\/phpmyadmin/i,
    /^\/cgi-bin/i,
    /^\/\.git/i,
    /^\/config\.(php|yml|yaml|json|xml|ini)/i,
    /^\/actuator/i, // Spring Boot probes
    /^\/debug/i,
    /^\/console/i,
];

// Bot user agents to block completely
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

    // Skip static assets and Next.js internals
    if (
        pathname.startsWith('/_next/') ||
        pathname.startsWith('/favicon') ||
        pathname.match(/\.(ico|png|jpg|jpeg|svg|css|js|woff2?|ttf|map)$/)
    ) {
        return NextResponse.next();
    }

    const ip = getClientIp(request);
    const ua = request.headers.get('user-agent');

    // 1. Block known attack probe paths
    if (BLOCKED_PATHS.some((pattern) => pattern.test(pathname))) {
        return new NextResponse('Not Found', { status: 404 });
    }

    // 2. Block known malicious bots (API routes only — pages need browsers)
    if (pathname.startsWith('/api/') && isBlockedBot(ua)) {
        return new NextResponse('Forbidden', { status: 403 });
    }

    // 3. Rate limiting
    if (isRateLimited(ip)) {
        return new NextResponse(JSON.stringify({ error: 'Too many requests' }), {
            status: 429,
            headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
        });
    }

    // 4. Malicious payload detection (URL + query params + pathname)
    const params = request.nextUrl.searchParams;
    if (containsMaliciousPayload(request.url, params)) {
        console.warn(`[security] Blocked malicious request from ${ip}: ${request.url.slice(0, 200)}`);
        return new NextResponse('Bad Request', { status: 400 });
    }

    // 5. Validate query params for search endpoints
    if (pathname === '/api/get-music') {
        const q = params.get('q');
        if (q && q.length > 500) {
            return new NextResponse(JSON.stringify({ error: 'Query too long' }), { status: 400 });
        }
    }

    return NextResponse.next();
}

export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
