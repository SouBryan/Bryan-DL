import axios from "axios";
import { applyMetadata, codecMap, FFmpegType, loadFFmpeg } from "./ffmpeg-functions";
import { FetchedQobuzAlbum, formatArtists, formatTitle, getFullResImage, QobuzAlbum, QobuzTrack } from "./qobuz-dl";
import { createJob } from "./status-bar/jobs";
import { StatusBarProps } from "@/components/status-bar/status-bar";
import saveAs from "file-saver";
import { cleanFileName, formatBytes } from "./utils";
import { Disc3Icon, DiscAlbumIcon } from "lucide-react";
import * as zip from "@zip.js/zip.js";
import { SettingsProps } from "./settings-provider";

export const createDownloadJob = async (result: QobuzAlbum | QobuzTrack, setStatusBar: React.Dispatch<React.SetStateAction<StatusBarProps>>, ffmpegState: FFmpegType, settings: SettingsProps, fetchedAlbumData?: FetchedQobuzAlbum | null, setFetchedAlbumData?: React.Dispatch<React.SetStateAction<FetchedQobuzAlbum | null>>) => {
    if ((result as QobuzTrack).album) {
        const formattedTitle = formatArtists(result) + " - " + formatTitle(result)
        await createJob(setStatusBar, formattedTitle, Disc3Icon, async () => {
            return new Promise(async (resolve) => {
                try {
                    const controller = new AbortController();
                    const signal = controller.signal;
                    setStatusBar(prev => ({
                        ...prev, progress: 0, title: `Downloading ${formatTitle(result)}`, description: `Loading FFmpeg`, onCancel: () => {
                            controller.abort();
                        }
                    }))
                    await loadFFmpeg(ffmpegState, signal);
                    setStatusBar(prev => ({ ...prev, description: "Fetching track size..." }))
                    const APIResponse = await axios.get("/api/download-music", { params: { track_id: (result as QobuzTrack).id, quality: settings.outputQuality }, signal });
                    const trackURL = APIResponse.data.data.url;
                    const fileSizeResponse = await axios.head(trackURL, { signal });
                    const fileSize = fileSizeResponse.headers["content-length"];
                    const response = await axios.get(trackURL, {
                        responseType: 'arraybuffer',
                        onDownloadProgress: (progressEvent) => {
                            setStatusBar(statusbar => {
                                if (statusbar.processing) return { ...statusbar, progress: Math.floor(progressEvent.loaded / fileSize * 100), description: `${formatBytes(progressEvent.loaded)} / ${formatBytes(fileSize)}` }
                                else return statusbar;
                            })
                        },
                        signal
                    });
                    setStatusBar(prev => ({ ...prev, description: `Applying metadata...`, progress: 100 }))
                    const inputFile = response.data;
                    const outputFile = await applyMetadata(inputFile, result as QobuzTrack, ffmpegState, settings, setStatusBar);
                    saveAs(new Blob([outputFile]), formattedTitle + "." + codecMap[settings.outputCodec].extension);
                    resolve();
                } catch (e) {
                    console.log(e)
                    resolve()
                }
            })
        })
    } else {
        const formattedTitle = formatArtists(result) + " - " + formatTitle(result)
        await createJob(setStatusBar, formattedTitle, DiscAlbumIcon, async () => {
            return new Promise(async (resolve) => {
                try {
                    const controller = new AbortController();
                    const signal = controller.signal;
                    setStatusBar(prev => ({
                        ...prev, progress: 0, title: `Downloading ${formatTitle(result)}`, description: `Loading FFmpeg...`, onCancel: () => {
                            controller.abort();
                        }
                    }))
                    await loadFFmpeg(ffmpegState, signal);
                    setStatusBar(prev => ({ ...prev, description: "Fetching album data..." }));
                    if (!fetchedAlbumData) {
                        const albumDataResponse = await axios.get("/api/get-album", { params: { album_id: (result as QobuzAlbum).id }, signal });
                        if (setFetchedAlbumData) {
                            setFetchedAlbumData(albumDataResponse.data.data);
                            fetchedAlbumData = albumDataResponse.data.data
                        }
                    }
                    const albumTracks = fetchedAlbumData!.tracks.items.map((track: QobuzTrack) => ({ ...track, album: fetchedAlbumData })) as QobuzTrack[];
                    let totalAlbumSize = 0;
                    const albumUrls = [] as string[];
                    setStatusBar(prev => ({ ...prev, description: "Fetching album size..." }));
                    for (const [index, track] of albumTracks.entries()) {
                        const fileURLResponse = await axios.get("/api/download-music", { params: { track_id: track.id, quality: settings.outputQuality }, signal });
                        const trackURL = fileURLResponse.data.data.url;
                        albumUrls.push(trackURL);
                        const fileSizeResponse = await axios.head(trackURL, { signal });
                        setStatusBar(statusBar => ({ ...statusBar, progress: (100 / albumTracks.length) * (index + 1) }));
                        const fileSize = parseInt(fileSizeResponse.headers["content-length"]);
                        totalAlbumSize += fileSize;
                    }
                    const trackBlobs = [] as Blob[];
                    let totalBytesDownloaded = 0;
                    setStatusBar(statusBar => ({ ...statusBar, progress: 0, description: `Fetching album art...` }));
                    const albumArt = (await axios.get(await getFullResImage(fetchedAlbumData!), { responseType: 'arraybuffer' })).data
                    for (const [index, url] of albumUrls.entries()) {
                        const response = await axios.get(url, {
                            responseType: 'arraybuffer',
                            onDownloadProgress: (progressEvent) => {
                                if (totalBytesDownloaded + progressEvent.loaded < totalAlbumSize) setStatusBar(statusBar => {
                                    if (statusBar.processing) return { ...statusBar, progress: Math.floor((totalBytesDownloaded + progressEvent.loaded) / totalAlbumSize * 100), description: `${formatBytes(totalBytesDownloaded + progressEvent.loaded)} / ${formatBytes(totalAlbumSize)}` }
                                    else return statusBar;
                                });
                            },
                            signal
                        })
                        await new Promise(resolve => setTimeout(resolve, 100));
                        totalBytesDownloaded += response.data.byteLength;
                        const inputFile = response.data;
                        const outputFile = await applyMetadata(inputFile, albumTracks[index], ffmpegState, settings, undefined, albumArt);
                        trackBlobs.push(new Blob([outputFile]));
                    }
                    setStatusBar(statusBar => ({ ...statusBar, progress: 0, description: `Zipping album...` }));
                    const zipWriter = new zip.ZipWriter(new zip.BlobWriter("application/zip"), { bufferedWrite: true });
                    for (const [index, blob] of trackBlobs.entries()) {
                        const fileName = (index + 1).toString().padStart((albumTracks.length - 1).toString().length > 2 ? (albumTracks.length - 1).toString().length : 2, '0') + " " + formatTitle(albumTracks[index]) + "." + codecMap[settings.outputCodec].extension
                        await zipWriter.add(cleanFileName(fileName), new zip.BlobReader(blob), { signal });
                        setStatusBar(prev => ({ ...prev, progress: Math.floor((index + 1) / (albumTracks.length + 1) * 100) }));
                    }
                    await zipWriter.add("cover.jpg", new zip.BlobReader(new Blob([albumArt])), { signal });
                    setStatusBar(prev => ({ ...prev, progress: 100 }));
                    saveAs(await zipWriter.close(), formattedTitle + ".zip");
                    resolve();
                } catch {
                    resolve()
                }
            })
        })
    }
}