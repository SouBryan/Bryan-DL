import { NextResponse } from 'next/server';
import { getAppleMusicHealth } from '@/lib/apple-music-server';

export async function GET() {
    const health = await getAppleMusicHealth();
    if (!health || !Array.isArray(health.accounts)) {
        return NextResponse.json({ lossless: false });
    }
    const hasWrapper = health.accounts.some(
        (acc: { uses_wrapper?: boolean }) => acc.uses_wrapper === true
    );
    return NextResponse.json({ lossless: hasWrapper });
}
