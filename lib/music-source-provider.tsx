'use client';
import React, { createContext, useContext, useState, ReactNode, useEffect } from 'react';

export type MusicSource = 'qobuz' | 'apple-music' | 'both';

interface MusicSourceContextType {
    musicSource: MusicSource;
    setMusicSource: React.Dispatch<React.SetStateAction<MusicSource>>;
    appleLossless: boolean;
}

const MusicSourceContext = createContext<MusicSourceContextType | undefined>(undefined);

export const MusicSourceProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [musicSource, setMusicSource] = useState<MusicSource>('both');
    const [appleLossless, setAppleLossless] = useState(false);

    useEffect(() => {
        const saved = localStorage.getItem('musicSource') as MusicSource | null;
        if (saved && ['qobuz', 'apple-music', 'both'].includes(saved)) setMusicSource(saved);
    }, []);

    useEffect(() => {
        localStorage.setItem('musicSource', musicSource);
    }, [musicSource]);

    // Check Apple Music capabilities when source includes Apple Music
    useEffect(() => {
        if (musicSource === 'apple-music' || musicSource === 'both') {
            fetch('/api/get-apple-capabilities')
                .then((res) => res.json())
                .then((data) => setAppleLossless(data.lossless === true))
                .catch(() => setAppleLossless(false));
        }
    }, [musicSource]);

    return <MusicSourceContext.Provider value={{ musicSource, setMusicSource, appleLossless }}>{children}</MusicSourceContext.Provider>;
};

export const useMusicSource = () => {
    const context = useContext(MusicSourceContext);
    if (!context) {
        throw new Error('useMusicSource must be used within a MusicSourceProvider');
    }
    return context;
};
