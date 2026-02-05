# This file can be used to override defaults from main.tf
# Or you can use terraform.tfvars file

variable "resource_group_name" {
  description = "Name of the resource group"
  type        = string
  default     = "weather-images-test-rg"
}

variable "location" {
  description = "Azure region"
  type        = string
  default     = "eastus"
}

variable "storage_account_name" {
  description = "Name of the storage account (must be globally unique)"
  type        = string
  default     = "weatherimages1770114490"
}

variable "acr_name" {
  description = "Name prefix for Azure Container Registry (will add random suffix for uniqueness)"
  type        = string
  default     = "weatherimages"
}

variable "container_app_env_name" {
  description = "Name of Container Apps Environment"
  type        = string
  default     = "weather-images-env"
}

variable "container_app_name" {
  description = "Name of Container App"
  type        = string
  default     = "weather-images-api"
}

variable "image_name" {
  description = "Docker image name (tag will be :latest)"
  type        = string
  default     = "weather-images-api"
}
