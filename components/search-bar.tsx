"use client"

import React, { useState, useRef, useEffect } from 'react'
import { Input } from "@/components/ui/input";
import { Button } from './ui/button';
import { ArrowRightIcon, Loader2Icon, SearchIcon } from 'lucide-react';
import { Label } from './ui/label';

const SearchBar = ({ onSearch, searching, setSearching }: { onSearch: (query: string) => void, searching: boolean, setSearching: React.Dispatch<React.SetStateAction<boolean>> }) => {
    const [searchInput, setSearchInput] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);

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
    return (
        <div className="flex items-center gap-2">
            <div onClick={() => inputRef.current?.focus()} className="bg-background border relative sm:w-[600px] w-full tracking-wide font-semibold rounded-md flex gap-0.5 items-center py-1 px-3">
                <Label htmlFor='search'>
                    <SearchIcon className='!size-5' />
                </Label>
                <Input id="search" className="focus-visible:outline-none focus-visible:ring-transparent select-none shadow-none outline-none border-none" ref={inputRef} placeholder="Search for anything..." onKeyDown={
                    (event: React.KeyboardEvent<HTMLInputElement>) => {
                        const target = event.currentTarget as HTMLInputElement;
                        if (event.key === "Enter") {
                            if (target.value.trim().length > 0 && !searching) {
                                setSearching(true);
                                onSearch(target.value.trim());
                            }
                        }
                    }
                } onChange={(event) => setSearchInput(event.currentTarget.value)} />
            </div>
            <Button
                size="icon"
                className="w-11 h-11 disabled:bg-muted bg-primary disabled:text-foreground text-primary-foreground hover:text-primary-foreground hover:bg-primary/90"
                variant='ghost'
                onClick={() => {
                    if (searchInput.trim().length > 0 && !searching) {
                        setSearching(true);
                        onSearch(searchInput.trim())
                    }
                }}
                disabled={searching || !(searchInput.trim().length > 0)}
            >
                {searching ? <Loader2Icon className='animate-spin' /> : <ArrowRightIcon />}
            </Button>
        </div>
    )
}

export default SearchBar