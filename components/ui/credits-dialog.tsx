import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger, DialogHeader } from "@/components/ui/dialog";
import React from 'react'
import { Button } from './button'
import { InfoIcon, LinkIcon } from 'lucide-react'
import { FaDiscord } from '@react-icons/all-files/fa/FaDiscord'
import { FaSpotify } from '@react-icons/all-files/fa/FaSpotify'
import { FaSteam } from '@react-icons/all-files/fa/FaSteam'
import { FaGithub } from '@react-icons/all-files/fa/FaGithub'
import { Separator } from '@radix-ui/react-dropdown-menu'

const CreditsDialog = () => {
    return (
        <Dialog>
            <DialogTrigger asChild>
                <Button variant="outline" size="icon">
                    <InfoIcon />
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-[80%] sm:max-w-[425px] rounded-md">
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
                <div className="flex justify-center items-center gap-2">
                    <a href={process.env.NEXT_PUBLIC_GITHUB} rel="noopener noreferrer" target="_blank">
                        <Button variant="outline" size="icon">
                            <FaGithub />
                        </Button>
                    </a>
                    <a href="https://discord.com/invite/mWQ6bCfkfA" rel="noopener noreferrer" target="_blank">
                        <Button variant="outline" size="icon">
                            <FaDiscord />
                        </Button>
                    </a>
                    <p>/</p>
                    <a href={process.env.NEXT_PUBLIC_DISCORD} rel="noopener noreferrer" target="_blank">
                        <Button variant="outline" size="icon">
                            <FaDiscord />
                        </Button>
                    </a>
                </div>
                <Separator />
                <div className="flex flex-col gap-1">
                    <DialogTitle>Contributors</DialogTitle>
                    <DialogDescription>Special thanks to our contributors!</DialogDescription>
                </div>
                <div className="flex justify-start items-center gap-2 w-full">
                    <img src="/contributors/FarmzDev.webp" alt="Farmz" crossOrigin="anonymous" className="w-20 h-20 rounded-full" />
                    <div className="h-full pl-1">
                        <p className="font-bold text-xl">Farmz</p>
                        <a href="https://discord.com/users/1093113069149880330" rel="noopener noreferrer" target="_blank">
                            <Button variant="outline" size="icon">
                                <FaDiscord />
                            </Button>
                        </a>
                        <a href="https://github.com/FarmzDev/" rel="noopener noreferrer" target="_blank">
                            <Button variant="outline" size="icon">
                                <FaGithub />
                            </Button>
                        </a>
                        <p className="text-sm text-muted-foreground">Main Developer</p>
                    </div>
                </div>
                <div className="flex justify-start items-center gap-2 w-full">
                    <img src="/contributors/Jkable.webp" alt="Jkable" crossOrigin="anonymous" className="w-20 h-20 rounded-full" />
                    <div className="h-full pl-1">
                        <p className="font-bold text-xl">Jkable</p>
                        <a href="https://discord.com/users/662243382378233866" rel="noopener noreferrer" target="_blank">
                            <Button variant="outline" size="icon">
                                <FaDiscord />
                            </Button>
                        </a>
                        <a href="https://github.com/Jkablez/" rel="noopener noreferrer" target="_blank">
                            <Button variant="outline" size="icon">
                                <FaGithub />
                            </Button>
                        </a>
                        <p className="text-sm text-muted-foreground">Helped with development</p>
                    </div>
                </div>
                <div className="flex justify-start items-center gap-2 w-full">
                    <img src="/contributors/Joel15.webp" alt="Joel15" crossOrigin="anonymous" className="w-20 h-20 rounded-full" />
                    <div className="h-full pl-1">
                        <p className="font-bold text-xl">Joel15</p>
                        <a href="https://discord.com/users/742554193700847627" rel="noopener noreferrer" target="_blank">
                            <Button variant="outline" size="icon">
                                <FaDiscord />
                            </Button>
                        </a>
                        <a href="https://steamcommunity.com/profiles/76561198317104390" rel="noopener noreferrer" target="_blank">
                            <Button variant="outline" size="icon">
                                <FaSteam />
                            </Button>
                        </a>
                        <a href="https://open.spotify.com/user/315reccubycoatin2rv5gjhostxe" rel="noopener noreferrer" target="_blank">
                            <Button variant="outline" size="icon">
                                <FaSpotify />
                            </Button>
                        </a>
                        <p className="text-sm text-muted-foreground">Helped to purchase <a href="https://qobuz-dl.com" target="_blank" rel="noopener noreferrer" className="underline">https://qobuz-dl.com</a></p>
                    </div>
                </div>
                <div className="flex justify-start items-center gap-2 w-full">
                    <img src="/contributors/Kobayashi.webp" alt="Kobayashi" crossOrigin="anonymous" className="w-20 h-20 rounded-full" />
                    <div className="h-full pl-1">
                        <p className="font-bold text-xl">Kobayashi</p>
                        <a href="https://discord.com/users/742554193700847627" rel="noopener noreferrer" target="_blank">
                            <Button variant="outline" size="icon">
                                <FaDiscord />
                            </Button>
                        </a>
                        <a href="https://ryuko.space/" rel="noopener noreferrer" target="_blank">
                            <Button variant="outline" size="icon">
                                <LinkIcon />
                            </Button>
                        </a>
                        <p className="text-sm text-muted-foreground">Runs an instance of Qobuz-DL at <a href="https://squid.wtf" target="_blank" rel="noopener noreferrer" className="underline">https://squid.wtf</a></p>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}

export default CreditsDialog