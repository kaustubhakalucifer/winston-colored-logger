import AWS from "aws-sdk";
import { BlobServiceClient } from "@azure/storage-blob";
import DailyRotateFile from "winston-daily-rotate-file";
import dayjs from "dayjs";
import fs from "fs";
import winston from "winston";

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
  transport.on("new", (filename: string) => {
    if (cloud === "s3" && s3Config) {
      const s3 = new AWS.S3({
        accessKeyId: s3Config.accessKeyId,
        secretAccessKey: s3Config.secretAccessKey,
        region: s3Config.region,
      });

      s3.upload(
        {
          Bucket: s3Config.bucket,
          Key: `logs/${filename.split("/").pop()}`,
          Body: fs.createReadStream(filename),
        },
        (err) => {
          if (err) console.error("S3 upload error:", err);
        }
      );
    }

    if (cloud === "azure" && azureConfig) {
      const blobServiceClient = BlobServiceClient.fromConnectionString(
        azureConfig.connectionString
      );
      const containerClient = blobServiceClient.getContainerClient(
        azureConfig.container
      );

      const blockBlobClient = containerClient.getBlockBlobClient(
        `logs/${filename.split("/").pop()}`
      );

      blockBlobClient.uploadFile(filename).catch(console.error);
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

export const logger = createLogger();
