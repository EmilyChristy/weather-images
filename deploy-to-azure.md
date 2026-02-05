# Complete Guide: Deploy to Azure Container Apps with Managed Identity

This guide walks you through deploying the Weather Images API to Azure Container Apps using managed identity for Blob Storage authentication.

## Prerequisites

- Azure CLI installed (`az`)
- Docker installed (for local testing)
- Azure account with Container Apps enabled
- Logged into Azure: `az login`

## Step 1: Set Variables

```bash
# Set these variables
RESOURCE_GROUP="weather-images-test-rg"
LOCATION="eastus"
STORAGE_ACCOUNT_NAME="weatherimages1770114490"
ENV_NAME="weather-images-env"
APP_NAME="weather-images-api"
ACR_NAME="weatherimages$(date +%s)"  # Must be globally unique, lowercase, 3-24 chars
```

## Step 2: Create Resource Group

```bash
az group create --name $RESOURCE_GROUP --location $LOCATION
```

## Step 3: Create Azure Container Registry (ACR)

```bash
az acr create \
  --resource-group $RESOURCE_GROUP \
  --name $ACR_NAME \
  --sku Basic \
  --admin-enabled true

# Get ACR login server
ACR_LOGIN_SERVER=$(az acr show --name $ACR_NAME --query loginServer --output tsv)
echo "ACR Login Server: $ACR_LOGIN_SERVER"
```

## Step 4: Create Storage Account

```bash
# Create storage account
az storage account create \
  --name $STORAGE_ACCOUNT_NAME \
  --resource-group $RESOURCE_GROUP \
  --location $LOCATION \
  --sku Standard_LRS \
  --kind StorageV2 \
  --allow-shared-key-access false  # Disable key-based auth (use managed identity)

# Create container for cached images
az storage container create \
  --name weather-images-cache \
  --account-name $STORAGE_ACCOUNT_NAME \
  --public-access blob

echo "Storage Account: $STORAGE_ACCOUNT_NAME"
```

## Step 5: Build and Push Docker Image

```bash
# Login to ACR
az acr login --name $ACR_NAME

# Build and push image
az acr build \
  --registry $ACR_NAME \
  --image weather-images-api:latest .
```

## Step 6: Create Container Apps Environment

```bash
az containerapp env create \
  --name $ENV_NAME \
  --resource-group $RESOURCE_GROUP \
  --location $LOCATION
```

## Step 7: Create Container App with Managed Identity

```bash
# Create Container App with system-assigned managed identity enabled
az containerapp create \
  --name $APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --environment $ENV_NAME \
  --image $ACR_LOGIN_SERVER/weather-images-api:latest \
  --target-port 3000 \
  --ingress external \
  --min-replicas 1 \
  --max-replicas 3 \
  --cpu 1.0 \
  --memory 2.0Gi \
  --env-vars PORT=3000 \
  --registry-server $ACR_LOGIN_SERVER \
  --registry-identity system \
  --system-assigned

echo "Container App created with managed identity"
```

## Step 8: Get Managed Identity Principal ID

```bash
IDENTITY_PRINCIPAL_ID=$(az containerapp identity show \
  --name $APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --query principalId -o tsv)

echo "Managed Identity Principal ID: $IDENTITY_PRINCIPAL_ID"
```

## Step 9: Assign Storage Blob Data Contributor Role

```bash
# Get storage account resource ID
STORAGE_ID=$(az storage account show \
  --name $STORAGE_ACCOUNT_NAME \
  --resource-group $RESOURCE_GROUP \
  --query id -o tsv)

# Assign role to managed identity
az role assignment create \
  --role "Storage Blob Data Contributor" \
  --assignee $IDENTITY_PRINCIPAL_ID \
  --scope $STORAGE_ID

echo "Role assigned successfully"
```

## Step 10: Configure Environment Variables

```bash
az containerapp update \
  --name $APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --set-env-vars \
    PORT=3000 \
    STORAGE_TYPE=azure-blob \
    AZURE_STORAGE_USE_MANAGED_IDENTITY=true \
    AZURE_STORAGE_ACCOUNT_NAME=$STORAGE_ACCOUNT_NAME \
    AZURE_STORAGE_CONTAINER=weather-images-cache
```

## Step 11: Get Your App URL

```bash
APP_URL=$(az containerapp show \
  --name $APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --query properties.configuration.ingress.fqdn \
  --output tsv)

echo "Your app is available at: https://$APP_URL"
echo "Test: curl https://$APP_URL/health"
echo "Test image: curl \"https://$APP_URL/api/weather-year-image?city=London&year=2024&format=png\" -o test.png"
```

## Step 12: Test Your Deployment

```bash
# Health check
curl https://$APP_URL/health

# Generate an image (first request will cache to Azure Blob Storage)
curl "https://$APP_URL/api/weather-year-image?city=London&year=2024&format=png" -o london-2024.png

# Second request should be faster (served from cache)
curl "https://$APP_URL/api/weather-year-image?city=London&year=2024&format=png" -o london-2024-cached.png
```

## Verify Everything Works

### Check Container App Logs

```bash
az containerapp logs show \
  --name $APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --follow
```

### Verify Managed Identity

```bash
az containerapp identity show \
  --name $APP_NAME \
  --resource-group $RESOURCE_GROUP
```

### Verify Role Assignment

```bash
az role assignment list \
  --scope $STORAGE_ID \
  --query "[?principalId=='$IDENTITY_PRINCIPAL_ID']"
```

### Check Storage Container

```bash
az storage blob list \
  --container-name weather-images-cache \
  --account-name $STORAGE_ACCOUNT_NAME \
  --auth-mode login \
  --output table
```

## Troubleshooting

### Container App won't start

```bash
# Check logs
az containerapp logs show --name $APP_NAME --resource-group $RESOURCE_GROUP --follow

# Check status
az containerapp show --name $APP_NAME --resource-group $RESOURCE_GROUP --query properties.runningStatus
```

### "ManagedIdentityCredential authentication failed"

- Verify managed identity is enabled: `az containerapp identity show --name $APP_NAME --resource-group $RESOURCE_GROUP`
- Check role assignment: `az role assignment list --scope $STORAGE_ID`
- Wait a few minutes after creating the role assignment (propagation delay)

### "Container not found"

- Verify container exists: `az storage container list --account-name $STORAGE_ACCOUNT_NAME --auth-mode login`
- Check environment variable `AZURE_STORAGE_CONTAINER` matches the container name

## Quick Reference: All Variables

Save these for later use:

```bash
echo "RESOURCE_GROUP=$RESOURCE_GROUP" > azure-vars.txt
echo "ACR_NAME=$ACR_NAME" >> azure-vars.txt
echo "ACR_LOGIN_SERVER=$ACR_LOGIN_SERVER" >> azure-vars.txt
echo "APP_NAME=$APP_NAME" >> azure-vars.txt
echo "STORAGE_ACCOUNT_NAME=$STORAGE_ACCOUNT_NAME" >> azure-vars.txt
echo "ENV_NAME=$ENV_NAME" >> azure-vars.txt
echo "APP_URL=$APP_URL" >> azure-vars.txt
```

## Updating Your Deployment

When you make code changes:

```bash
# Rebuild and push
az acr build --registry $ACR_NAME --image weather-images-api:latest .

# Restart Container App (pulls new image)
az containerapp update \
  --name $APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --image $ACR_LOGIN_SERVER/weather-images-api:latest
```

## Cleanup (when done testing)

```bash
# Delete everything
az group delete --name $RESOURCE_GROUP --yes --no-wait
```
