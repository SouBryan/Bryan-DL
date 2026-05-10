import net from 'net';
import { NextResponse } from 'next/server';
import { getClientIp } from '@/lib/api-logger';

const IPGATE_SOCKET = process.env.IPGATE_SOCKET || '/tmp/uds_check.sock';

/**
 * Check if an IP is blocked by IPGate (FireHOL blocklists).
 * Returns true if blocked, false if allowed or if IPGate is unreachable.
 * Fails open (returns false) so the service keeps working if IPGate is down.
 */
export async function isIpBlocked(ip: string): Promise<boolean> {
    if (!ip || ip === 'unknown' || ip === '?.?.?.?') return false;

    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            client.destroy();
            resolve(false); // fail open
        }, 500);

        const client = net.createConnection({ path: IPGATE_SOCKET }, () => {
            client.write(`${ip}\n`);
        });

        let data = '';
        client.on('data', (chunk) => {
            data += chunk.toString();
            clearTimeout(timeout);
            client.destroy();
            resolve(data.trim() === '1');
        });

        client.on('error', () => {
            clearTimeout(timeout);
            resolve(false); // fail open
        });
    });
}

/**
 * Check request IP against IPGate. Returns a 403 response if blocked, or null if allowed.
 */
export async function checkIpGate(request: Request): Promise<NextResponse | null> {
    const ip = getClientIp(request);
    if (await isIpBlocked(ip)) {
        console.warn(`[ipgate] Blocked request from ${ip}`);
        return new NextResponse('Forbidden', { status: 403 });
    }
    return null;
}
