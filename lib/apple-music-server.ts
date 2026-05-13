/**
 * Apple Music Sidecar Client
 * Calls the internal apple-music-api FastAPI service.
 * Converts Apple Music results to Qobuz-compatible format.
 */

const APPLE_MUSIC_API_URL = process.env.APPLE_MUSIC_API_URL || 'http://apple-music-api:8000';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://cdn.bryanhifi.dpdns.org';

// ── Sidecar HTTP calls ──

export async function searchAppleMusic(term: string, limit: number = 10, storefront?: string) {
    let url = `${APPLE_MUSIC_API_URL}/search?term=${encodeURIComponent(term)}&limit=${limit}&types=songs`;
    if (storefront) url += `&storefront=${encodeURIComponent(storefront)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
        console.error(`[apple-music] Search failed: ${res.status}`);
        return null;
    }
    return res.json();
}

export async function lookupAppleMusicByIsrc(isrc: string, storefront?: string) {
    let url = `${APPLE_MUSIC_API_URL}/lookup-isrc?isrc=${encodeURIComponent(isrc)}`;
    if (storefront) url += `&storefront=${encodeURIComponent(storefront)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
        console.error(`[apple-music] ISRC lookup failed: ${res.status}`);
        return null;
    }
    return res.json();
}

export async function downloadAppleMusicTrack(songId: string, storefront?: string, outputCodec?: string): Promise<string | null> {
    // Map frontend codec to sidecar codec: lossless outputs request ALAC, lossy outputs request AAC
    const losslessCodecs = ['FLAC', 'WAV', 'ALAC'];
    const sidecarCodec = losslessCodecs.includes(outputCodec || '') ? 'alac' : 'aac';

    // R2 key depends on codec (ALAC keeps legacy key; AAC gets _aac suffix)
    const r2Suffix = sidecarCodec === 'alac' ? '' : '_aac';
    const r2Url = `${R2_PUBLIC_URL}/apple/${songId}${r2Suffix}.m4a`;

    // Check R2 cache first (fast HEAD via public URL)
    try {
        const head = await fetch(r2Url, { method: 'HEAD', signal: AbortSignal.timeout(3000) });
        if (head.ok) {
            console.log(`[apple-music] R2 cache hit: ${songId} (${sidecarCodec})`);
            return r2Url;
        }
    } catch {
        // Cache miss or R2 unreachable, proceed to download
    }

    // Call sidecar to download + decrypt + upload to R2
    const params = new URLSearchParams({ codec: sidecarCodec });
    if (storefront) params.set('storefront', storefront);
    const downloadUrl = `${APPLE_MUSIC_API_URL}/download/${songId}?${params.toString()}`;
    const res = await fetch(downloadUrl, { signal: AbortSignal.timeout(60000) }); // 60s timeout for download+decrypt
    if (!res.ok) {
        console.error(`[apple-music] Download failed: ${res.status}`);
        return null;
    }
    const data = await res.json();
    return data.url || null;
}

export async function getAppleMusicHealth() {
    try {
        const res = await fetch(`${APPLE_MUSIC_API_URL}/health`, { signal: AbortSignal.timeout(3000) });
        if (!res.ok) return null;
        return res.json();
    } catch {
        return null;
    }
}

// ── Apple Music → Qobuz format conversion ──

interface AppleMusicSong {
    id: string;
    _storefront?: string;
    attributes: {
        name: string;
        artistName: string;
        albumName: string;
        durationInMillis: number;
        trackNumber: number;
        discNumber: number;
        isrc: string;
        artwork: {
            url: string;
            width: number;
            height: number;
        };
        genreNames: string[];
        releaseDate: string;
        composerName?: string;
    };
}

/**
 * Convert Apple Music search results to Qobuz-compatible format.
 * The Monochrome client expects this exact structure.
 */
export function convertAppleMusicToQobuzFormat(songs: AppleMusicSong[]) {
    const items = songs.map((song) => {
        const artworkUrl = song.attributes.artwork?.url
            ?.replace('{w}', '600')
            ?.replace('{h}', '600') || '';

        return {
            id: `apple:${song.id}`,
            title: song.attributes.name,
            duration: Math.round(song.attributes.durationInMillis / 1000),
            track_number: song.attributes.trackNumber,
            media_number: song.attributes.discNumber,
            isrc: song.attributes.isrc,
            copyright: '',
            released_at: new Date(song.attributes.releaseDate).getTime() / 1000,
            version: null,
            parental_warning: false,
            maximum_bit_depth: 16,
            maximum_sampling_rate: 44.1,
            hires: false,
            hires_streamable: false,
            streamable: true,
            displayable: true,
            performer: {
                id: 0,
                name: song.attributes.artistName,
            },
            performers: song.attributes.artistName,
            composer: {
                id: 0,
                name: song.attributes.composerName || '',
            },
            album: {
                id: `apple:${song.id}`,
                title: song.attributes.albumName,
                tracks_count: 1,
                duration: Math.round(song.attributes.durationInMillis / 1000),
                image: {
                    small: artworkUrl.replace('600x600', '150x150'),
                    thumbnail: artworkUrl.replace('600x600', '300x300'),
                    large: artworkUrl,
                    back: null,
                },
                artist: {
                    id: 0,
                    name: song.attributes.artistName,
                },
                release_date_original: song.attributes.releaseDate,
                genre: {
                    id: 0,
                    name: song.attributes.genreNames?.[0] || 'Unknown',
                },
                label: { id: 0, name: '' },
                maximum_bit_depth: 16,
                maximum_sampling_rate: 44.1,
                hires: false,
                hires_streamable: false,
                streamable: true,
                displayable: true,
            },
            audio_info: {
                replaygain_track_gain: 0,
                replaygain_track_peak: 1,
            },
            // Flag to identify Apple Music tracks
            _source: 'apple-music',
            _storefront: song._storefront || undefined,
        };
    });

    return {
        tracks: {
            items,
            total: items.length,
            offset: 0,
            limit: items.length,
        },
    };
}

/**
 * Extract songs array from Apple Music search response.
 */
export function extractSongsFromAppleResponse(response: any): AppleMusicSong[] {
    if (!response) return [];

    // Response structure from Apple Music API:
    // { results: { songs: { data: [...] } } }
    const songs = response?.results?.songs?.data
        || response?.results?.song?.data
        || response?.data
        || [];

    return songs;
}
