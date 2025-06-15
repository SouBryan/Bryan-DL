import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

export const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 Bytes";

    const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));

    const sizeInUnit = bytes / Math.pow(1024, i);

    const formattedSize = new Intl.NumberFormat("en-US", {
        maximumFractionDigits: i >= 3 ? 2 : 0,
    }).format(sizeInUnit);

    return `${formattedSize} ${sizes[i]}`;
};

export const cleanFileName = (filename: string) => {
    const bannedChars = ["/", "\\", "?", ":", "*", '"', "<", ">", "|"];
    for (const char in bannedChars) {
        filename = filename.replaceAll(bannedChars[char], "_");
    };
    return filename;
}

export function getTailwindBreakpoint(width: any) {
    if (width >= 1536) {
        return '2xl';
    } else if (width >= 1280) {
        return 'xl';
    } else if (width >= 1024) {
        return 'lg';
    } else if (width >= 768) {
        return 'md';
    } else if (width >= 640) {
        return 'sm';
    } else {
        return 'base'; // Base size (less than 640px)
    }
}

export async function resizeImage(imageURL: string, quality: number): Promise<string | null> {
    return new Promise((resolve) => {
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        const imgToResize = new Image();
        imgToResize.crossOrigin = "anonymous";
        imgToResize.src = imageURL;
        imgToResize.onerror = () => resolve(null);
        imgToResize.onload = () => {
            canvas.width = 3000;
            canvas.height = 3000;
            context!.drawImage(
                imgToResize,
                0,
                0,
                quality,
                quality
            );
            resolve(canvas.toDataURL("image/jpeg"));
        }
    })
}