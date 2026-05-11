import React, { useState } from 'react';
import { Select, SelectContent, SelectItem } from './ui/select';
import { SelectTrigger } from '@radix-ui/react-select';
import { ChevronDownIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMusicSource, MusicSource } from '@/lib/music-source-provider';

const sourceOptions: { value: MusicSource; label: string; icon: string }[] = [
    { value: 'both', label: 'Both', icon: '🎵' },
    { value: 'qobuz', label: 'Qobuz', icon: '🇶' },
    { value: 'apple-music', label: 'Apple Music', icon: '🍎' },
];

const SourcePicker = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => {
    const { musicSource, setMusicSource } = useMusicSource();
    const [open, setOpen] = useState(false);
    const current = sourceOptions.find((o) => o.value === musicSource) || sourceOptions[0];

    return (
        <div className={cn('flex', className)} ref={ref} {...props}>
            <Select value={musicSource} onValueChange={(v) => setMusicSource(v as MusicSource)} open={open} onOpenChange={setOpen}>
                <SelectTrigger className='select-none outline-none'>
                    <div className='bg-background rounded-full'>
                        <div className='bg-primary/10 flex gap-2 px-3 py-1 rounded-full outline-primary/40 outline-[0.5px] outline items-center justify-center text-nowrap'>
                            {current.icon}
                            <span className='text-sm'>{current.label}</span>
                            <ChevronDownIcon className='w-4 h-4' />
                        </div>
                    </div>
                </SelectTrigger>
                <SelectContent className='mt-2'>
                    {sourceOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                            <div className='flex gap-2 items-center'>
                                {option.icon}
                                {option.label}
                            </div>
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    );
});

export default SourcePicker;
