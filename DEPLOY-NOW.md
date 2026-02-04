# Deploy to Azure — Quick Steps (You Already Have Storage)

You already have the resource group, storage account, and container. Follow these steps to deploy the app.

**Run all commands from your project directory:**  
`c:\Users\emilychristy\repos\weather-images`

---

## 1. Set variables and log in

```bash
RESOURCE_GROUP="weather-images-test-rg"
LOCATION="eastus"
STORAGE_ACCOUNT_NAME="weatherimages1770114490"
ENV_NAME="weather-images-env"
APP_NAME="weather-images-api"
ACR_NAME="weatherimages$(date +%s)"

az login
az account set --subscription "YOUR_SUBSCRIPTION_ID_OR_NAME"
```

---

## 2. Create Azure Container Registry (ACR)

```bash
az acr create \
  --resource-group $RESOURCE_GROUP \
  --name $ACR_NAME \
  --sku Basic \
  --admin-enabled true

ACR_LOGIN_SERVER=$(az acr show --name $ACR_NAME --query loginServer --output tsv)
echo "ACR: $ACR_LOGIN_SERVER"
```

---

## 3. Build and push the Docker image

From your project folder (where `Dockerfile` lives):

```bash
az acr login --name $ACR_NAME

az acr build \
  --registry $ACR_NAME \
  --image weather-images-api:latest .
```

---

## 4. Create Container Apps environment (if it doesn’t exist)

```bash
az containerapp env create \
  --name $ENV_NAME \
  --resource-group $RESOURCE_GROUP \
  --location $LOCATION
```

If you get "already exists", that’s fine — continue.

---

## 5. Create the Container App with managed identity

```bash
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
```

---

## 6. Assign Storage Blob Data Contributor to the app’s managed identity

```bash
IDENTITY_PRINCIPAL_ID=$(az containerapp identity show \
  --name $APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --query principalId -o tsv)

STORAGE_ID=$(az storage account show \
  --name $STORAGE_ACCOUNT_NAME \
  --resource-group $RESOURCE_GROUP \
  --query id -o tsv)

az role assignment create \
  --role "Storage Blob Data Contributor" \
  --assignee $IDENTITY_PRINCIPAL_ID \
  --scope $STORAGE_ID
```

---

## 7. Configure app settings (Blob + managed identity)

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

---

## 8. Get the app URL and test

```bash
APP_URL=$(az containerapp show \
  --name $APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --query properties.configuration.ingress.fqdn \
  --output tsv)

echo "App URL: https://$APP_URL"
```

Then in a browser or with curl:

- Health: `https://<APP_URL>/health`
- Image: `https://<APP_URL>/api/weather-year-image?city=London&year=2024&format=png`

---

## If the app already exists

If the Container App was created earlier and you only need to update image or env:

```bash
# Rebuild and push
az acr build --registry $ACR_NAME --image weather-images-api:latest .

# Update app to new image
az containerapp update \
  --name $APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --image $ACR_LOGIN_SERVER/weather-images-api:latest
```

Use the same variables as above (`ACR_NAME`, `ACR_LOGIN_SERVER`, etc.).
