"use client"

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useInView } from "react-intersection-observer";
import { useTheme } from 'next-themes';
import SearchBar from '@/components/search-bar';
import ReleaseCard from '@/components/release-card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, DropdownMenuRadioGroup, DropdownMenuRadioItem } from "@/components/ui/dropdown-menu";
import { Disc3Icon, DiscAlbumIcon } from 'lucide-react';
import { filterExplicit, QobuzAlbum, QobuzSearchResults, QobuzTrack } from '@/lib/qobuz-dl';
import { getTailwindBreakpoint } from '@/lib/utils';
import { useSettings } from '@/lib/settings-provider';

const SearchView = () => {
    const { resolvedTheme } = useTheme();
    const [results, setResults] = useState<QobuzSearchResults | null>(null);
    const [searchField, setSearchField] = useState<"albums" | "tracks">('albums');
    const [query, setQuery] = useState<string>('');
    const [loading, setLoading] = useState<boolean>(false);
    const [searching, setSearching] = useState<boolean>(false);
    const [searchError, setSearchError] = useState<string>('');
    const { settings } = useSettings();

    const filterData = [
        {
            label: "Albums",
            value: 'albums',
            icon: DiscAlbumIcon
        },
        {
            label: "Tracks",
            value: 'tracks',
            icon: Disc3Icon
        }
    ]
    const FilterIcon = filterData.find((fd) => fd.value == searchField)?.icon || Disc3Icon;

    const [scrollTrigger, isInView] = useInView();

    const fetchMore = () => {
        setLoading(true);
        axios.get(`/api/get-music?q=${query}&offset=${results![searchField].items.length}`)
            .then((response) => {
                if (response.status === 200) {
                    let newResults = { ...results!, [searchField]: { ...results!.albums, items: [...results!.albums.items, ...response.data.data.albums.items] } }
                    filterData.map((filter) => {
                        newResults = { ...newResults, [filter.value]: { ...results![filter.value as "albums" | "tracks"], items: [...results![filter.value as "albums" | "tracks"].items, ...response.data.data[filter.value].items] } }
                    })
                    setLoading(false);
                    setResults(newResults);
                }
            });
    }

    useEffect(() => {
        if (results === null) return;
        if (results![searchField].total > results![searchField].items.length) {
            fetchMore();
        }
    }, [searchField])

    useEffect(() => {
        if (isInView && results![searchField].total > results![searchField].items.length && !loading) {
            fetchMore();
        }
    }, [isInView, results]);

    const finalItemRef = useRef<HTMLDivElement | null>(null);
    const [cardHeight, setCardHeight] = useState<number>(0);

    useEffect(() => {
        const element = finalItemRef.current;

        if (!element) return;

        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                if (entry.target === element) {
                    setCardHeight(entry.contentRect.height);
                }
            }
        });

        resizeObserver.observe(element);

        return () => {
            resizeObserver.disconnect();
        };
    }, [results, settings.explicitContent]);

    useLayoutEffect(() => {
        const handleResize = () => {
            if (typeof window !== 'undefined') {
                setNumRows(rowsMap[getTailwindBreakpoint(window.innerWidth)]);
            }
        };

        handleResize();

        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
        };
    }, []);

    const rowsMap = {
        "sm": 3,
        "md": 5,
        "lg": 6,
        "xl": 7,
        "2xl": 7,
        "base": 2
    }

    const [numRows, setNumRows] = useState(0);

    return (
        <>
            <div className="space-y-4">
                <div className="flex flex-col">
                    <h1 className="text-4xl font-bold text-center">{process.env.NEXT_PUBLIC_APPLICATION_NAME}</h1>
                    <p className='text-md text-center font-medium text-muted-foreground'>The simplest music downloader</p>
                </div>
                <div className="flex flex-col items-start justify-center">
                    <SearchBar onSearch={async (query: string) => {
                        setQuery(query);
                        setSearchError('');
                        try {
                            const response = await axios.get(`/api/get-music?q=${query}&offset=0`);
                            if (response.status === 200) {
                                setLoading(false);
                                setResults(response.data.data);
                            }
                        } catch (error: any) {
                            setSearchError(error?.response.data?.error || error.message || 'An error occurred.');
                        }
                        setSearching(false);
                    }} searching={searching} setSearching={setSearching} />

                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant='outline' className='my-2 flex gap-2 focus-visible:outline-none focus-visible:ring-transparent select-none shadow-none outline-none'>
                                <FilterIcon />
                                <span className='capitalize'>{searchField}</span>
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                            <DropdownMenuRadioGroup value={searchField} onValueChange={setSearchField as React.Dispatch<React.SetStateAction<string>>}>
                                {filterData.map((type, index) => (
                                    <DropdownMenuRadioItem
                                        key={index}
                                        value={type.value}
                                    >
                                        {type.label}
                                    </DropdownMenuRadioItem>
                                ))}
                            </DropdownMenuRadioGroup>
                        </DropdownMenuContent>
                    </DropdownMenu>
                    {searchError && <p className="text-destructive w-full text-center font-semibold">{searchError}</p>}
                </div>
            </div>

            <div>
                {results && <div className="my-6 w-screen mx-auto max-w-[1600px] pb-20">
                    <div
                        className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-4 w-full px-6 overflow-visible"
                        style={{ maxHeight: `${(Math.ceil(filterExplicit(results, settings.explicitContent)[searchField].items.length / numRows) + 2) * (cardHeight + 16)}px` }}
                    >
                        {filterExplicit(results, settings.explicitContent)[searchField].items.map((result: QobuzAlbum | QobuzTrack, index: number) => {
                            return (
                                <ReleaseCard
                                    key={index}
                                    result={result}
                                    resolvedTheme={String(resolvedTheme)}
                                    ref={index === filterExplicit(results, settings.explicitContent)[searchField].items.length - 1 ? finalItemRef : null}
                                />
                            );
                        })}
                        {results![searchField].items.length < results![searchField].total && [...Array(results![searchField].total > results![searchField].items.length + 30 ? 30 : results![searchField].total - results![searchField].items.length)].map((_, index) => {
                            return (
                                <div key={index} className="relative w-full">
                                    <Skeleton className="relative w-full aspect-square group select-none rounded-sm overflow-hidden" ref={index === 0 ? scrollTrigger : null} />
                                    <div className="h-[40px]"></div>
                                </div>
                            );
                        })}
                    </div>
                    {results![searchField].items.length >= results![searchField].total && <div className="w-full h-[40px] text-lg flex items-center justify-center font-semibold pt-8">No more {searchField} to show.</div>}
                </div>}
            </div>
        </>
    )
}

export default SearchView