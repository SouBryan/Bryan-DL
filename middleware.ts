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

    // Only apply to API routes
    if (!pathname.startsWith('/api/')) {
        return NextResponse.next();
    }

    const ip = getClientIp(request);
    const ua = request.headers.get('user-agent');

    // 1. Block known malicious bots
    if (isBlockedBot(ua)) {
        return new NextResponse('Forbidden', { status: 403 });
    }

    // 2. Rate limiting
    if (isRateLimited(ip)) {
        return new NextResponse(JSON.stringify({ error: 'Too many requests' }), {
            status: 429,
            headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
        });
    }

    // 3. Malicious payload detection
    const params = request.nextUrl.searchParams;
    if (containsMaliciousPayload(request.url, params)) {
        console.warn(`[security] Blocked malicious request from ${ip}: ${request.url.slice(0, 200)}`);
        return new NextResponse('Bad Request', { status: 400 });
    }

    // 4. Validate query params for search endpoints
    if (pathname === '/api/get-music') {
        const q = params.get('q');
        if (q && q.length > 500) {
            return new NextResponse(JSON.stringify({ error: 'Query too long' }), { status: 400 });
        }
    }

    return NextResponse.next();
}

export const config = {
    matcher: '/api/:path*',
};
