"use client";

import React, { useState, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "./ui/button";
import { ArrowRightIcon, Loader2Icon, SearchIcon } from "lucide-react";
import { Label } from "./ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { cn } from "@/lib/utils";
import axios from "axios";
import { formatTitle, QobuzAlbum, QobuzSearchResults, QobuzTrack } from "@/lib/qobuz-dl";
import { Skeleton } from "./ui/skeleton";
import { AnimatePresence, motion } from "framer-motion";

const SearchBar = ({ onSearch, searching, setSearching, setSearchField, setQuery, query }: { onSearch: (query: string) => void; searching: boolean; setSearching: React.Dispatch<React.SetStateAction<boolean>>, setSearchField: React.Dispatch<React.SetStateAction<"albums" | "tracks">>, setQuery: React.Dispatch<React.SetStateAction<string>>, query: string }) => {
    const [searchInput, setSearchInput] = useState(query);
    const [results, setResults] = useState<QobuzSearchResults | null>(null);
    const [loading, setLoading] = useState<boolean>(false);
    const [showCard, setShowCard] = useState(false);
    const [controller, setController] = useState<AbortController>(new AbortController());

    const inputRef = useRef<HTMLInputElement>(null);
    const cardRef = useRef<HTMLDivElement>(null);

    const limit = 10;

    useEffect(() => {
        setSearchInput(query);
    }, [query])

    useEffect(() => {
        if (inputRef.current) setSearchInput(inputRef.current.value);

        const handleKeydown = (event: KeyboardEvent) => {
            if (event.ctrlKey && event.key.toLowerCase() === "k") {
                event.preventDefault();
                inputRef.current?.focus();
            }
        };
        window.addEventListener("keydown", handleKeydown);

        return () => {
            window.removeEventListener("keydown", handleKeydown);
        };
    }, []);

    useEffect(() => {
        controller.abort();
        const fetchResults = async () => {
            if (searchInput.trim().length === 0) {
                return;
            };

            setLoading(true);

            const newController = new AbortController();
            setController(newController);

            try {
                setTimeout(async () => {
                    try {
                        const response = await axios.get(`/api/get-music?q=${searchInput}&offset=0`, { signal: newController.signal });
                        if (response.status === 200) {
                            setResults(response.data.data);
                        }
                    } catch { }
                }, 200);
            } catch { }

            setLoading(false);
        };

        fetchResults();
    }, [searchInput]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (
                cardRef.current &&
                !cardRef.current.contains(event.target as Node) &&
                inputRef.current &&
                !inputRef.current.contains(event.target as Node)
            ) {
                setShowCard(false);
            }
        };

        document.addEventListener("mousedown", handleClickOutside);

        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, []);

    return (
        <div className="flex items-center gap-2 relative">
            <div
                onClick={() => {
                    inputRef.current?.focus();
                    setShowCard(true);
                }}
                className="bg-background border relative sm:w-[600px] w-full tracking-wide font-semibold rounded-md flex gap-0.5 items-center py-1 px-3"
            >
                <Label htmlFor="search">
                    <SearchIcon className="!size-5" />
                </Label>
                <Input
                    id="search"
                    className="focus-visible:outline-none focus-visible:ring-transparent select-none shadow-none outline-none border-none"
                    ref={inputRef}
                    placeholder="Search for anything..."
                    value={searchInput}
                    onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
                        const target = event.currentTarget as HTMLInputElement;
                        if (event.key === "Enter") {
                            if (target.value.trim().length > 0 && !searching) {
                                setSearching(true);
                                onSearch(target.value.trim());
                            }
                        }
                    }}
                    onChange={(event) => {
                        setSearchInput(event.currentTarget.value);
                    }}
                />
            </div>
            <Button
                size="icon"
                className="w-11 h-11 shrink-0 disabled:bg-muted bg-primary disabled:text-foreground text-primary-foreground hover:text-primary-foreground hover:bg-primary/90"
                variant="ghost"
                onClick={() => {
                    if (searchInput.trim().length > 0 && !searching) {
                        setSearching(true);
                        onSearch(searchInput.trim());
                    }
                }}
                disabled={searching || !(searchInput.trim().length > 0)}
            >
                {searching ? <Loader2Icon className="animate-spin" /> : <ArrowRightIcon />}
            </Button>

            <AnimatePresence>
                {showCard && (
                    <motion.div
                        initial={{ opacity: 0, translateY: -10, zIndex: 1000 }}
                        animate={{
                            opacity: 1,
                            translateY: 0,
                            transition: {
                                type: "spring",
                                stiffness: 150,
                                damping: 10,
                                duration: 0.5,
                            },
                        }}
                        exit={{
                            opacity: 0,
                            translateY: -10,
                            transition: {
                                type: "spring",
                                stiffness: 150,
                                damping: 10,
                                duration: 0.4,
                            },
                        }}
                        className="absolute top-0 left-0 right-0 mx-auto mt-0 w-full !z-[100]"
                    >
                        <Card
                            ref={cardRef}
                            className={cn(
                                "absolute top-12 left-0 right-0 mx-auto mt-0.5 w-full transition-all !z-[100]",
                                searchInput.trim().length > 0 && !searching ? "opacity-100" : "opacity-0"
                            )}
                        >
                            <CardHeader>
                                <CardTitle className="text-base flex md:flex-row flex-col md:items-center md:gap-2 gap-0.5">
                                    Quick Search
                                    <span className="text-xs text-muted-foreground">
                                        Showing {(results?.tracks.items.slice(0, (limit / 2)).length || 0) + (results?.albums.items.slice(0, (limit / 2)).length || 0)} of {limit}
                                    </span>
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <motion.div
                                    initial="hidden"
                                    animate="visible"
                                    exit="hidden"
                                    variants={{
                                        hidden: { opacity: 0 },
                                        visible: {
                                            opacity: 1,
                                            transition: {
                                                staggerChildren: 0.125,
                                            },
                                        },
                                    }}
                                    className="flex flex-col gap-2 select-none"
                                >
                                    <div className="md:grid flex flex-col md:max-h-[unset] max-h-[15vh] md:pr-0 pr-2 overflow-y-auto md:grid-cols-2 gap-6">
                                        {["albums", "tracks"].map((key, index) => (
                                            <motion.div
                                                key={index}
                                                variants={{
                                                    hidden: { opacity: 0, y: 10 },
                                                    visible: { opacity: 1, y: 0 },
                                                }}
                                                className="flex flex-col gap-1"
                                            >
                                                <p className="text-sm font-semibold mb-1 capitalize">{key}</p>
                                                {results?.[key as "albums" | "tracks"].items.slice(0, limit / 2).map((result: QobuzAlbum | QobuzTrack, index) => {
                                                    const value = key === "albums"
                                                        ? `${formatTitle(result as QobuzAlbum)} - ${(result as QobuzAlbum).artist.name}`
                                                        : `${formatTitle(result as QobuzTrack)} - ${(result as QobuzTrack).album.artist.name}`;

                                                    const title = formatTitle(result as QobuzAlbum | QobuzTrack);

                                                    return loading ? (
                                                        <Skeleton
                                                            key={index}
                                                            className="h-4"
                                                        />
                                                    ) : (
                                                        <motion.p
                                                            key={index}
                                                            onClick={() => {
                                                                setSearchInput(value);
                                                                setQuery(value);
                                                                setShowCard(false);
                                                                setSearchField(key as "albums" | "tracks");
                                                                setSearching(true);
                                                                onSearch(value);
                                                            }}
                                                            variants={{
                                                                hidden: { opacity: 0, y: 5 },
                                                                visible: { opacity: 1, y: 0 },
                                                            }}
                                                            className="text-sm hover:underline underline-offset-2 decoration-1 h-fit w-full truncate cursor-pointer justify-start text-muted-foreground"
                                                            title={title}
                                                        >
                                                            {title}
                                                        </motion.p>
                                                    );
                                                })}
                                                {results?.[key as "albums" | "tracks"]?.items.length === 0 && (
                                                    <p className="w-full h-full flex capitalize items-center justify-center text-xs text-muted-foreground p-4 border-2 border-dashed rounded-md">
                                                        No Results Found
                                                    </p>
                                                )}
                                            </motion.div>
                                        ))}
                                    </div>
                                </motion.div>
                            </CardContent>
                        </Card>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default SearchBar;