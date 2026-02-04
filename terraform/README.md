# Terraform Deployment for Weather Images API

This Terraform configuration deploys the entire Weather Images API infrastructure to Azure.

## Prerequisites

1. **Terraform installed** (>= 1.0)
   ```bash
   # Windows (Chocolatey)
   choco install terraform
   
   # Or download from https://www.terraform.io/downloads
   ```

2. **Azure CLI installed and logged in**
   ```bash
   az login
   az account set --subscription "your-subscription-id"
   ```

3. **Docker image built and pushed** (after first deploy, see below)

## Quick Start

### 1. Initialize Terraform

```bash
cd terraform
terraform init
```

### 2. Review the plan

```bash
terraform plan
```

This shows what will be created without actually creating it.

### 3. Deploy everything

```bash
terraform apply
```

Type `yes` when prompted. This creates:
- Resource Group
- Storage Account + Container
- Azure Container Registry (ACR)
- Container Apps Environment
- Container App with managed identity
- Role assignment (managed identity → storage)

### 4. Build and push Docker image

After Terraform creates the ACR, build and push your image:

```bash
# Get ACR name from Terraform output
ACR_NAME=$(terraform output -raw acr_name)
ACR_SERVER=$(terraform output -raw acr_login_server)

# Login and build
az acr login --name $ACR_NAME
az acr build --registry $ACR_NAME --image weather-images-api:latest ..
```

**Note:** The `..` assumes you're in the `terraform/` directory - it goes up one level to find the Dockerfile.

### 5. Get your app URL

```bash
terraform output app_url
```

Visit that URL in your browser or test with curl:
```bash
curl https://$(terraform output -raw app_url)/health
```

## Customizing Variables

### Option 1: Edit `terraform.tfvars` (recommended)

```bash
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your values
```

### Option 2: Override on command line

```bash
terraform apply -var="storage_account_name=myuniquename123"
```

### Option 3: Use environment variables

```bash
export TF_VAR_storage_account_name="myuniquename123"
terraform apply
```

## Updating the Deployment

When you make code changes:

1. **Rebuild and push the image:**
   ```bash
   ACR_NAME=$(terraform output -raw acr_name)
   az acr build --registry $ACR_NAME --image weather-images-api:latest ..
   ```

2. **Restart the Container App** (Terraform will detect the new image):
   ```bash
   terraform apply
   ```

Or manually restart:
```bash
az containerapp revision restart \
  --name $(terraform output -raw container_app_name) \
  --resource-group $(terraform output -raw resource_group_name) \
  --revision $(az containerapp revision list --name $(terraform output -raw container_app_name) --resource-group $(terraform output -raw resource_group_name) --query "[0].name" -o tsv)
```

## Destroy Everything

**⚠️ Warning: This deletes ALL resources!**

```bash
terraform destroy
```

Type `yes` when prompted. This removes:
- Container App
- Container Apps Environment
- ACR
- Storage Account + Container
- Resource Group (and everything in it)

## Important Notes

### Storage Account Name

The `storage_account_name` must be **globally unique**. If `weatherimages1770114490` is already taken, change it in `terraform.tfvars` or use:

```bash
terraform apply -var="storage_account_name=weatherimages$(date +%s)"
```

### ACR Name

ACR names must be globally unique. The Terraform config adds a random suffix automatically, but if conflicts occur, change `acr_name` in `terraform.tfvars`.

### Image Build

Terraform creates the infrastructure but **doesn't build the Docker image**. You must build and push it manually after the first `terraform apply` (see step 4 above).

### Managed Identity

The Container App's managed identity is automatically assigned the "Storage Blob Data Contributor" role via `azurerm_role_assignment`. No manual steps needed!

## Troubleshooting

### "Storage account name already exists"

Change `storage_account_name` in `terraform.tfvars` to something unique.

### "ACR name already exists"

Change `acr_name` in `terraform.tfvars` or let Terraform generate a new random suffix.

### Container App can't access storage

- Check role assignment: `terraform show` should show `azurerm_role_assignment.storage_blob_contributor`
- Verify managed identity: In Azure Portal → Container App → Identity → should show "System assigned: On"

### Image not found

Make sure you've built and pushed the image to ACR:
```bash
ACR_NAME=$(terraform output -raw acr_name)
az acr build --registry $ACR_NAME --image weather-images-api:latest ..
```

## File Structure

```
terraform/
  main.tf              # Main infrastructure definition
  variables.tf         # Variable declarations
  terraform.tfvars     # Your actual values (gitignored)
  terraform.tfvars.example  # Example values
  README.md            # This file
```

## Outputs

After `terraform apply`, you can get outputs:

```bash
terraform output                    # All outputs
terraform output app_url            # Just the app URL
terraform output -raw app_url       # URL without quotes
terraform output -json              # All outputs as JSON
```
