import { getArtist, runWithTokenContext } from '@/lib/qobuz-dl-server';
import { getAppleMusicArtist, convertAppleMusicArtistDetailToQobuzFormat } from '@/lib/apple-music-server';
import { logRequest } from '@/lib/api-logger';
import { checkIpGate } from '@/lib/ipgate';
import z from 'zod';

const artistReleasesParamsSchema = z.object({
    artist_id: z.string().min(1, 'ID is required')
});

export async function GET(request: Request) {
    const blocked = await checkIpGate(request);
    if (blocked) return blocked;
    const country = request.headers.get('Token-Country');
    const params = Object.fromEntries(new URL(request.url).searchParams.entries());
    const start = Date.now();
    try {
        const { artist_id } = artistReleasesParamsSchema.parse(params);

        // Handle Apple Music artist IDs (prefixed with "apple:")
        if (artist_id.startsWith('apple:')) {
            const appleId = artist_id.replace('apple:', '');
            const raw = await getAppleMusicArtist(appleId);
            if (!raw) {
                logRequest(request, 404, Date.now() - start);
                return new Response(JSON.stringify({ success: false, error: 'Apple Music artist not found' }), { status: 404 });
            }
            const data = convertAppleMusicArtistDetailToQobuzFormat(raw);
            if (!data) {
                logRequest(request, 404, Date.now() - start);
                return new Response(JSON.stringify({ success: false, error: 'Failed to parse Apple Music artist' }), { status: 404 });
            }
            const res = new Response(JSON.stringify({ success: true, data }), { status: 200 });
            logRequest(request, 200, Date.now() - start);
            return res;
        }

        const result = await runWithTokenContext(async () => {
            const artist = await getArtist(artist_id, country ? { country } : {});
            return { artist };
        });
        const { _tokenSuffix, _tokenCountry, artist } = result;
        const res = new Response(JSON.stringify({ success: true, data: { artist } }), { status: 200 });
        logRequest(request, 200, Date.now() - start, _tokenSuffix, _tokenCountry);
        return res;
    } catch (error: any) {
        logRequest(request, 400, Date.now() - start);
        return new Response(
            JSON.stringify({
                success: false,
                error: error?.errors || error.message || 'An error occurred parsing the request.'
            }),
            { status: 400 }
        );
    }
}
