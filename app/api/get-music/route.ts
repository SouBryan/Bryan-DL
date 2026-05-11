import { NextRequest, NextResponse } from 'next/server';
import { search, runWithTokenContext } from '@/lib/qobuz-dl-server';
import { searchAppleMusic, lookupAppleMusicByIsrc, extractSongsFromAppleResponse, convertAppleMusicToQobuzFormat } from '@/lib/apple-music-server';
import { logRequest } from '@/lib/api-logger';
import { checkIpGate } from '@/lib/ipgate';
import z from 'zod';

const searchParamsSchema = z.object({
    q: z.string().min(1, 'Query is required'),
    offset: z.preprocess((a) => (a != null && a !== '') ? parseInt(a as string) : undefined, z.number().max(1000, 'Offset must be less than 1000').min(0, 'Offset must be 0 or greater').default(0))
});

export async function GET(request: NextRequest) {
    const blocked = await checkIpGate(request);
    if (blocked) return blocked;
    const country = request.headers.get('Token-Country');
    const params = Object.fromEntries(new URL(request.url).searchParams.entries());
    const start = Date.now();
    try {
        const { q, offset } = searchParamsSchema.parse(params);

        // Detect ISRC pattern (2 letter country + 3 alphanum registrant + 2 digit year + 5 digit designation)
        const isIsrc = /^[A-Z]{2}[A-Z0-9]{3}\d{2}\d{5}$/i.test(q);

        // Search Qobuz and Apple Music in parallel
        const [qobuzResult, appleResult] = await Promise.all([
            runWithTokenContext(() => search(q, 10, offset, country ? { country } : {})),
            offset === 0
                ? (isIsrc ? lookupAppleMusicByIsrc(q) : searchAppleMusic(q, 10)).catch((err) => { console.error('[get-music] Apple Music search failed:', err); return null; })
                : Promise.resolve(null), // Only search Apple Music on first page
        ]);

        const { _tokenSuffix, _tokenCountry, ...searchResults } = qobuzResult;

        // Merge Apple Music results after Qobuz results
        let mergedResults = searchResults;
        if (appleResult) {
            try {
                const appleSongs = extractSongsFromAppleResponse(appleResult);
                if (appleSongs.length > 0) {
                    // Deduplicate by ISRC: remove Apple tracks that already exist in Qobuz results
                    const qobuzIsrcs = new Set(
                        (searchResults?.tracks?.items || [])
                            .map((t: any) => t.isrc?.toUpperCase())
                            .filter(Boolean)
                    );
                    const uniqueAppleSongs = appleSongs.filter(
                        (s) => !qobuzIsrcs.has(s.attributes.isrc?.toUpperCase())
                    );
                    if (uniqueAppleSongs.length > 0) {
                        const appleFormatted = convertAppleMusicToQobuzFormat(uniqueAppleSongs);
                        const qobuzItems = searchResults?.tracks?.items || [];
                        mergedResults = {
                            ...searchResults,
                            tracks: {
                                ...searchResults?.tracks,
                                items: [...qobuzItems, ...appleFormatted.tracks.items] as any[],
                                total: (searchResults?.tracks?.total || 0) + uniqueAppleSongs.length,
                            },
                        };
                    }
                }
            } catch (appleErr) {
                console.error('[get-music] Apple Music merge failed:', appleErr);
            }
        }

        const res = new NextResponse(JSON.stringify({ success: true, data: mergedResults }), { status: 200 });
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
