import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface ObjectStorage {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  signedReadUrl(key: string, expiresInSeconds?: number): Promise<string>;
  signedUploadUrl(key: string, contentType: string, expiresInSeconds?: number): Promise<string>;
}

export interface S3StorageConfig {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
}

export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;
  constructor(private readonly config: S3StorageConfig) {
    this.client = new S3Client({ endpoint: config.endpoint, region: config.region, forcePathStyle: config.forcePathStyle, credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } });
  }
  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.config.bucket, Key: key, Body: body, ContentType: contentType }));
  }
  signedReadUrl(key: string, expiresInSeconds = 900): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.config.bucket, Key: key }), { expiresIn: expiresInSeconds });
  }
  signedUploadUrl(key: string, contentType: string, expiresInSeconds = 900): Promise<string> {
    return getSignedUrl(this.client, new PutObjectCommand({ Bucket: this.config.bucket, Key: key, ContentType: contentType }), { expiresIn: expiresInSeconds });
  }
}
