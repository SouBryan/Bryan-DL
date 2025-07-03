"use client";

import axios from 'axios';
import React, { useEffect, useState } from 'react';
import { Button } from './button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from './dialog';
import { ScrollTextIcon } from 'lucide-react';
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
            const response = await axios.get(`${process.env.NEXT_PUBLIC_GITHUB!.replace('github.com', 'raw.githubusercontent.com')}/changelog.json`);
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
                <Button variant="outline" size="icon" onClick={() => { setOpen(true); }}>
                    <ScrollTextIcon />
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Changelog</DialogTitle>
                    <DialogDescription>View the latest updates and features</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                    {logs.map((log, index) => (
                        <div key={index}>
                            <h3 className="text-lg font-semibold">{log.title}</h3>
                            <span className="text-sm text-muted-foreground">{new Date(log.date ?? new Date()).toString()}</span>
                            <ul className="list-disc pl-4">
                                {log.changes.map((change, index) => (
                                    <li key={index}>{change}</li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default ChangelogDialog;