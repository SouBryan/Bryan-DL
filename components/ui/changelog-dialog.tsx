"use client";

import axios from 'axios';
import React, { useEffect, useState } from 'react';
import { Button } from './button';
import { ClockIcon, FileClockIcon } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from './dialog';
import { ScrollArea } from './scroll-area';
import { toast } from '@/hooks/use-toast';

type ChangeLog = {
    title: string,
    date: Date | string,
    changes: string[];
};

const ChangelogDialog = () => {
    const [open, setOpen] = useState<boolean>(false);

    const [logs, setLogs] = useState<ChangeLog[]>([]);

    const fetchChangelog = async () => {
        try {
            const response = await axios.get(`${process.env.NEXT_PUBLIC_GITHUB!.replace('github.com', 'raw.githubusercontent.com')}/refs/heads/main/changelog.json`);
            const data = await response.data;
            setLogs(data);
        }
        catch {
            toast({ title: 'Error', description: "Could not fetch the changelog!" });
        }
    };

    useEffect(() => {
        if (open) {
            fetchChangelog();
        }
    }, [open]);

    return (
        <Dialog
            open={open}
            onOpenChange={setOpen}
        >
            <DialogTrigger asChild>
                <Button title='Changelog' variant="outline" size="icon" onClick={() => { setOpen(true); }}>
                    <FileClockIcon />
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Changelog</DialogTitle>
                    <DialogDescription>View the latest updates and features</DialogDescription>
                </DialogHeader>
                <div className="-mt-4">
                    <ScrollArea className="space-y-6 max-h-[450px]">
                        {logs.map((log, index) => (
                            <div key={index} className='space-y-3'>
                                <div className="space-y-1">
                                    <h3 className="text-md font-semibold">{log.title}</h3>
                                    <div className="flex items-center gap-1.5">
                                        <ClockIcon className='text-sm text-muted-foreground size-3.5' />
                                        <span className="text-sm text-muted-foreground">{new Date(log.date).toDateString()}</span>
                                    </div>
                                </div>
                                <ul className="list-disc pl-4 text-sm space-y-1">
                                    {log.changes.map((change, index) => (
                                        <li key={index}>{change}</li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </ScrollArea>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default ChangelogDialog;