import { NextRequest, NextResponse } from 'next/server';
import { search, runWithTokenContext } from '@/lib/qobuz-dl-server';
import { logRequest } from '@/lib/api-logger';
import z from 'zod';

const searchParamsSchema = z.object({
    q: z.string().min(1, 'Query is required'),
    offset: z.preprocess((a) => parseInt(a as string), z.number().max(1000, 'Offset must be less than 1000').min(0, 'Offset must be 0 or greater').default(0))
});

export async function GET(request: NextRequest) {
    const country = request.headers.get('Token-Country');
    const params = Object.fromEntries(new URL(request.url).searchParams.entries());
    const start = Date.now();
    try {
        const { q, offset } = searchParamsSchema.parse(params);
        const result = await runWithTokenContext(() => search(q, 10, offset, country ? { country } : {}));
        const { _tokenSuffix, _tokenCountry, ...searchResults } = result;
        const res = new NextResponse(JSON.stringify({ success: true, data: searchResults }), { status: 200 });
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
