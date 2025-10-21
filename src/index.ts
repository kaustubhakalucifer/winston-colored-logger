import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { BlobServiceClient } from "@azure/storage-blob";
import DailyRotateFile from "winston-daily-rotate-file";
import dayjs from "dayjs";
import fs from "fs";
import winston, { Logger } from "winston";

export interface LoggerConfig {
  label?: string;
  level?: "error" | "warn" | "info" | "debug";
  logDir?: string;
  cloud?: "s3" | "azure" | null;
  s3Config?: {
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    region: string;
  };
  azureConfig?: {
    connectionString: string;
    container: string;
  };
}

const colorizer = winston.format.colorize();

function setupCloudUpload(
  transport: DailyRotateFile,
  cloud: "s3" | "azure" | null,
  s3Config?: LoggerConfig["s3Config"],
  azureConfig?: LoggerConfig["azureConfig"]
) {
  transport.on("new", async (filename: string) => {
    const fileStream = fs.createReadStream(filename);
    const key = `logs/${filename.split("/").pop()}`;

    if (cloud === "s3" && s3Config) {
      try {
        const s3 = new S3Client({
          region: s3Config.region,
          credentials: {
            accessKeyId: s3Config.accessKeyId,
            secretAccessKey: s3Config.secretAccessKey,
          },
        });

        await s3.send(
          new PutObjectCommand({
            Bucket: s3Config.bucket,
            Key: key,
            Body: fileStream,
          })
        );

        console.log(`✅ Uploaded log to S3: ${key}`);
      } catch (err) {
        console.error("❌ S3 upload error:", err);
      }
    }

    if (cloud === "azure" && azureConfig) {
      try {
        const blobServiceClient = BlobServiceClient.fromConnectionString(
          azureConfig.connectionString
        );
        const containerClient = blobServiceClient.getContainerClient(
          azureConfig.container
        );

        const blockBlobClient = containerClient.getBlockBlobClient(key);
        await blockBlobClient.uploadFile(filename);

        console.log(`✅ Uploaded log to Azure Blob: ${key}`);
      } catch (err) {
        console.error("❌ Azure upload error:", err);
      }
    }
  });
}

export const createLogger = (config: LoggerConfig = {}) => {
  const {
    label = "app",
    level = "info",
    logDir = "logs",
    cloud = null,
    s3Config,
    azureConfig,
  } = config;

  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  // Separate rotated transports for error and info
  const errorTransport = new DailyRotateFile({
    dirname: logDir,
    filename: "error-%DATE%.log",
    datePattern: "YYYY-MM-DD",
    level: "error",
    zippedArchive: true,
    maxSize: "20m",
    maxFiles: "30d",
  });

  const infoTransport = new DailyRotateFile({
    dirname: logDir,
    filename: "info-%DATE%.log",
    datePattern: "YYYY-MM-DD",
    level: "info",
    zippedArchive: true,
    maxSize: "20m",
    maxFiles: "30d",
  });

  // Attach upload logic
  setupCloudUpload(errorTransport, cloud, s3Config, azureConfig);
  setupCloudUpload(infoTransport, cloud, s3Config, azureConfig);

  return winston.createLogger({
    level,
    format: winston.format.combine(
      winston.format.label({ label }),
      winston.format.timestamp({
        format: () => dayjs().format("YYYY-MM-DD HH:mm:ss"),
      }),
      winston.format.errors({ stack: true }),
      winston.format.printf(({ level, message, label, timestamp, stack }) =>
        colorizer.colorize(
          level,
          `${timestamp} [${label}] ${level}: ${stack || message}`
        )
      )
    ),
    transports: [
      new winston.transports.Console(),
      errorTransport,
      infoTransport,
    ],
  });
};

export const logger: Logger = createLogger();
