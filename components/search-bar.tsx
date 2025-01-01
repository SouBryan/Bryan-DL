"use client"
import React, { JSX, useState } from 'react'
import { Input } from "@/components/ui/input";
import { Button } from './ui/button';
import { ArrowRightIcon } from 'lucide-react';

const SearchBar = ({ onSearch, icon, searching, setSearching }: { onSearch: (query: string) => void, icon: JSX.Element, searching: boolean, setSearching: React.Dispatch<React.SetStateAction<boolean>> }) => {
    const [searchInput, setSearchInput] = useState("");
    return (
        <div className="flex items-center gap-2">
            <div className="bg-background border sm:w-[600px] w-full tracking-wide font-semibold rounded-md flex gap-0.5 items-center py-1 px-3">
                {icon}
                <Input className="focus-visible:outline-none focus-visible:ring-transparent select-none shadow-none outline-none border-none" placeholder="Search for anything..." onKeyDown={
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
            <Button size="icon" className="w-10 h-10 disabled:bg-muted-foreground disabled:opacity-100 " onClick={() => { onSearch(""); setSearching(false) }} disabled={searching || !(searchInput.trim().length > 0)}>
                <ArrowRightIcon />
            </Button>
        </div>
    )
}

export default SearchBar