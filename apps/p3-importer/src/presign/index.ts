import { randomUUID } from "node:crypto";
import { Logger } from "@aws-lambda-powertools/logger";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { loadPresignConfig } from "../shared/config";
import { makeHandler } from "./handler";

// Created once per execution environment (cold start) and reused across invocations.
const config = loadPresignConfig(process.env);
const s3 = new S3Client({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler = makeHandler({
  ddb,
  presignPost: (options) => createPresignedPost(s3, options),
  clock: () => new Date(),
  newId: randomUUID,
  logger: new Logger(), // service name from POWERTOOLS_SERVICE_NAME
  config,
});
