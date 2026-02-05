import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In-memory cache for frequently accessed images (LRU-style, max 100 items)
const MEMORY_CACHE = new Map();
const MAX_MEMORY_CACHE_SIZE = 100;

// Resolve cache directory: if CACHE_DIR is set, resolve it relative to project root if relative
// Otherwise default to ./cache relative to project root
function resolveCacheDir() {
  const projectRoot = path.resolve(__dirname, "../..");
  const cacheDirEnv = process.env.CACHE_DIR;
  
  if (cacheDirEnv) {
    // If absolute path, use as-is; if relative, resolve from project root
    return path.isAbsolute(cacheDirEnv) 
      ? cacheDirEnv 
      : path.resolve(projectRoot, cacheDirEnv);
  }
  
  // Default: cache directory in project root
  return path.resolve(projectRoot, "cache");
}

const CACHE_DIR = resolveCacheDir();
const STORAGE_TYPE = process.env.STORAGE_TYPE || "filesystem"; // "filesystem" or "azure-blob"

/**
 * Generate a deterministic cache key from request parameters.
 */
export function generateCacheKey(params) {
  // Sort keys for consistent hashing
  const sorted = Object.keys(params)
    .sort()
    .map((key) => `${key}:${params[key]}`)
    .join("|");
  return crypto.createHash("sha256").update(sorted).digest("hex");
}

/**
 * Get cache file path for a given key and format.
 */
function getCachePath(key, format) {
  const ext = format === "svg" ? "svg" : "png";
  return path.join(CACHE_DIR, `${key}.${ext}`);
}

/**
 * File system cache implementation.
 */
class FileSystemCache {
  async init() {
    try {
      await fs.mkdir(CACHE_DIR, { recursive: true });
    } catch (err) {
      console.error(`Failed to create cache directory: ${err.message}`);
    }
  }

  async get(key, format) {
    // Check in-memory cache first
    const memoryKey = `${key}:${format}`;
    if (MEMORY_CACHE.has(memoryKey)) {
      console.log(`[CACHE HIT] Memory cache for ${memoryKey.substring(0, 16)}...`);
      return MEMORY_CACHE.get(memoryKey);
    }
    console.log(`[CACHE MISS] Memory cache for ${memoryKey.substring(0, 16)}..., checking blob storage`);

    try {
      const filePath = getCachePath(key, format);
      const data = await fs.readFile(filePath);
      
      // Store in memory cache (evict oldest if needed)
      if (MEMORY_CACHE.size >= MAX_MEMORY_CACHE_SIZE) {
        const firstKey = MEMORY_CACHE.keys().next().value;
        MEMORY_CACHE.delete(firstKey);
      }
      // Store a copy of the buffer
      const bufferCopy = Buffer.isBuffer(data) ? Buffer.from(data) : data;
      MEMORY_CACHE.set(memoryKey, bufferCopy);
      
      return data;
    } catch (err) {
      if (err.code === "ENOENT") {
        return null; // Cache miss
      }
      throw err;
    }
  }

  async set(key, format, data) {
    // Store in memory cache immediately (synchronous, before any async operations)
    const memoryKey = `${key}:${format}`;
    if (MEMORY_CACHE.size >= MAX_MEMORY_CACHE_SIZE) {
      const firstKey = MEMORY_CACHE.keys().next().value;
      MEMORY_CACHE.delete(firstKey);
    }
    // Store a copy of the buffer
    const bufferCopy = Buffer.isBuffer(data) ? Buffer.from(data) : data;
    MEMORY_CACHE.set(memoryKey, bufferCopy);
    console.log(`[CACHE SET] Memory cache for ${memoryKey.substring(0, 16)}... (size: ${MEMORY_CACHE.size}/${MAX_MEMORY_CACHE_SIZE})`);
    
    // Write to filesystem (errors are non-fatal, memory cache is already set)
    try {
      const filePath = getCachePath(key, format);
      await fs.writeFile(filePath, data);
    } catch (err) {
      console.error(`Failed to write cache file: ${err.message}`);
      // Don't throw - caching is optional
    }
  }
}

/**
 * Azure Blob Storage cache implementation.
 * Uses managed identity when deployed to Azure, or DefaultAzureCredential for local dev.
 */
class AzureBlobCache {
  constructor() {
    this.containerName = process.env.AZURE_STORAGE_CONTAINER || "weather-images-cache";
    this.connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
    this.storageAccountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
    this.useManagedIdentity = process.env.AZURE_STORAGE_USE_MANAGED_IDENTITY === "true";
    
    if (!this.connectionString && !this.useManagedIdentity) {
      throw new Error(
        "Either AZURE_STORAGE_CONNECTION_STRING or AZURE_STORAGE_USE_MANAGED_IDENTITY=true with AZURE_STORAGE_ACCOUNT_NAME is required"
      );
    }
    
    if (this.useManagedIdentity && !this.storageAccountName) {
      throw new Error(
        "AZURE_STORAGE_ACCOUNT_NAME is required when using managed identity"
      );
    }
  }

  async init() {
    // Lazy import @azure/storage-blob to avoid requiring it if not using Azure
    const { BlobServiceClient } = await import("@azure/storage-blob");
    const { DefaultAzureCredential } = await import("@azure/identity");
    
    if (this.useManagedIdentity) {
      // Use managed identity (or DefaultAzureCredential chain for local dev)
      // DefaultAzureCredential automatically tries:
      // 1. Managed Identity (when running in Azure) - no config needed!
      // 2. Azure CLI (az login) - for local development
      // 3. Visual Studio Code
      // 4. Azure PowerShell
      const credential = new DefaultAzureCredential();
      const accountUrl = `https://${this.storageAccountName}.blob.core.windows.net`;
      this.client = new BlobServiceClient(accountUrl, credential);
    } else {
      // Use connection string
      this.client = BlobServiceClient.fromConnectionString(this.connectionString);
    }
    
    this.containerClient = this.client.getContainerClient(this.containerName);
    
    // Create container if it doesn't exist (omit access = private, works when account disallows public access)
    try {
      await this.containerClient.createIfNotExists();
    } catch (err) {
      console.error(`Failed to create Azure container: ${err.message}`);
    }
  }

  async get(key, format) {
    // Check in-memory cache first
    const memoryKey = `${key}:${format}`;
    if (MEMORY_CACHE.has(memoryKey)) {
      console.log(`[CACHE HIT] Memory cache for ${memoryKey.substring(0, 16)}...`);
      return MEMORY_CACHE.get(memoryKey);
    }
    console.log(`[CACHE MISS] Memory cache for ${memoryKey.substring(0, 16)}..., checking blob storage`);

    try {
      const blobName = `${key}.${format === "svg" ? "svg" : "png"}`;
      const blobClient = this.containerClient.getBlobClient(blobName);
      
      if (!(await blobClient.exists())) {
        return null; // Cache miss
      }
      
      // Stream download more efficiently
      const downloadResponse = await blobClient.download();
      const stream = downloadResponse.readableStreamBody;
      
      // Convert stream to buffer efficiently
      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      
      const buffer = Buffer.concat(chunks);
      
      // Store in memory cache (evict oldest if needed)
      if (MEMORY_CACHE.size >= MAX_MEMORY_CACHE_SIZE) {
        const firstKey = MEMORY_CACHE.keys().next().value;
        MEMORY_CACHE.delete(firstKey);
      }
      // Store a copy of the buffer
      const bufferCopy = Buffer.from(buffer);
      MEMORY_CACHE.set(memoryKey, bufferCopy);
      console.log(`[CACHE STORED] Memory cache for ${memoryKey.substring(0, 16)}... (size: ${MEMORY_CACHE.size}/${MAX_MEMORY_CACHE_SIZE})`);
      
      return buffer;
    } catch (err) {
      console.error(`Azure Blob get error: ${err.message}`);
      return null; // Treat errors as cache miss
    }
  }

  async set(key, format, data) {
    // Store in memory cache immediately (synchronous, before any async operations)
    const memoryKey = `${key}:${format}`;
    if (MEMORY_CACHE.size >= MAX_MEMORY_CACHE_SIZE) {
      const firstKey = MEMORY_CACHE.keys().next().value;
      MEMORY_CACHE.delete(firstKey);
    }
    // Store a copy of the buffer to ensure it's not modified elsewhere
    const bufferCopy = Buffer.isBuffer(data) ? Buffer.from(data) : data;
    MEMORY_CACHE.set(memoryKey, bufferCopy);
    console.log(`[CACHE SET] Memory cache for ${memoryKey.substring(0, 16)}... (size: ${MEMORY_CACHE.size}/${MAX_MEMORY_CACHE_SIZE})`);
    
    // Upload to blob storage (this can happen in background, errors are non-fatal)
    try {
      const blobName = `${key}.${format === "svg" ? "svg" : "png"}`;
      const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);
      const contentType = format === "svg" ? "image/svg+xml" : "image/png";
      
      await blockBlobClient.uploadData(data, {
        blobHTTPHeaders: { blobContentType: contentType },
      });
    } catch (err) {
      console.error(`Azure Blob set error: ${err.message}`);
      // Don't throw - caching is optional, memory cache is already set
    }
  }
}

// Initialize cache based on storage type
let cacheInstance = null;
let cacheInitPromise = null;

export async function getCache() {
  // If already initialized, return immediately (synchronous path)
  if (cacheInstance) {
    return cacheInstance;
  }

  // If initialization is in progress, wait for it
  if (cacheInitPromise) {
    return cacheInitPromise;
  }

  // Start initialization
  cacheInitPromise = (async () => {
    if (STORAGE_TYPE === "azure-blob") {
      try {
        cacheInstance = new AzureBlobCache();
        await cacheInstance.init();
      } catch (err) {
        console.warn(`Azure Blob Storage not configured, falling back to filesystem: ${err.message}`);
        cacheInstance = new FileSystemCache();
        await cacheInstance.init();
      }
    } else {
      cacheInstance = new FileSystemCache();
      await cacheInstance.init();
    }
    cacheInitPromise = null; // Clear promise once done
    return cacheInstance;
  })();

  return cacheInitPromise;
}
