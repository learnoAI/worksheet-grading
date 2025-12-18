/**
 * Image compression utility for worksheet uploads
 * Reduces file sizes by 50-70% before sending to server
 */

interface CompressionOptions {
    maxWidth?: number;
    maxHeight?: number;
    quality?: number;
    mimeType?: 'image/jpeg' | 'image/webp';
}

const DEFAULT_OPTIONS: CompressionOptions = {
    maxWidth: 2000,
    maxHeight: 2000,
    quality: 0.8,
    mimeType: 'image/jpeg'
};

/**
 * Compresses an image file using canvas
 * @param file - The image file to compress
 * @param options - Compression options
 * @returns A promise that resolves to the compressed file
 */
export async function compressImage(
    file: File,
    options: CompressionOptions = {}
): Promise<File> {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    // Skip compression for small files (< 500KB)
    if (file.size < 500 * 1024) {
        return file;
    }

    // Skip non-image files
    if (!file.type.startsWith('image/')) {
        return file;
    }

    return new Promise((resolve, reject) => {
        const img = new Image();
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        if (!ctx) {
            resolve(file); // Fallback to original
            return;
        }

        img.onload = () => {
            // Calculate new dimensions maintaining aspect ratio
            let { width, height } = img;

            if (width > opts.maxWidth!) {
                height = (height * opts.maxWidth!) / width;
                width = opts.maxWidth!;
            }

            if (height > opts.maxHeight!) {
                width = (width * opts.maxHeight!) / height;
                height = opts.maxHeight!;
            }

            canvas.width = width;
            canvas.height = height;

            // Draw and compress
            ctx.drawImage(img, 0, 0, width, height);

            canvas.toBlob(
                (blob) => {
                    if (!blob) {
                        resolve(file); // Fallback to original
                        return;
                    }

                    // Create new file with compressed data
                    const compressedFile = new File([blob], file.name, {
                        type: opts.mimeType,
                        lastModified: Date.now()
                    });

                    // Only use compressed if it's actually smaller
                    if (compressedFile.size < file.size) {
                        console.log(
                            `📦 Compressed ${file.name}: ${formatBytes(file.size)} → ${formatBytes(compressedFile.size)} (${Math.round((1 - compressedFile.size / file.size) * 100)}% reduction)`
                        );
                        resolve(compressedFile);
                    } else {
                        resolve(file);
                    }
                },
                opts.mimeType,
                opts.quality
            );
        };

        img.onerror = () => {
            resolve(file); // Fallback to original on error
        };

        // Load image from file
        const reader = new FileReader();
        reader.onload = (e) => {
            img.src = e.target?.result as string;
        };
        reader.onerror = () => resolve(file);
        reader.readAsDataURL(file);
    });
}

/**
 * Compresses multiple image files
 */
export async function compressImages(
    files: File[],
    options?: CompressionOptions
): Promise<File[]> {
    return Promise.all(files.map(file => compressImage(file, options)));
}

/**
 * Format bytes to human readable string
 */
function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
