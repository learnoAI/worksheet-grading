import AWS from 'aws-sdk';
import config from '../config/env';

// Configure AWS SDK
AWS.config.update({
    accessKeyId: config.aws.accessKeyId,
    secretAccessKey: config.aws.secretAccessKey,
    region: config.aws.region
});

const s3 = new AWS.S3();

/**
 * Upload a file to S3
 * @param buffer - File buffer
 * @param key - S3 object key (path)
 * @param contentType - File MIME type
 * @returns Promise with S3 upload URL
 */
export const uploadToS3 = async (
    buffer: Buffer,
    key: string,
    contentType: string
): Promise<string> => {
    const params = {
        Bucket: config.aws.s3BucketName,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        ACL: 'public-read'
    };

    const result = await s3.upload(params).promise();
    return result.Location;
};

/**
 * Generate a presigned URL for direct client uploads
 * @param key - S3 object key (path)
 * @param contentType - File MIME type
 * @param expiresIn - Expiration time in seconds (default: 60)
 * @returns Presigned URL
 */
export const getPresignedUrl = (
    key: string,
    contentType: string,
    expiresIn = 60
): string => {
    const params = {
        Bucket: config.aws.s3BucketName,
        Key: key,
        ContentType: contentType,
        Expires: expiresIn
    };

    return s3.getSignedUrl('putObject', params);
};

/**
 * Delete a file from S3
 * @param key - S3 object key (path)
 * @returns Promise that resolves when the file is deleted
 */
export const deleteFromS3 = async (key: string): Promise<void> => {
    const params = {
        Bucket: config.aws.s3BucketName,
        Key: key
    };

    await s3.deleteObject(params).promise();
}; 