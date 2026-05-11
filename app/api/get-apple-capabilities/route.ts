import { NextRequest, NextResponse } from 'next/server';
import { getAppleMusicHealth } from '@/lib/apple-music-server';

export async function GET(request: NextRequest) {
    const health = await getAppleMusicHealth();
    if (!health) {
        return NextResponse.json({
            available: false,
            lossless: false,
            codec: null,
        });
    }
    return NextResponse.json({
        available: true,
        lossless: health.lossless_available ?? false,
        codec: health.codec ?? 'aac-legacy',
        storefront: health.storefront,
    });
}
