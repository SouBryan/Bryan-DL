import { NextRequest, NextResponse } from 'next/server';
import { getAlbumInfo, runWithTokenContext } from '@/lib/qobuz-dl-server';
import { logRequest } from '@/lib/api-logger';
import { checkIpGate } from '@/lib/ipgate';
import z from 'zod';

const albumInfoParamsSchema = z.object({
    album_id: z.string().min(1, 'ID is required')
});

export async function GET(request: NextRequest) {
    const blocked = await checkIpGate(request);
    if (blocked) return blocked;
    const country = request.headers.get('Token-Country');
    const params = Object.fromEntries(new URL(request.url).searchParams.entries());
    const start = Date.now();
    try {
        const { album_id } = albumInfoParamsSchema.parse(params);
        const result = await runWithTokenContext(async () => {
            const data = await getAlbumInfo(album_id, country ? { country } : {});
            return { data };
        });
        const { _tokenSuffix, _tokenCountry, data } = result;
        const res = new NextResponse(JSON.stringify({ success: true, data }), { status: 200 });
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
