# Setting Up Managed Identity for Azure Blob Storage

Managed Identity is the recommended authentication method for Azure deployments - no secrets to manage!

## How It Works

- **In Azure**: Uses the system-assigned managed identity automatically (no configuration needed)
- **Local Development**: Falls back to Azure CLI (`az login`) for authentication

## Step 1: Enable Managed Identity on Your Container App

When deploying to Azure Container Apps, enable system-assigned managed identity:

```bash
APP_NAME="weather-images-api"
RESOURCE_GROUP="weather-images-test-rg"

# Enable system-assigned managed identity
az containerapp identity assign \
  --name $APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --system-assigned
```

This will output the identity principal ID - save this for the next step.

## Step 2: Assign Storage Blob Data Contributor Role

Grant the managed identity access to your storage account:

```bash
STORAGE_ACCOUNT_NAME="weatherimages1770114490"
RESOURCE_GROUP="weather-images-test-rg"
APP_NAME="weather-images-api"

# Get the managed identity principal ID
IDENTITY_PRINCIPAL_ID=$(az containerapp identity show \
  --name $APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --query principalId -o tsv)

# Get storage account resource ID
STORAGE_ID=$(az storage account show \
  --name $STORAGE_ACCOUNT_NAME \
  --resource-group $RESOURCE_GROUP \
  --query id -o tsv)

# Assign Storage Blob Data Contributor role
az role assignment create \
  --role "Storage Blob Data Contributor" \
  --assignee $IDENTITY_PRINCIPAL_ID \
  --scope $STORAGE_ID
```

## Step 3: Configure Environment Variables

In your Container App, set these environment variables:

```bash
az containerapp update \
  --name $APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --set-env-vars \
    STORAGE_TYPE=azure-blob \
    AZURE_STORAGE_USE_MANAGED_IDENTITY=true \
    AZURE_STORAGE_ACCOUNT_NAME=$STORAGE_ACCOUNT_NAME \
    AZURE_STORAGE_CONTAINER=weather-images-cache
```

**No secrets needed!** The managed identity handles authentication automatically.

## Local Development

For local testing, the app will use Azure CLI authentication:

```bash
# 1. Login to Azure CLI
az login

# 2. Set your .env file
STORAGE_TYPE=azure-blob
AZURE_STORAGE_USE_MANAGED_IDENTITY=true
AZURE_STORAGE_ACCOUNT_NAME=weatherimages1770114490
AZURE_STORAGE_CONTAINER=weather-images-cache

# 3. Make sure you have Storage Blob Data Contributor role on the storage account
# (You can assign this to your user account for local dev)
STORAGE_ID=$(az storage account show --name $STORAGE_ACCOUNT_NAME --resource-group $RESOURCE_GROUP --query id -o tsv)
az role assignment create \
  --role "Storage Blob Data Contributor" \
  --assignee $(az ad signed-in-user show --query id -o tsv) \
  --scope $STORAGE_ID

# 4. Run locally
npm start
```

## Benefits of Managed Identity

✅ **No secrets to manage** - Azure handles authentication automatically  
✅ **More secure** - No credentials stored in environment variables  
✅ **Automatic rotation** - Azure manages credential lifecycle  
✅ **Works seamlessly** - Same code works in Azure and locally (with `az login`)  

## Troubleshooting

### "ManagedIdentityCredential authentication failed"

**In Azure:**
- Verify managed identity is enabled: `az containerapp identity show --name $APP_NAME --resource-group $RESOURCE_GROUP`
- Check role assignment: `az role assignment list --scope $STORAGE_ID`

**Local:**
- Make sure you're logged in: `az login`
- Verify you have the role: `az role assignment list --scope $STORAGE_ID --assignee $(az ad signed-in-user show --query id -o tsv)`

### "DefaultAzureCredential failed to retrieve a token"

- Check Azure CLI is installed and logged in: `az account show`
- For local dev, ensure you have Storage Blob Data Contributor role on the storage account

## Complete Deployment Example

```bash
# Variables
RESOURCE_GROUP="weather-images-test-rg"
LOCATION="eastus"
ACR_NAME="weatherimages$(date +%s)"
APP_NAME="weather-images-api"
STORAGE_ACCOUNT_NAME="weatherimages1770114490"
ENV_NAME="weather-images-env"

# Create Container App with managed identity
az containerapp create \
  --name $APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --environment $ENV_NAME \
  --image $ACR_NAME.azurecr.io/weather-images-api:latest \
  --target-port 3000 \
  --ingress external \
  --system-assigned

# Get identity principal ID
IDENTITY_ID=$(az containerapp identity show --name $APP_NAME --resource-group $RESOURCE_GROUP --query principalId -o tsv)

# Assign role
STORAGE_ID=$(az storage account show --name $STORAGE_ACCOUNT_NAME --resource-group $RESOURCE_GROUP --query id -o tsv)
az role assignment create \
  --role "Storage Blob Data Contributor" \
  --assignee $IDENTITY_ID \
  --scope $STORAGE_ID

# Set environment variables
az containerapp update \
  --name $APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --set-env-vars \
    STORAGE_TYPE=azure-blob \
    AZURE_STORAGE_USE_MANAGED_IDENTITY=true \
    AZURE_STORAGE_ACCOUNT_NAME=$STORAGE_ACCOUNT_NAME \
    AZURE_STORAGE_CONTAINER=weather-images-cache
```
