/**
 * Apple Music Sidecar Client
 * Calls the internal apple-music-api FastAPI service.
 * Converts Apple Music results to Qobuz-compatible format.
 */

const APPLE_MUSIC_API_URL = process.env.APPLE_MUSIC_API_URL || 'http://apple-music-api:8000';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://cdn.bryanhifi.dpdns.org';

// ── Sidecar HTTP calls ──

export async function searchAppleMusic(term: string, limit: number = 10, storefront?: string, types: string = 'songs') {
    let url = `${APPLE_MUSIC_API_URL}/search?term=${encodeURIComponent(term)}&limit=${limit}&types=${encodeURIComponent(types)}`;
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

export async function getAppleMusicAlbum(albumId: string, storefront?: string) {
    let url = `${APPLE_MUSIC_API_URL}/album/${encodeURIComponent(albumId)}`;
    if (storefront) url += `?storefront=${encodeURIComponent(storefront)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
        console.error(`[apple-music] get_album failed: ${res.status}`);
        return null;
    }
    return res.json();
}

export async function getAppleMusicArtist(artistId: string, storefront?: string) {
    let url = `${APPLE_MUSIC_API_URL}/artist/${encodeURIComponent(artistId)}`;
    if (storefront) url += `?storefront=${encodeURIComponent(storefront)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
        console.error(`[apple-music] get_artist failed: ${res.status}`);
        return null;
    }
    return res.json();
}

/**
 * Convert Apple Music album API response to Qobuz FetchedQobuzAlbum format.
 */
export function convertAppleMusicAlbumDetailToQobuzFormat(albumData: any) {
    const album = albumData?.data?.[0];
    if (!album) return null;
    const attr = album.attributes;
    const artworkUrl = attr.artwork?.url?.replace('{w}', '600')?.replace('{h}', '600') || '';
    const tracks = album.relationships?.tracks?.data || [];
    const releasedAt = attr.releaseDate ? new Date(attr.releaseDate).getTime() / 1000 : 0;

    const trackItems = tracks.map((track: any, index: number) => {
        const tAttr = track.attributes;
        const trackArtwork = tAttr.artwork?.url?.replace('{w}', '600')?.replace('{h}', '600') || artworkUrl;
        return {
            id: `apple:${track.id}`,
            title: tAttr.name,
            duration: Math.round((tAttr.durationInMillis || 0) / 1000),
            track_number: tAttr.trackNumber || index + 1,
            media_number: tAttr.discNumber || 1,
            isrc: tAttr.isrc || '',
            copyright: '',
            released_at: tAttr.releaseDate ? new Date(tAttr.releaseDate).getTime() / 1000 : releasedAt,
            version: null,
            parental_warning: tAttr.contentRating === 'explicit',
            maximum_bit_depth: 16,
            maximum_sampling_rate: 44.1,
            hires: false,
            hires_streamable: false,
            streamable: true,
            displayable: true,
            performer: { id: 0, name: tAttr.artistName },
            performers: tAttr.artistName,
            composer: { id: 0, name: tAttr.composerName || '' },
            _source: 'apple-music',
        };
    });

    return {
        id: `apple:${album.id}`,
        title: attr.name,
        version: null,
        duration: Math.round((tracks.reduce((sum: number, t: any) => sum + (t.attributes?.durationInMillis || 0), 0)) / 1000),
        tracks_count: tracks.length,
        released_at: releasedAt,
        release_date_original: attr.releaseDate || '',
        maximum_bit_depth: 16,
        maximum_sampling_rate: 44.1,
        hires: false,
        hires_streamable: false,
        streamable: true,
        displayable: true,
        parental_warning: attr.contentRating === 'explicit',
        genre: { id: 0, name: attr.genreNames?.[0] || 'Unknown', path: [], color: '' },
        label: { id: 0, name: attr.recordLabel || '', albums_count: 0 },
        artist: { id: 0, name: attr.artistName, albums_count: 0 },
        artists: [{ id: 0, name: attr.artistName, roles: ['main-artist'] }],
        image: {
            small: artworkUrl.replace('600x600', '150x150'),
            thumbnail: artworkUrl.replace('600x600', '300x300'),
            large: artworkUrl,
            back: null,
        },
        upc: attr.upc || '',
        qobuz_id: 0,
        copyright: attr.copyright || '',
        tracks: {
            offset: 0,
            limit: tracks.length,
            total: tracks.length,
            items: trackItems,
        },
        _source: 'apple-music',
    };
}

/**
 * Convert Apple Music artist API response to Qobuz artist results format.
 */
export function convertAppleMusicArtistDetailToQobuzFormat(artistData: any) {
    const artist = artistData?.data?.[0];
    if (!artist) return null;
    const attr = artist.attributes;
    const artworkUrl = attr.artwork?.url?.replace('{w}', '600')?.replace('{h}', '600') || null;

    // Extract albums from views or relationships
    const fullAlbums = artistData?.data?.[0]?.views?.['full-albums']?.data || [];
    const singles = artistData?.data?.[0]?.views?.['singles']?.data || [];
    const compilations = artistData?.data?.[0]?.views?.['compilation-albums']?.data || [];
    const liveAlbums = artistData?.data?.[0]?.views?.['live-albums']?.data || [];
    const albumsFromRelationships = artist.relationships?.albums?.data || [];

    const mapAlbums = (albums: any[]) => albums.map((album: any) => {
        const aAttr = album.attributes;
        const aArtwork = aAttr?.artwork?.url?.replace('{w}', '600')?.replace('{h}', '600') || '';
        const aReleasedAt = aAttr?.releaseDate ? new Date(aAttr.releaseDate).getTime() / 1000 : 0;
        return {
            id: `apple:${album.id}`,
            title: aAttr?.name || '',
            version: null,
            duration: Math.round((aAttr?.durationInMillis || 0) / 1000),
            tracks_count: aAttr?.trackCount || 0,
            released_at: aReleasedAt,
            release_date_original: aAttr?.releaseDate || '',
            maximum_bit_depth: 16,
            maximum_sampling_rate: 44.1,
            hires: false,
            hires_streamable: false,
            streamable: true,
            displayable: true,
            parental_warning: aAttr?.contentRating === 'explicit',
            genre: { id: 0, name: aAttr?.genreNames?.[0] || 'Unknown', path: [], color: '' },
            label: { id: 0, name: aAttr?.recordLabel || '', albums_count: 0 },
            artist: { id: `apple:${artist.id}`, name: attr.name, albums_count: 0 },
            artists: [{ id: `apple:${artist.id}`, name: attr.name }],
            image: {
                small: aArtwork.replace('600x600', '150x150'),
                thumbnail: aArtwork.replace('600x600', '300x300'),
                large: aArtwork,
                back: null,
            },
            upc: aAttr?.upc || '',
            qobuz_id: 0,
            _source: 'apple-music',
        };
    });

    // If we have views, separate by category. Otherwise put all in "album"
    const hasViews = fullAlbums.length > 0 || singles.length > 0 || compilations.length > 0 || liveAlbums.length > 0;
    const releases: any[] = [];

    if (hasViews) {
        if (fullAlbums.length > 0) releases.push({ type: 'album', items: mapAlbums(fullAlbums), has_more: false });
        if (singles.length > 0) releases.push({ type: 'epSingle', items: mapAlbums(singles), has_more: false });
        if (liveAlbums.length > 0) releases.push({ type: 'live', items: mapAlbums(liveAlbums), has_more: false });
        if (compilations.length > 0) releases.push({ type: 'compilation', items: mapAlbums(compilations), has_more: false });
    } else if (albumsFromRelationships.length > 0) {
        releases.push({ type: 'album', items: mapAlbums(albumsFromRelationships), has_more: false });
    }

    const totalAlbums = releases.reduce((sum, r) => sum + r.items.length, 0);

    return {
        artist: {
            id: `apple:${artist.id}`,
            name: attr.name,
            image: artworkUrl ? {
                small: artworkUrl.replace('600x600', '150x150'),
                medium: artworkUrl.replace('600x600', '300x300'),
                large: artworkUrl,
                extralarge: artworkUrl,
                mega: artworkUrl,
            } : null,
            albums_count: totalAlbums,
            biography: { content: attr.editorialNotes?.standard || attr.editorialNotes?.short || '' },
            releases,
        },
    };
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
            released_at: song.attributes.releaseDate ? new Date(song.attributes.releaseDate).getTime() / 1000 : 0,
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
                released_at: song.attributes.releaseDate ? new Date(song.attributes.releaseDate).getTime() / 1000 : 0,
                release_date_original: song.attributes.releaseDate || '',
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

export function extractAlbumsFromAppleResponse(response: any): any[] {
    if (!response) return [];
    return response?.results?.albums?.data || [];
}

export function extractArtistsFromAppleResponse(response: any): any[] {
    if (!response) return [];
    return response?.results?.artists?.data || [];
}

export function convertAppleMusicAlbumsToQobuzFormat(albums: any[]) {
    const items = albums.map((album) => {
        const artworkUrl = album.attributes.artwork?.url
            ?.replace('{w}', '600')
            ?.replace('{h}', '600') || '';
        const releasedAt = album.attributes.releaseDate ? new Date(album.attributes.releaseDate).getTime() / 1000 : 0;
        return {
            id: `apple:${album.id}`,
            title: album.attributes.name,
            artist: { id: 0, name: album.attributes.artistName },
            artists: [{ id: 0, name: album.attributes.artistName }],
            released_at: releasedAt,
            release_date_original: album.attributes.releaseDate || '',
            image: {
                small: artworkUrl.replace('600x600', '150x150'),
                thumbnail: artworkUrl.replace('600x600', '300x300'),
                large: artworkUrl,
                back: null,
            },
            tracks_count: album.attributes.trackCount || 0,
            duration: Math.round((album.attributes.durationInMillis || 0) / 1000),
            genre: { id: 0, name: album.attributes.genreNames?.[0] || 'Unknown', path: [], color: '' },
            label: { id: 0, name: '', albums_count: 0 },
            maximum_bit_depth: 16,
            maximum_sampling_rate: 44.1,
            hires: false,
            hires_streamable: false,
            streamable: true,
            displayable: true,
            parental_warning: false,
            version: null,
            qobuz_id: 0,
            upc: '',
            _source: 'apple-music',
            _storefront: album._storefront,
        };
    });
    return {
        albums: {
            items,
            total: items.length,
            offset: 0,
            limit: items.length,
        },
    };
}

export function convertAppleMusicArtistsToQobuzFormat(artists: any[]) {
    const items = artists.map((artist) => {
        const artworkUrl = artist.attributes.artwork?.url
            ?.replace('{w}', '600')
            ?.replace('{h}', '600') || null;
        return {
            id: `apple:${artist.id}`,
            name: artist.attributes.name,
            image: artworkUrl ? {
                small: artworkUrl.replace('600x600', '150x150'),
                medium: artworkUrl.replace('600x600', '300x300'),
                large: artworkUrl,
                extralarge: artworkUrl,
                mega: artworkUrl,
            } : null,
            albums_count: 0,
            _source: 'apple-music',
        };
    });
    return {
        artists: {
            items,
            total: items.length,
            offset: 0,
            limit: items.length,
        },
    };
}

