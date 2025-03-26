"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteFromS3 = exports.getPresignedUrl = exports.uploadToS3 = void 0;
const aws_sdk_1 = __importDefault(require("aws-sdk"));
const env_1 = __importDefault(require("../config/env"));
// Configure AWS SDK
aws_sdk_1.default.config.update({
    accessKeyId: env_1.default.aws.accessKeyId,
    secretAccessKey: env_1.default.aws.secretAccessKey,
    region: env_1.default.aws.region
});
const s3 = new aws_sdk_1.default.S3();
/**
 * Upload a file to S3
 * @param buffer - File buffer
 * @param key - S3 object key (path)
 * @param contentType - File MIME type
 * @returns Promise with S3 upload URL
 */
const uploadToS3 = (buffer, key, contentType) => __awaiter(void 0, void 0, void 0, function* () {
    const params = {
        Bucket: env_1.default.aws.s3BucketName,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        ACL: 'public-read'
    };
    const result = yield s3.upload(params).promise();
    return result.Location;
});
exports.uploadToS3 = uploadToS3;
/**
 * Generate a presigned URL for direct client uploads
 * @param key - S3 object key (path)
 * @param contentType - File MIME type
 * @param expiresIn - Expiration time in seconds (default: 60)
 * @returns Presigned URL
 */
const getPresignedUrl = (key, contentType, expiresIn = 60) => {
    const params = {
        Bucket: env_1.default.aws.s3BucketName,
        Key: key,
        ContentType: contentType,
        Expires: expiresIn
    };
    return s3.getSignedUrl('putObject', params);
};
exports.getPresignedUrl = getPresignedUrl;
/**
 * Delete a file from S3
 * @param key - S3 object key (path)
 * @returns Promise that resolves when the file is deleted
 */
const deleteFromS3 = (key) => __awaiter(void 0, void 0, void 0, function* () {
    const params = {
        Bucket: env_1.default.aws.s3BucketName,
        Key: key
    };
    yield s3.deleteObject(params).promise();
});
exports.deleteFromS3 = deleteFromS3;
