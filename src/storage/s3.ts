import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { z } from "zod";

import { defineStorage, type StoragePutOptions } from "./types.js";

const configSchema = z.object({
  bucket: z.string().describe("S3 bucket name"),
  prefix: z.string().default("").describe("key prefix inside the bucket"),
  region: z.string().describe("AWS region, e.g. us-east-1"),
  profile: z.string().optional().describe("AWS_PROFILE to resolve credentials from"),
});

function contentTypeFor(key: string, opts?: StoragePutOptions): string {
  if (opts?.contentType) return opts.contentType;
  if (key.endsWith(".jpeg") || key.endsWith(".jpg")) return "image/jpeg";
  if (key.endsWith(".mp4")) return "video/mp4";
  if (key.endsWith(".m3u8")) return "application/vnd.apple.mpegurl";
  if (key.endsWith(".ts")) return "video/mp2t";
  return "application/octet-stream";
}

export const S3Storage = defineStorage({
  id: "s3",
  title: "Amazon S3",
  description: "Uploads artifacts to an S3 bucket. Credentials from the AWS env chain.",
  configSchema,
  create: config => {
    const client = new S3Client({ region: config.region });
    const prefix = config.prefix.replace(/^\/+|\/+$/g, "");
    const fullKey = (key: string): string => `${prefix}/${key}`.replace(/^\/+/, "");
    return {
      get: async key => {
        try {
          const out = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: fullKey(key) }));
          return out.Body ? Buffer.from(await out.Body.transformToByteArray()) : null;
        } catch {
          return null;
        }
      },
      put: async (key, body, opts) => {
        await client.send(
          new PutObjectCommand({
            Bucket: config.bucket,
            Key: fullKey(key),
            Body: body,
            ContentType: contentTypeFor(key, opts),
            CacheControl: opts?.cacheControl ?? "public, max-age=60",
          })
        );
      },
    };
  },
});
