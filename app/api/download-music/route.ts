import { NextRequest, NextResponse } from 'next/server';
import { getDownloadURL, runWithTokenContext } from '@/lib/qobuz-dl-server';
import { downloadAppleMusicTrack } from '@/lib/apple-music-server';
import { logRequest } from '@/lib/api-logger';
import { checkIpGate } from '@/lib/ipgate';
import z from 'zod';

const downloadParamsSchema = z.object({
    track_id: z.string().min(1, 'Track ID is required'),
    quality: z.enum(['27', '7', '6', '5']).default('27')
});

export async function GET(request: NextRequest) {
    const blocked = await checkIpGate(request);
    if (blocked) return blocked;
    const country = request.headers.get('Token-Country');
    const params = Object.fromEntries(new URL(request.url).searchParams.entries());
    const start = Date.now();
    try {
        const { track_id, quality } = downloadParamsSchema.parse(params);

        // Apple Music track (prefixed with "apple:")
        if (track_id.startsWith('apple:')) {
            const appleId = track_id.replace('apple:', '');
            const url = await downloadAppleMusicTrack(appleId);
            if (!url) {
                logRequest(request, 404, Date.now() - start);
                return new NextResponse(
                    JSON.stringify({ success: false, error: 'Apple Music track not found or download failed' }),
                    { status: 404 }
                );
            }
            const res = new NextResponse(JSON.stringify({ success: true, data: { url } }), { status: 200 });
            logRequest(request, 200, Date.now() - start, undefined, undefined);
            return res;
        }

        // Qobuz track (numeric ID)
        const numericId = parseInt(track_id);
        if (isNaN(numericId) || numericId < 0) {
            throw new Error('Invalid Qobuz track ID');
        }
        const result = await runWithTokenContext(async () => {
            const url = await getDownloadURL(numericId, quality, country ? { country } : {});
            return { url };
        });
        const { _tokenSuffix, _tokenCountry, url } = result;
        const res = new NextResponse(JSON.stringify({ success: true, data: { url } }), { status: 200 });
        logRequest(request, 200, Date.now() - start, _tokenSuffix, _tokenCountry);
        return res;
    } catch (error: any) {
        logRequest(request, 400, Date.now() - start);
        return new NextResponse(
            JSON.stringify({
                success: false,
                error: error?.errors || error.message || 'An error occurred parsing the request.'
            }),
            { status: 400 }
        );
    }
}
