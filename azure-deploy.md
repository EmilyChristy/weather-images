# Deploying to Azure Container Apps

This guide covers deploying the Weather Images API to Azure Container Apps.

## Prerequisites

- Azure CLI installed (`az`)
- Docker installed (for local testing)
- Azure account with Container Apps enabled

## Option 1: Azure Container Apps (Recommended)

### 1. Build and push to Azure Container Registry (ACR)

```bash
# Login to Azure
az login

# Set variables
RESOURCE_GROUP="weather-images-test-rg"
LOCATION="eastus"
STORAGE_ACCOUNT_NAME="weatherimages1770114490"
ENV_NAME="weather-images-env"
APP_NAME="weather-images-api"
ACR_NAME="weatherimages$(date +%s)"  # Must be globally unique
IMAGE_NAME="weather-images-api:latest"

# Create resource group
az group create --name $RESOURCE_GROUP --location $LOCATION

# Create Azure Container Registry
az acr create --resource-group $RESOURCE_GROUP --name $ACR_NAME --sku Basic --admin-enabled true

# Login to ACR
az acr login --name $ACR_NAME

# Build and push image
az acr build --registry $ACR_NAME --image $IMAGE_NAME .

# Get ACR login server
ACR_LOGIN_SERVER=$(az acr show --name $ACR_NAME --query loginServer --output tsv)
```

### 2. Create Container App Environment

```bash
# Create Container Apps environment
az containerapp env create \
  --name weather-images-env \
  --resource-group $RESOURCE_GROUP \
  --location $LOCATION
```

### 3. Deploy Container App

```bash
# Deploy the app
az containerapp create \
  --name $APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --environment $ENV_NAME \
  --image $ACR_LOGIN_SERVER/$IMAGE_NAME \
  --target-port 3000 \
  --ingress external \
  --min-replicas 1 \
  --max-replicas 3 \
  --cpu 1.0 \
  --memory 2.0Gi \
  --env-vars PORT=3000 \
  --registry-server $ACR_LOGIN_SERVER \
  --registry-identity system
```

### 4. Get the URL

```bash
az containerapp show \
  --name $APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --query properties.configuration.ingress.fqdn \
  --output tsv
```

## Option 2: Azure App Service (Container)

### 1. Build and push to ACR (same as above)

### 2. Create App Service Plan

```bash
az appservice plan create \
  --name weather-images-plan \
  --resource-group $RESOURCE_GROUP \
  --is-linux \
  --sku B1
```

### 3. Create Web App

```bash
az webapp create \
  --resource-group $RESOURCE_GROUP \
  --plan weather-images-plan \
  --name $APP_NAME \
  --deployment-container-image-name $ACR_LOGIN_SERVER/$IMAGE_NAME
```

### 4. Configure App Settings

```bash
az webapp config appsettings set \
  --resource-group $RESOURCE_GROUP \
  --name $APP_NAME \
  --settings PORT=3000

# Enable managed identity and configure ACR access
az webapp config container set \
  --resource-group $RESOURCE_GROUP \
  --name $APP_NAME \
  --docker-custom-image-name $ACR_LOGIN_SERVER/$IMAGE_NAME \
  --docker-registry-server-url https://$ACR_LOGIN_SERVER
```

## Option 3: Azure Container Instances (Simple, no scaling)

```bash
az container create \
  --resource-group $RESOURCE_GROUP \
  --name $APP_NAME \
  --image $ACR_LOGIN_SERVER/$IMAGE_NAME \
  --registry-login-server $ACR_LOGIN_SERVER \
  --registry-username $(az acr credential show --name $ACR_NAME --query username -o tsv) \
  --registry-password $(az acr credential show --name $ACR_NAME --query passwords[0].value -o tsv) \
  --dns-name-label weather-images-$(date +%s) \
  --ports 3000 \
  --environment-variables PORT=3000 \
  --cpu 1 \
  --memory 2
```

## Testing Locally with Docker

```bash
# Build image
docker build -t weather-images-api .

# Run container
docker run -p 3000:3000 -e PORT=3000 weather-images-api

# Test
curl http://localhost:3000/health
curl "http://localhost:3000/api/weather-year-image?city=London&year=2024&format=svg"
```

## Environment Variables

The app reads `PORT` from environment (defaults to 3000). No API keys needed for Open-Meteo.

### Image Caching

The app caches generated images to avoid regenerating the same historical data. Configure via:

**File System Cache (default, good for single-instance):**
```bash
STORAGE_TYPE=filesystem
CACHE_DIR=/app/cache
```

**Azure Blob Storage (recommended for multi-instance/scalable):**
```bash
STORAGE_TYPE=azure-blob
AZURE_STORAGE_CONNECTION_STRING="DefaultEndpointsProtocol=https;AccountName=..."
AZURE_STORAGE_CONTAINER=weather-images-cache
```

To set up Azure Blob Storage:
```bash
# Create storage account
az storage account create \
  --name weatherimages$(date +%s) \
  --resource-group $RESOURCE_GROUP \
  --location $LOCATION \
  --sku Standard_LRS

# Get connection string
az storage account show-connection-string \
  --name <storage-account-name> \
  --resource-group $RESOURCE_GROUP \
  --query connectionString -o tsv

# Create container
az storage container create \
  --name weather-images-cache \
  --account-name <storage-account-name> \
  --public-access blob
```

Then add these as environment variables in your Container App:
```bash
az containerapp update \
  --name $APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --set-env-vars \
    STORAGE_TYPE=azure-blob \
    AZURE_STORAGE_CONNECTION_STRING="<connection-string>" \
    AZURE_STORAGE_CONTAINER=weather-images-cache
```

## Updating the Deployment

```bash
# Rebuild and push
az acr build --registry $ACR_NAME --image $IMAGE_NAME .

# Restart Container App
az containerapp update \
  --name $APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --image $ACR_LOGIN_SERVER/$IMAGE_NAME
```

## Cost Considerations

- **Container Apps**: Pay per use, good for variable traffic
- **App Service**: Fixed cost per plan tier
- **Container Instances**: Pay per second, good for dev/test

## Troubleshooting

```bash
# View logs
az containerapp logs show --name $APP_NAME --resource-group $RESOURCE_GROUP --follow

# Check status
az containerapp show --name $APP_NAME --resource-group $RESOURCE_GROUP --query properties.runningStatus
```
