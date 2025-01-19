import { formatArtists, formatTitle, getAlbum, formatDuration, QobuzAlbum, QobuzTrack, FetchedQobuzAlbum, getFullAlbumInfo } from '@/lib/qobuz-dl'
import { cn } from '@/lib/utils'
import { AlignJustifyIcon, DotIcon, DownloadIcon } from 'lucide-react'
import React, { useEffect, useState } from 'react'
import { Button } from './ui/button'
import { useStatusBar } from '@/lib/status-bar/context'
import axios from 'axios'
import { useFFmpeg } from '@/lib/ffmpeg-provider'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogTitle,
} from "@/components/ui/dialog"
import { Separator } from './ui/separator'
import { ScrollArea } from './ui/scroll-area'
import { motion } from 'motion/react'
import { createDownloadJob } from '@/lib/download-job'
import { useSettings } from '@/lib/settings-provider'
import { Skeleton } from './ui/skeleton'
import Image from 'next/image'

import DownloadAlbumButton from './download-album-button'

const ReleaseCard = ({ result, resolvedTheme, ref }: { result: QobuzAlbum | QobuzTrack, resolvedTheme: string, ref?: React.Ref<HTMLDivElement> }) => {
    const { ffmpegState } = useFFmpeg();
    const { setStatusBar } = useStatusBar();
    const { settings } = useSettings();

    const [openTracklist, setOpenTracklist] = useState(false);
    const [fetchedAlbumData, setFetchedAlbumData] = useState<FetchedQobuzAlbum | null>(null);
    const [loadedImage, setLoadedImage] = useState<boolean | string>(false);
    const [focusCard, setFocusCard] = useState(false);

    useEffect(() => {
        if (loadedImage) setLoadedImage(false);
        axios.get(getAlbum(result).image.small, { responseType: "blob" }).then((response) => {
            const url = URL.createObjectURL(response.data);
            setLoadedImage(url);
        })
        return () => {
            if (typeof loadedImage === "string") URL.revokeObjectURL(loadedImage);
        }
    }, [result])

    return (
        <div
            className="space-y-2"
            title={formatTitle(result)}
            ref={ref || undefined}
        >
            <div className='relative w-full aspect-square group select-none rounded-sm overflow-hidden'>
                <div className={cn(`w-full z-[3] backdrop-blur-md top-0 left-0 absolute transition-all aspect-square opacity-0 group-hover:opacity-100 ${focusCard && 'opacity-100'}`,
                    resolvedTheme != 'light'
                        ? `group-hover:bg-black/40 ${focusCard && 'bg-black/40'}`
                        : `group-hover:bg-white/20 ${focusCard && 'bg-white/20'}`,
                )}>
                    <div className="flex flex-col h-full justify-between">
                        <div className="space-y-0.5 p-4">
                            <p className='text-sm truncate capitalize font-bold'>{getAlbum(result).genre.name}</p>
                            <p className='text-xs truncate capitalize font-medium'>{new Date(getAlbum(result).released_at * 1000).getFullYear()}</p>
                            <div className="flex text-[10px] truncate font-semibold items-center justify-start">
                                <p>{result.maximum_bit_depth}-bit</p>
                                <DotIcon size={16} />
                                <p>{result.maximum_sampling_rate} kHz</p>
                            </div>
                            <div className="flex text-[10px] truncate font-semibold items-center justify-start">
                                {(result as QobuzAlbum).tracks_count ? (
                                    <>
                                        <p>{(result as QobuzAlbum).tracks_count} {(result as QobuzAlbum).tracks_count > 1 ? "tracks" : "track"}</p>
                                        <DotIcon size={16} />
                                    </>) : null}
                                <p>{formatDuration(result.duration)}</p>
                            </div>
                        </div>
                        <div className="flex items-center justify-between gap-4 p-2">
                            {(result as QobuzTrack).album ? <Button
                                size='icon'
                                variant='ghost'
                                onClick={async () => {
                                    await createDownloadJob(result, setStatusBar, ffmpegState, settings, fetchedAlbumData, setFetchedAlbumData);
                                }}
                            >
                                <DownloadIcon />
                            </Button> : <DownloadAlbumButton variant='ghost' size='icon' result={result as QobuzAlbum} setStatusBar={setStatusBar} ffmpegState={ffmpegState} settings={settings} fetchedAlbumData={fetchedAlbumData} setFetchedAlbumData={setFetchedAlbumData} onOpen={() => setFocusCard(true)} onClose={() => setFocusCard(false)}/>}
                            {(result as QobuzTrack).album ? null :
                                <Button size='icon' variant='ghost' onClick={async () => {
                                    setOpenTracklist(!openTracklist);
                                    await getFullAlbumInfo(fetchedAlbumData, setFetchedAlbumData, result as QobuzAlbum);
                                }}>
                                    <AlignJustifyIcon />
                                </Button>
                            }
                        </div>
                    </div>
                </div>
                {loadedImage && <motion.div
                    initial={{ scale: 0.9 }}
                    animate={{ scale: 1 }}
                    transition={{ duration: 0.1 }}
                    className={cn('absolute left-0 top-0 z-[2] w-full aspect-square transition-all')}
                >
                    <img src={loadedImage as string} alt={formatTitle(result)} className={`group-hover:scale-105 transition-all w-full h-full ${focusCard && 'scale-105'}`} />
                </motion.div>}
                <Skeleton className='absolute left-0 top-0 z-[1] w-full aspect-square' />
            </div>
            <div className="space-y-1">
                <div className="flex gap-1.5 items-center">
                    {result.parental_warning && <p className='text-[10px] bg-primary text-primary-foreground p-1 rounded-sm aspect-square w-[18px] h-[18px] text-center justify-center items-center flex font-semibold' title='Explicit'>E</p>}
                    <h1 className='text-sm truncate font-bold group-hover:underline'>
                        {formatTitle(result)}
                    </h1>
                </div>
                <p className='text-xs truncate' title={formatArtists(result)}>
                    {formatArtists(result)}
                </p>
            </div>
            <Dialog open={openTracklist} onOpenChange={setOpenTracklist}>
                <DialogContent className='w-[600px] max-w-[90%] md:max-w-[80%] overflow-hidden'>
                    <div className="flex gap-3 overflow-hidden">
                        <div className="relative shrink-0 aspect-square min-w-[100px] min-h-[100px] rounded-sm overflow-hidden">
                            <Skeleton className='absolute aspect-square w-full h-full' />
                            {typeof loadedImage === "string" && <Image fill src={loadedImage} alt={formatTitle(result)} crossOrigin='anonymous' className='absolute aspect-square w-full h-full' />}
                        </div>

                        <div className="flex w-full flex-col justify-between overflow-hidden">
                            <div className="space-y-1.5 overflow-visible">
                                <DialogTitle title={formatTitle(getAlbum(result))} className='truncate overflow-visible py-0.5 pr-2'>{formatTitle(getAlbum(result))}</DialogTitle>
                                <DialogDescription title={formatArtists(result)} className='truncate overflow-visible '>{formatArtists(result)}</DialogDescription>
                            </div>
                            <div className="flex items-center w-full justify-between gap-2">
                                <div className="space-y-1.5 w-fit">
                                    <DialogDescription
                                        className='truncate'
                                    >
                                        {getAlbum(result).tracks_count} {getAlbum(result).tracks_count > 1 ? "tracks" : "track"} - {formatDuration(getAlbum(result).duration)}
                                    </DialogDescription>
                                </div>
                                <DownloadAlbumButton result={result as QobuzAlbum} setStatusBar={setStatusBar} ffmpegState={ffmpegState} settings={settings} fetchedAlbumData={fetchedAlbumData} setFetchedAlbumData={setFetchedAlbumData} variant="ghost" size="icon" onClick={() => {
                                    setOpenTracklist(false);
                                }} />
                            </div>
                        </div>
                    </div>
                    <Separator />
                    {fetchedAlbumData && <ScrollArea className='max-h-[40vh]'>
                        <motion.div
                            initial={{ maxHeight: "0vh" }}
                            animate={{ maxHeight: "40vh" }}
                        >
                            <div className="flex flex-col overflow-hidden pr-3">
                                {fetchedAlbumData.tracks.items.map((track: QobuzTrack, index: number) => {
                                    track.album = getAlbum(result);
                                    return (
                                        <div key={track.id}>
                                            <div className={cn('flex items-center justify-between gap-2 overflow-hidden hover:bg-primary/5 transition-all p-2 rounded group', !track.streamable && 'opacity-50')}>
                                                <div className="gap-2 flex items-center overflow-hidden">
                                                    <span className='text-muted-foreground text-sm'>{index + 1}</span>
                                                    {track.parental_warning && <p className='text-[10px] bg-primary text-primary-foreground p-1 rounded-sm aspect-square w-[18px] h-[18px] text-center justify-center items-center flex font-semibold' title='Explicit'>E</p>}
                                                    <p className='truncate font-medium'>{formatTitle(track)}</p>
                                                </div>
                                                {track.streamable && <Button
                                                    title={`Download '${formatTitle(track)}'`}
                                                    className='md:group-hover:flex md:hidden justify-center aspect-square h-6 w-6 [&_svg]:size-5 hover:bg-transparent'
                                                    size="icon"
                                                    variant='ghost'
                                                    onClick={async () => {
                                                        await createDownloadJob(track, setStatusBar, ffmpegState, settings);
                                                        setOpenTracklist(false);
                                                    }}
                                                >
                                                    <DownloadIcon className='!size-4' />
                                                </Button>}
                                            </div>
                                            {index < fetchedAlbumData.tracks.items.length - 1 && <Separator />}
                                            <div />
                                        </div>
                                    )
                                })}
                            </div>
                        </motion.div>
                    </ScrollArea>}
                </DialogContent>
            </Dialog>
        </div>
    )
}

export default ReleaseCard