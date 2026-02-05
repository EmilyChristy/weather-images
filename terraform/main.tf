terraform {
  required_version = ">= 1.0"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}

provider "azurerm" {
  features {}
  storage_use_azuread = true  # Use Azure AD auth instead of storage account keys
}

# Resource Group
resource "azurerm_resource_group" "main" {
  name     = var.resource_group_name
  location = var.location
}

# Storage Account
resource "azurerm_storage_account" "main" {
  name                     = var.storage_account_name
  resource_group_name      = azurerm_resource_group.main.name
  location                 = azurerm_resource_group.main.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  account_kind             = "StorageV2"
  allow_nested_items_to_be_public = false
  shared_access_key_enabled = false  # Disable key-based auth (use Azure AD/managed identity)
}

# Storage Container (uses Azure AD auth via provider setting)
resource "azurerm_storage_container" "cache" {
  name                  = "weather-images-cache"
  storage_account_name  = azurerm_storage_account.main.name
  container_access_type = "private"
  
  # No storage_account_key needed - uses Azure AD from provider
}

# Azure Container Registry
resource "azurerm_container_registry" "main" {
  name                = "${var.acr_name}${random_integer.suffix.result}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  sku                 = "Basic"
  admin_enabled       = true
}

# Random suffix for ACR name (to ensure uniqueness)
resource "random_integer" "suffix" {
  min = 1000
  max = 9999
}

# Container Apps Environment
resource "azurerm_container_app_environment" "main" {
  name                       = var.container_app_env_name
  location                   = azurerm_resource_group.main.location
  resource_group_name        = azurerm_resource_group.main.name
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id
}

# Log Analytics Workspace (required for Container Apps Environment)
resource "azurerm_log_analytics_workspace" "main" {
  name                = "${var.container_app_env_name}-logs"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  sku                 = "PerGB2018"
  retention_in_days   = 30
}

# Container App
resource "azurerm_container_app" "main" {
  name                         = var.container_app_name
  container_app_environment_id = azurerm_container_app_environment.main.id
  resource_group_name           = azurerm_resource_group.main.name
  revision_mode                = "Single"

  identity {
    type = "SystemAssigned"
  }

  registry {
    server   = azurerm_container_registry.main.login_server
    username = azurerm_container_registry.main.admin_username
    password_secret_name = "registry-password"
  }

  secret {
    name  = "registry-password"
    value = azurerm_container_registry.main.admin_password
  }

  ingress {
    external_enabled = true
    target_port      = 3000
    transport        = "http"
    
    traffic_weight {
      percentage      = 100
      latest_revision = true
    }
  }

  template {
    min_replicas = 1
    max_replicas = 3

    container {
      name   = var.container_app_name
      image  = "${azurerm_container_registry.main.login_server}/${var.image_name}:latest"
      cpu    = 1.0
      memory = "2.0Gi"

      env {
        name  = "PORT"
        value = "3000"
      }
      env {
        name  = "STORAGE_TYPE"
        value = "azure-blob"
      }
      env {
        name  = "AZURE_STORAGE_USE_MANAGED_IDENTITY"
        value = "true"
      }
      env {
        name  = "AZURE_STORAGE_ACCOUNT_NAME"
        value = azurerm_storage_account.main.name
      }
      env {
        name  = "AZURE_STORAGE_CONTAINER"
        value = azurerm_storage_container.cache.name
      }
    }
  }
}

# Role Assignment: Give Container App's managed identity access to Storage Account
# This assigns the "Storage Blob Data Contributor" role to the Container App's managed identity
# so it can read/write blobs in the storage account
resource "azurerm_role_assignment" "storage_blob_contributor" {
  scope                = azurerm_storage_account.main.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_container_app.main.identity[0].principal_id
  
  # Ensure Container App and its managed identity are fully created first
  depends_on = [
    azurerm_container_app.main
  ]
}

# Role Assignment: Give Container App's managed identity access to pull from ACR
resource "azurerm_role_assignment" "acr_pull" {
  scope                = azurerm_container_registry.main.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_container_app.main.identity[0].principal_id
  
  # Ensure Container App and its managed identity are fully created first
  depends_on = [
    azurerm_container_app.main
  ]
}

# Outputs
output "app_url" {
  description = "URL of the deployed Container App"
  value       = "https://${azurerm_container_app.main.latest_revision_fqdn}"
}

output "storage_account_name" {
  description = "Storage account name"
  value       = azurerm_storage_account.main.name
}

output "acr_login_server" {
  description = "ACR login server (use this to build and push images)"
  value       = azurerm_container_registry.main.login_server
}

output "acr_name" {
  description = "ACR name"
  value       = azurerm_container_registry.main.name
}

output "resource_group_name" {
  description = "Resource group name"
  value       = azurerm_resource_group.main.name
}

output "container_app_name" {
  description = "Container App name"
  value       = azurerm_container_app.main.name
}
