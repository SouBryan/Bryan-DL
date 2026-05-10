import { NextRequest, NextResponse } from 'next/server';
import { getDownloadURL, runWithTokenContext } from '@/lib/qobuz-dl-server';
import { logRequest } from '@/lib/api-logger';
import { checkIpGate } from '@/lib/ipgate';
import z from 'zod';

const downloadParamsSchema = z.object({
    track_id: z.preprocess((a) => parseInt(a as string), z.number().min(0, 'ID must be 0 or greater').default(1)),
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
        const result = await runWithTokenContext(async () => {
            const url = await getDownloadURL(track_id, quality, country ? { country } : {});
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
