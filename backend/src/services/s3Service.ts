import AWS from 'aws-sdk';
import { Readable } from 'stream';
import config from '../config/env';

type StorageBackend = 's3' | 'r2';

interface StorageContext {
    provider: StorageBackend;
    bucketName: string;
    client: AWS.S3;
    region: string;
    publicBaseUrl: string;
}

function normalizeUrl(url: string): string {
    return url.endsWith('/') ? url.slice(0, -1) : url;
}

function getR2Endpoint(): string {
    if (config.r2.endpoint) {
        return config.r2.endpoint;
    }

    if (config.r2.accountId) {
        return `https://${config.r2.accountId}.r2.cloudflarestorage.com`;
    }

    return '';
}

function createS3Client(): AWS.S3 {
    return new AWS.S3({
        accessKeyId: config.aws.accessKeyId,
        secretAccessKey: config.aws.secretAccessKey,
        region: config.aws.region,
        signatureVersion: 'v4'
    });
}

function createR2Client(): AWS.S3 {
    const endpoint = getR2Endpoint();

    if (!endpoint) {
        throw new Error('R2 endpoint is not configured');
    }

    return new AWS.S3({
        accessKeyId: config.r2.accessKeyId,
        secretAccessKey: config.r2.secretAccessKey,
        region: 'auto',
        endpoint: new AWS.Endpoint(endpoint),
        s3ForcePathStyle: true,
        signatureVersion: 'v4'
    });
}

const s3Client = createS3Client();
let r2Client: AWS.S3 | null = null;

function getStorageContext(provider?: StorageBackend): StorageContext {
    const selectedProvider = provider || config.objectStorage.provider;

    if (selectedProvider === 'r2') {
        if (!r2Client) {
            r2Client = createR2Client();
        }

        if (!config.r2.bucketName) {
            throw new Error('R2_BUCKET_NAME is not configured');
        }

        return {
            provider: 'r2',
            bucketName: config.r2.bucketName,
            client: r2Client,
            region: 'auto',
            publicBaseUrl: config.r2.publicBaseUrl
        };
    }

    if (!config.aws.s3BucketName) {
        throw new Error('AWS_S3_BUCKET_NAME is not configured');
    }

    return {
        provider: 's3',
        bucketName: config.aws.s3BucketName,
        client: s3Client,
        region: config.aws.region,
        publicBaseUrl: ''
    };
}

function shouldRetryWithoutAcl(error: any): boolean {
    const code = typeof error?.code === 'string' ? error.code : '';
    const message = typeof error?.message === 'string' ? error.message : '';

    return (
        code === 'AccessControlListNotSupported' ||
        code === 'AccessDenied' ||
        message.includes('Access Denied') ||
        (message.includes('ACL') && message.includes('not supported'))
    );
}

function resolveObjectLocation(context: StorageContext, key: string, sdkLocation?: string): string {
    if (context.provider === 'r2') {
        if (context.publicBaseUrl) {
            return `${normalizeUrl(context.publicBaseUrl)}/${key}`;
        }

        if (sdkLocation) {
            return sdkLocation;
        }

        return `r2://${context.bucketName}/${key}`;
    }

    if (sdkLocation) {
        return sdkLocation;
    }

    return `https://${context.bucketName}.s3.${context.region}.amazonaws.com/${key}`;
}

async function bodyToBuffer(body: AWS.S3.Body): Promise<Buffer> {
    if (Buffer.isBuffer(body)) {
        return body;
    }

    if (typeof body === 'string') {
        return Buffer.from(body);
    }

    if (body instanceof Uint8Array) {
        return Buffer.from(body);
    }

    if (body instanceof Readable) {
        const chunks: Buffer[] = [];
        for await (const chunk of body) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        return Buffer.concat(chunks);
    }

    return Buffer.from(body as Uint8Array);
}

/**
 * Upload a file to object storage (S3 or R2)
 */
export const uploadToS3 = async (
    buffer: Buffer,
    key: string,
    contentType: string,
    provider?: StorageBackend
): Promise<string> => {
    const context = getStorageContext(provider);

    const baseParams = {
        Bucket: context.bucketName,
        Key: key,
        Body: buffer,
        ContentType: contentType
    };

    if (context.provider === 'r2') {
        const result = await context.client.upload(baseParams).promise();
        return resolveObjectLocation(context, key, result.Location);
    }

    const paramsWithAcl = {
        ...baseParams,
        ACL: 'public-read'
    };

    try {
        const result = await context.client.upload(paramsWithAcl).promise();
        return resolveObjectLocation(context, key, result.Location);
    } catch (error: any) {
        if (!shouldRetryWithoutAcl(error)) {
            throw error;
        }

        const fallbackResult = await context.client.upload(baseParams).promise();
        return resolveObjectLocation(context, key, fallbackResult.Location);
    }
};

/**
 * Generate a presigned URL for direct uploads
 */
export const getPresignedUrl = (
    key: string,
    contentType: string,
    expiresIn = 60,
    provider?: StorageBackend
): string => {
    const context = getStorageContext(provider);

    return context.client.getSignedUrl('putObject', {
        Bucket: context.bucketName,
        Key: key,
        ContentType: contentType,
        Expires: expiresIn
    });
};

/**
 * Resolve the stable public/read URL for an object key without uploading it here.
 * This is used by direct-to-storage uploads where the browser performs the PUT.
 */
export const getPublicObjectUrl = (key: string, provider?: StorageBackend): string => {
    const context = getStorageContext(provider);
    return resolveObjectLocation(context, key);
};

/**
 * Delete a file from object storage
 */
export const deleteFromS3 = async (key: string, provider?: StorageBackend): Promise<void> => {
    const context = getStorageContext(provider);

    await context.client
        .deleteObject({
            Bucket: context.bucketName,
            Key: key
        })
        .promise();
};

/**
 * Download a file from object storage
 */
export const downloadFromS3 = async (key: string, provider?: StorageBackend): Promise<Buffer> => {
    const context = getStorageContext(provider);

    const result = await context.client
        .getObject({
            Bucket: context.bucketName,
            Key: key
        })
        .promise();

    if (!result.Body) {
        throw new Error(`Object not found for key: ${key}`);
    }

    return bodyToBuffer(result.Body);
};
