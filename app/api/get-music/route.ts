import { NextRequest, NextResponse } from 'next/server';
import { search, runWithTokenContext } from '@/lib/qobuz-dl-server';
import { searchAppleMusic, extractSongsFromAppleResponse, convertAppleMusicToQobuzFormat } from '@/lib/apple-music-server';
import { logRequest } from '@/lib/api-logger';
import { checkIpGate } from '@/lib/ipgate';
import z from 'zod';

const searchParamsSchema = z.object({
    q: z.string().min(1, 'Query is required'),
    offset: z.preprocess((a) => parseInt(a as string), z.number().max(1000, 'Offset must be less than 1000').min(0, 'Offset must be 0 or greater').default(0))
});

export async function GET(request: NextRequest) {
    const blocked = await checkIpGate(request);
    if (blocked) return blocked;
    const country = request.headers.get('Token-Country');
    const params = Object.fromEntries(new URL(request.url).searchParams.entries());
    const start = Date.now();
    try {
        const { q, offset } = searchParamsSchema.parse(params);
        const result = await runWithTokenContext(() => search(q, 10, offset, country ? { country } : {}));
        const { _tokenSuffix, _tokenCountry, ...searchResults } = result;

        // Apple Music fallback: if Qobuz returned no tracks, try Apple Music
        const qobuzTrackCount = searchResults?.tracks?.items?.length || 0;
        if (qobuzTrackCount === 0) {
            try {
                const appleResponse = await searchAppleMusic(q, 10);
                const appleSongs = extractSongsFromAppleResponse(appleResponse);
                if (appleSongs.length > 0) {
                    const appleResults = convertAppleMusicToQobuzFormat(appleSongs);
                    const merged = { ...searchResults, tracks: appleResults.tracks };
                    const res = new NextResponse(JSON.stringify({ success: true, data: merged }), { status: 200 });
                    logRequest(request, 200, Date.now() - start, _tokenSuffix, _tokenCountry);
                    return res;
                }
            } catch (appleErr) {
                console.error('[get-music] Apple Music fallback failed:', appleErr);
                // Continue with empty Qobuz results
            }
        }

        const res = new NextResponse(JSON.stringify({ success: true, data: searchResults }), { status: 200 });
        logRequest(request, 200, Date.now() - start, _tokenSuffix, _tokenCountry);
        return res;
    } catch (error: any) {
        const status = error?.response?.status || 400;
        const errMsg = error?.errors || error?.response?.data || error.message || 'An error occurred parsing the request.';
        console.error(`[get-music] Error: ${JSON.stringify(errMsg)}`);
        logRequest(request, status, Date.now() - start);
        return new NextResponse(
            JSON.stringify({
                success: false,
                error: errMsg
            }),
            { status }
        );
    }
}
