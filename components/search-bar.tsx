"use client"
import React, { JSX, useState, useRef, useEffect } from 'react'
import { Input } from "@/components/ui/input";
import { Button } from './ui/button';
import { ArrowRightIcon, Loader2Icon, SearchIcon } from 'lucide-react';

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
            <div className="bg-background border sm:w-[600px] w-full tracking-wide font-semibold rounded-md flex gap-0.5 items-center py-1 px-3">
                <SearchIcon className='!size-5' />
                <Input className="focus-visible:outline-none focus-visible:ring-transparent select-none shadow-none outline-none border-none" ref={inputRef} placeholder="Search for anything..." onKeyDown={
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
            <Button size="icon" className="w-10 h-10 disabled:bg-muted-foreground disabled:opacity-100 aspect-square" onClick={() => {
                if (searchInput.trim().length > 0 && !searching) {
                    setSearching(true);
                    onSearch(searchInput.trim())
                }
            }} disabled={searching || !(searchInput.trim().length > 0)}>
                {searching ? <Loader2Icon className='animate-spin' /> : <ArrowRightIcon />}
            </Button>
        </div>
    )
}

export default SearchBar