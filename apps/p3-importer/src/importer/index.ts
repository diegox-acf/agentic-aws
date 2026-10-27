import { Logger } from "@aws-lambda-powertools/logger";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { SNSClient } from "@aws-sdk/client-sns";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { loadImporterConfig } from "../shared/importer-config";
import { makeImporterHandler } from "./handler";
import { snsNotifier } from "./notify";

// Created once per execution environment (cold start) and reused across invocations.
const config = loadImporterConfig(process.env);

export const handler = makeImporterHandler({
  ddb: DynamoDBDocumentClient.from(new DynamoDBClient({})),
  s3: new S3Client({}),
  clock: () => new Date(),
  logger: new Logger(), // service name from POWERTOOLS_SERVICE_NAME
  config,
  notify: snsNotifier(new SNSClient({}), config.resultsTopicArn),
});
