# Setting Up Azure Blob Storage for Local Testing

This guide helps you set up Azure Blob Storage caching for local development and testing.

## Prerequisites

- Azure CLI installed (`az`)
- Azure account (free tier works fine)
- Logged into Azure: `az login`

## Step 1: Create Azure Storage Account

```bash
# Set variables
RESOURCE_GROUP="weather-images-test-rg"
LOCATION="eastus"
STORAGE_ACCOUNT_NAME="weatherimages1770114490"

# Create resource group (if it doesn't exist)
az group create --name $RESOURCE_GROUP --location $LOCATION

# Create storage account (Standard_LRS is cheapest for testing)
az storage account create \
  --name $STORAGE_ACCOUNT_NAME \
  --resource-group $RESOURCE_GROUP \
  --location $LOCATION \
  --sku Standard_LRS \
  --kind StorageV2
```

## Step 2: Create Blob Container

```bash
# Create container for cached images
az storage container create \
  --name weather-images-cache \
  --account-name $STORAGE_ACCOUNT_NAME \
  --public-access blob  # Optional: makes blobs publicly accessible (good for testing)
```

## Step 3: Get Connection String

```bash
# Get the connection string
az storage account show-connection-string \
  --name $STORAGE_ACCOUNT_NAME \
  --resource-group $RESOURCE_GROUP \
  --query connectionString -o tsv
```

Copy the output - it will look like:
```
DefaultEndpointsProtocol=https;AccountName=weatherimages123456;AccountKey=...;EndpointSuffix=core.windows.net
```

## Step 4: Update .env File

Add these lines to your `.env` file:

```env
PORT=3000

# Azure Blob Storage caching
STORAGE_TYPE=azure-blob
AZURE_STORAGE_CONNECTION_STRING="DefaultEndpointsProtocol=https;AccountName=...;AccountKey=...;EndpointSuffix=core.windows.net"
AZURE_STORAGE_CONTAINER=weather-images-cache
```

**Important:** Replace the connection string with the one you got from Step 3, and wrap it in quotes.

## Step 5: Install Azure Storage SDK

The `@azure/storage-blob` package should already be in `package.json`, but make sure it's installed:

```bash
npm install
```

## Step 6: Test Locally

```bash
# Start the server
npm start

# Make a request (first time - will generate and cache to Azure)
curl "http://localhost:3000/api/weather-year-image?city=London&year=2024&format=png" -o test1.png

# Make the same request again (should be served from Azure Blob cache)
curl "http://localhost:3000/api/weather-year-image?city=London&year=2024&format=png" -o test2.png
```

## Step 7: Verify in Azure Portal

1. Go to [Azure Portal](https://portal.azure.com)
2. Navigate to your Storage Account
3. Click "Containers" → "weather-images-cache"
4. You should see cached PNG/SVG files (named with hash keys)

## Troubleshooting

### Error: "AZURE_STORAGE_CONNECTION_STRING environment variable is required"

- Make sure `.env` file has `STORAGE_TYPE=azure-blob`
- Check that `AZURE_STORAGE_CONNECTION_STRING` is set correctly
- Restart the server after updating `.env`

### Error: "Container not found"

- Make sure the container name matches: `weather-images-cache`
- Or check `AZURE_STORAGE_CONTAINER` in `.env` matches the container you created

### Fallback to filesystem

If Azure Blob Storage fails to initialize, the app will automatically fall back to filesystem cache (you'll see a warning in the console).

## Cleanup (when done testing)

```bash
# Delete the resource group (removes storage account and all resources)
az group delete --name $RESOURCE_GROUP --yes --no-wait
```

## Cost

- Standard_LRS storage: ~$0.018 per GB/month
- Blob operations: First 10,000 transactions/month are free
- For testing, expect < $1/month unless you cache thousands of images
