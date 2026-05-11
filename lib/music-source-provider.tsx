'use client';
import React, { createContext, useContext, useState, ReactNode, useEffect } from 'react';

export type MusicSource = 'qobuz' | 'apple-music' | 'both';

const MusicSourceContext = createContext<
    | {
          musicSource: MusicSource;
          setMusicSource: React.Dispatch<React.SetStateAction<MusicSource>>;
      }
    | undefined
>(undefined);

export const MusicSourceProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [musicSource, setMusicSource] = useState<MusicSource>('both');

    useEffect(() => {
        const saved = localStorage.getItem('musicSource') as MusicSource | null;
        if (saved && ['qobuz', 'apple-music', 'both'].includes(saved)) setMusicSource(saved);
    }, []);

    useEffect(() => {
        localStorage.setItem('musicSource', musicSource);
    }, [musicSource]);

    return <MusicSourceContext.Provider value={{ musicSource, setMusicSource }}>{children}</MusicSourceContext.Provider>;
};

export const useMusicSource = () => {
    const context = useContext(MusicSourceContext);
    if (!context) {
        throw new Error('useMusicSource must be used within a MusicSourceProvider');
    }
    return context;
};
