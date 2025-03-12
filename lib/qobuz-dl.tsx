import axios from "axios";

let crypto: any;
let SocksProxyAgent: any;
if (typeof window === "undefined") {
    crypto = await import('node:crypto');
    SocksProxyAgent = (await import('socks-proxy-agent'))['SocksProxyAgent'];
}

export type QobuzGenre = {
    path: number[],
    color: string,
    name: string,
    id: number
}

export type QobuzLabel = {
    name: string,
    id: number,
    albums_count: number
}

export type QobuzArtist = {
    image: string | null,
    name: string,
    id: number,
    albums_count: number
}

export type QobuzTrack = {
    isrc: string | null,
    copyright: string,
    maximum_bit_depth: number,
    maximum_sampling_rate: number,
    performer: {
        name: string,
        id: number
    },
    album: QobuzAlbum,
    track_number: number,
    released_at: number,
    title: string,
    version: string | null,
    duration: number,
    parental_warning: boolean,
    id: number,
    hires: boolean,
    streamable: boolean,
    media_number: number
}

export type FetchedQobuzAlbum = QobuzAlbum & {
    tracks: {
        offset: number,
        limit: number,
        total: number,
        items: QobuzTrack[]
    }
}

export type QobuzAlbum = {
    maximum_bit_depth: number,
    image: {
        small: string,
        thumbnail: string,
        large: string,
        back: string | null
    },
    artist: QobuzArtist,
    artists: {
        id: number,
        name: string,
        roles: string[]
    }[],
    released_at: number,
    label: QobuzLabel,
    title: string,
    qobuz_id: number,
    version: string | null,
    duration: number,
    parental_warning: boolean,
    tracks_count: number,
    genre: QobuzGenre,
    id: string,
    maximum_sampling_rate: number,
    release_date_original: string,
    hires: boolean,
    upc: string,
    streamable: boolean
}

export type QobuzSearchResults = {
    query: string,
    albums: {
        limit: number,
        offset: number,
        total: number,
        items: QobuzAlbum[]
    },
    tracks: {
        limit: number,
        offset: number,
        total: number,
        items: QobuzTrack[]
    }
}

export function getAlbum(input: QobuzAlbum | QobuzTrack) {
    return ((input as QobuzAlbum).image ? input : (input as QobuzTrack).album) as QobuzAlbum;
}

export function formatTitle(input: QobuzAlbum | QobuzTrack) {
    return `${input.title}${input.version ? " (" + input.version + ")" : ""}`.trim();
}

export function getFullResImageUrl(input: QobuzAlbum | QobuzTrack) {
    return getAlbum(input).image.large.substring(0, (getAlbum(input)).image.large.length - 7) + "org.jpg";
}

export function formatArtists(input: QobuzAlbum | QobuzTrack, separator: string = ", ") {
    return (getAlbum(input) as QobuzAlbum).artists && (getAlbum(input) as QobuzAlbum).artists.length > 0 ? (getAlbum(input) as QobuzAlbum).artists.map((artist) => artist.name).join(separator) : (input as QobuzTrack).performer?.name || "Various Artists"
}

export function getRandomToken() {
    return JSON.parse(process.env.QOBUZ_AUTH_TOKENS!)[Math.floor(Math.random() * JSON.parse(process.env.QOBUZ_AUTH_TOKENS!).length)] as string;
}

export function filterExplicit(results: QobuzSearchResults, explicit: boolean = true) {
    return {...results,
        albums: {
            ...results.albums,
            items: results.albums.items.filter(album => explicit ? true : !album.parental_warning)
        },
        tracks: {
            ...results.tracks,
            items: results.tracks.items.filter(track => explicit ? true : !track.parental_warning)
        }
    }
}

export async function search(query: string, limit: number = 10, offset: number = 0) {
    testForRequirements();
    const url = new URL(process.env.QOBUZ_API_BASE + "catalog/search")
    url.searchParams.append("query", query)
    url.searchParams.append("limit", limit.toString());
    url.searchParams.append("offset", offset.toString());
    let proxyAgent= undefined;
    if (process.env.SOCKS5_PROXY) {
        proxyAgent = new SocksProxyAgent("socks5://" + process.env.SOCKS5_PROXY);
    }
    const response = await axios.get(url.toString(), {
        headers: {
            "x-app-id": process.env.QOBUZ_APP_ID!,
            "x-user-auth-token": getRandomToken()
        },
        httpAgent: proxyAgent,
        httpsAgent: proxyAgent
    });
    return response.data as QobuzSearchResults;
}

export async function getDownloadURL(trackID: number, quality: string) {
    testForRequirements();
    const timestamp = Math.floor(new Date().getTime() / 1000);
    const r_sig = `trackgetFileUrlformat_id${quality}intentstreamtrack_id${trackID}${timestamp}${process.env.QOBUZ_SECRET}`;
    const r_sig_hashed = crypto.createHash('md5').update(r_sig).digest('hex');
    const url = new URL(process.env.QOBUZ_API_BASE + 'track/getFileUrl');
    url.searchParams.append("format_id", quality);
    url.searchParams.append("intent", "stream");
    url.searchParams.append("track_id", trackID.toString());
    url.searchParams.append("request_ts", timestamp.toString());
    url.searchParams.append("request_sig", r_sig_hashed);
    const headers = new Headers();
    headers.append('X-App-Id', process.env.QOBUZ_APP_ID!);
    headers.append("X-User-Auth-Token", getRandomToken());
    let proxyAgent= undefined;
    if (process.env.SOCKS5_PROXY) {
        proxyAgent = new SocksProxyAgent("socks5://" + process.env.SOCKS5_PROXY);
    }
    const response = await axios.get(url.toString(), {
        headers: {
            "x-app-id": process.env.QOBUZ_APP_ID!,
            "x-user-auth-token": getRandomToken()
        },
        httpAgent: proxyAgent,
        httpsAgent: proxyAgent
    })
    return response.data.url;
}

export async function getAlbumInfo(album_id: string) {
    testForRequirements();
    const url = new URL(process.env.QOBUZ_API_BASE + 'album/get');
    url.searchParams.append("album_id", album_id);
    url.searchParams.append("extra", "track_ids");
    let proxyAgent= undefined;
    if (process.env.SOCKS5_PROXY) {
        proxyAgent = new SocksProxyAgent("socks5://" + process.env.SOCKS5_PROXY);
    }
    const response = await axios.get(url.toString(), {
        headers: {
            "x-app-id": process.env.QOBUZ_APP_ID!,
            "x-user-auth-token": getRandomToken()
        },
        httpAgent: proxyAgent,
        httpsAgent: proxyAgent
    })
    return response.data;
}

export async function getFullResImage(resultData: QobuzAlbum | QobuzTrack): Promise<string> {
    return new Promise((resolve) => {        
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        const imgToResize = new Image();
        imgToResize.crossOrigin = "anonymous";
        imgToResize.src = getFullResImageUrl(resultData);
        imgToResize.onload = () => {        
            canvas.width = 3000;
            canvas.height = 3000;
            context!.drawImage(
                imgToResize,
                0,
                0,
                3000,
                3000
            );
            resolve(canvas.toDataURL("image/jpeg"));
        }
    })
}

export function formatDuration(seconds: number) {
    if (!seconds) return "0m";
    const totalMinutes = Math.floor(seconds / 60);
    const hours = Math.floor(totalMinutes / 60);
    const remainingMinutes = totalMinutes % 60;
    const remainingSeconds = seconds % 60;

    return `${hours > 0 ? hours + "h " : ""} ${remainingMinutes > 0 ? remainingMinutes + "m " : ""} ${remainingSeconds > 0 && hours <= 0 ? remainingSeconds + "s" : ""}`.trim();
}

export function testForRequirements() {
    if (process.env.QOBUZ_APP_ID?.length === 0) throw new Error("Deployment is missing QOBUZ_APP_ID environment variable.");
    if (process.env.QOBUZ_AUTH_TOKENS?.length === 0) throw new Error("Deployment is missing QOBUZ_AUTH_TOKENS environment variable.");
    if (process.env.QOBUZ_SECRET?.length === 0) throw new Error("Deployment is missing QOBUZ_SECRET environment variable.");
    if (process.env.QOBUZ_API_BASE?.length === 0) throw new Error("Deployment is missing QOBUZ_API_BASE environment variable.");
    return true;
}

export async function getFullAlbumInfo(fetchedAlbumData: FetchedQobuzAlbum | null, setFetchedAlbumData: React.Dispatch<React.SetStateAction<FetchedQobuzAlbum | null>>, result: QobuzAlbum) {
    if (fetchedAlbumData && (fetchedAlbumData as FetchedQobuzAlbum).id === (result as QobuzAlbum).id) return fetchedAlbumData;
    setFetchedAlbumData(null);
    const albumDataResponse = await axios.get("/api/get-album", { params: { album_id: (result as QobuzAlbum).id } });
    setFetchedAlbumData(albumDataResponse.data.data);
    return albumDataResponse.data.data;
}