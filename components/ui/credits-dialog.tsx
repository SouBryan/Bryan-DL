import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger, DialogHeader } from "@/components/ui/dialog";
import React from 'react';
import { Button } from './button';
import { InfoIcon, LinkIcon } from 'lucide-react';
import { FaDiscord } from '@react-icons/all-files/fa/FaDiscord'
import { FaSpotify } from '@react-icons/all-files/fa/FaSpotify'
import { FaSteam } from '@react-icons/all-files/fa/FaSteam'
import { FaGithub } from '@react-icons/all-files/fa/FaGithub'
import { Separator } from "./separator";
import { ScrollArea } from "./scroll-area";
import Link from "next/link";
import Image from "next/image";

const contributors = [
    {
        name: "Farmz",
        image: "/contributors/FarmzDev.webp",
        role: "Lead Developer",
        links: [
            { href: "https://discord.com/users/1093113069149880330", icon: <FaDiscord /> },
            { href: "https://github.com/FarmzDev/", icon: <FaGithub /> }
        ]
    },
    {
        name: "Jkable",
        image: "/contributors/Jkable.webp",
        role: "Lead Developer",
        links: [
            { href: "https://discord.com/users/662243382378233866", icon: <FaDiscord /> },
            { href: "https://github.com/Jkablez/", icon: <FaGithub /> }
        ]
    },
    {
        name: "Joel15",
        image: "/contributors/Joel15.webp",
        role: "Helped to purchase",
        roleAdditional: <a href="https://qobuz-dl.com" target="_blank" rel="noopener noreferrer" className="underline">https://qobuz-dl.com</a>,
        links: [
            { href: "https://discord.com/users/742554193700847627", icon: <FaDiscord /> },
            { href: "https://steamcommunity.com/profiles/76561198317104390", icon: <FaSteam /> },
            { href: "https://open.spotify.com/user/315reccubycoatin2rv5gjhostxe", icon: <FaSpotify /> }
        ]
    },
    {
        name: "Kobayashi",
        image: "/contributors/Kobayashi.webp",
        role: "Runs an instance of Qobuz-DL at",
        roleAdditional: <a href="https://squid.wtf" target="_blank" rel="noopener noreferrer" className="underline">https://squid.wtf</a>,
        links: [
            { href: "https://discord.com/users/742554193700847627", icon: <FaDiscord /> },
            { href: "https://ryuko.space/", icon: <LinkIcon /> }
        ]
    }
];

const CreditsDialog = () => {
    return (
        <Dialog>
            <DialogTrigger asChild>
                <Button variant="outline" size="icon">
                    <InfoIcon />
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-[85%] sm:max-w-[425px] md:max-w-[600px] w-full overflow-y-auto sm:max-h-[unset] max-h-[90vh] rounded-md">
                <DialogHeader>
                    <DialogTitle className="text-xl">{process.env.NEXT_PUBLIC_APPLICATION_NAME}</DialogTitle>
                    <DialogDescription>
                        A frontend browser client for downloading music for Qobuz.
                    </DialogDescription>
                </DialogHeader>
                <Separator />
                <div className="flex flex-col gap-1">
                    <DialogTitle>Links</DialogTitle>
                    <DialogDescription>Check out our GitHub and Discord!</DialogDescription>
                </div>
                <div className="flex justify-between items-center gap-2">
                    <div className="space-x-2">
                        <Link
                            href={process.env.NEXT_PUBLIC_GITHUB!}
                            rel="noopener noreferrer"
                            target="_blank"
                        >
                            <Button variant="outline" size="icon">
                                <FaGithub />
                            </Button>
                        </Link>
                        <Link
                            href="https://discord.com/invite/mWQ6bCfkfA"
                            rel="noopener noreferrer"
                            target="_blank"
                        >
                            <Button variant="outline" size="icon">
                                <FaDiscord />
                            </Button>
                        </Link>
                    </div>
                    <div className="space-x-2">
                        <Link
                            href={process.env.NEXT_PUBLIC_DISCORD!}
                            rel="noopener noreferrer"
                            target="_blank"
                        >
                            <Button variant="outline" size="icon">
                                <FaDiscord />
                            </Button>
                        </Link>
                    </div>
                </div>
                <Separator />
                <div className="space-y-1">
                    <DialogTitle>Contributors</DialogTitle>
                    <DialogDescription>Special thanks to our contributors!</DialogDescription>
                </div>
                <ScrollArea className="max-h-[340px] pr-4">
                    <div className="space-y-4">
                        {contributors.map((contributor, index) => (
                            <div key={index} className="flex justify-start relative items-start gap-2 w-full">
                                <Image
                                    src={contributor.image}
                                    alt={contributor.name}
                                    width={80}
                                    height={80}
                                    className="rounded-full shrink-0"
                                    quality={50}
                                />
                                <div className="h-full pl-1">
                                    <p title={contributor.name} className="font-bold text-xl">{contributor.name}</p>
                                    <div className="flex gap-2 my-1">
                                        {contributor.links.map((link, idx) => (
                                            <Link
                                                key={idx}
                                                href={link.href}
                                                rel="noopener noreferrer"
                                                target="_blank"
                                            >
                                                <Button variant="outline" size="icon">
                                                    {link.icon}
                                                </Button>
                                            </Link>
                                        ))}
                                    </div>
                                    <p className="text-sm text-muted-foreground">
                                        {contributor.role}{' '}{contributor.roleAdditional}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                </ScrollArea>
            </DialogContent>
        </Dialog >
    );
};

export default CreditsDialog;
