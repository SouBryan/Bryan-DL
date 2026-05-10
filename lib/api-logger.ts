import { tokenCountriesMap } from '@/config/token-countries';

// ── IP extraction ──────────────────────────────────────────────
export function getClientIp(request: Request): string {
    const h = (name: string) => request.headers.get(name);

    // Cloudflare Tunnel → most reliable
    let ip = h('cf-connecting-ip') || h('x-real-ip') || '';

    // Fallback to X-Forwarded-For (pick first IPv4 if possible)
    if (!ip) {
        const xff = h('x-forwarded-for');
        if (xff) {
            const parts = xff.split(',').map((s) => s.trim());
            const ipv4 = parts.find((p) => /^\d{1,3}(\.\d{1,3}){3}$/.test(p));
            ip = ipv4 || parts[0] || '';
        }
    }

    // Strip IPv6-mapped-IPv4 prefix
    if (ip.startsWith('::ffff:')) ip = ip.slice(7);

    return ip || '?.?.?.?';
}

// ── Browser fingerprint (short UA summary) ─────────────────────
export function getBrowserId(request: Request): string {
    const ua = request.headers.get('user-agent') || '';
    if (!ua) return 'unknown';

    let browser = 'Unknown';
    if (ua.includes('Firefox/')) browser = `Firefox/${ua.match(/Firefox\/(\d+)/)?.[1]}`;
    else if (ua.includes('Edg/')) browser = `Edge/${ua.match(/Edg\/(\d+)/)?.[1]}`;
    else if (ua.includes('OPR/') || ua.includes('Opera/')) browser = `Opera/${(ua.match(/OPR\/(\d+)/) || ua.match(/Opera\/(\d+)/))?.[1]}`;
    else if (ua.includes('Chrome/') && !ua.includes('Edg/')) browser = `Chrome/${ua.match(/Chrome\/(\d+)/)?.[1]}`;
    else if (ua.includes('Safari/') && !ua.includes('Chrome')) browser = `Safari/${ua.match(/Version\/(\d+)/)?.[1] || '?'}`;
    else if (ua.includes('curl')) browser = 'curl';

    let os = '';
    if (ua.includes('Windows')) os = 'Win';
    else if (ua.includes('Android')) os = 'Android';
    else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
    else if (ua.includes('Macintosh') || ua.includes('Mac OS')) os = 'Mac';
    else if (ua.includes('Linux')) os = 'Linux';

    return os ? `${browser} ${os}` : browser;
}

// ── Timestamp DD/MM HH:MM:SS ───────────────────────────────────
export function formatTimestamp(): string {
    const n = new Date();
    const pad = (v: number) => String(v).padStart(2, '0');
    return `${pad(n.getDate())}/${pad(n.getMonth() + 1)} ${pad(n.getHours())}:${pad(n.getMinutes())}:${pad(n.getSeconds())}`;
}

// ── Protocol (https, http) ─────────────────────────────────────
export function getProtocol(request: Request): string {
    const proto = request.headers.get('x-forwarded-proto') || 'http';
    return proto;
}

// ── Truncate path for readability ──────────────────────────────
function truncatePath(url: string, maxLen: number = 90): string {
    try {
        const u = new URL(url);
        const full = u.pathname + u.search;
        return full.length > maxLen ? full.slice(0, maxLen) + '...' : full;
    } catch {
        return url.slice(0, maxLen);
    }
}

// ── Country for a token (reverse lookup) ───────────────────────
export function getCountryForToken(token: string): string {
    if (tokenCountriesMap.length === 0) return '??';
    const entry = tokenCountriesMap.find((t) => t.token === token);
    return entry?.code || '??';
}

// ── Main log function ──────────────────────────────────────────
export function logRequest(
    request: Request,
    status: number,
    durationMs: number,
    tokenSuffix?: string,
    tokenCountry?: string
) {
    const ip = getClientIp(request);
    const ts = formatTimestamp();
    const method = request.method;
    const path = truncatePath(request.url);
    const proto = getProtocol(request);
    const fp = getBrowserId(request);
    const tok = tokenSuffix ? `...${tokenSuffix}` : '------';
    const cc = tokenCountry || '??';

    console.log(`${ip} | ${ts} | ${method} ${path} ${proto} → ${status} (${durationMs}ms) | ${fp} | ${tok} ${cc}`);
}
