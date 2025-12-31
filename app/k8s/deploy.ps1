# Kubernetes Deployment Script for Windows PowerShell
# This script helps deploy the application to Kubernetes

param(
    [switch]$Build,
    [switch]$Push,
    [string]$ImageTag = "latest",
    [string]$Registry = "",
    [switch]$SkipSecret
)

$ErrorActionPreference = "Stop"

Write-Host "🚀 Free File Kubernetes Deployment Script" -ForegroundColor Cyan
Write-Host ""

# Build Docker image
if ($Build) {
    Write-Host "📦 Building Docker image..." -ForegroundColor Yellow
    docker build -t free-file-app:$ImageTag .
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Docker build failed!" -ForegroundColor Red
        exit 1
    }
    Write-Host "✅ Docker image built successfully" -ForegroundColor Green
}

# Push to registry
if ($Push -and $Registry) {
    Write-Host "📤 Pushing image to registry..." -ForegroundColor Yellow
    $FullImageName = "$Registry/free-file-app:$ImageTag"
    docker tag free-file-app:$ImageTag $FullImageName
    docker push $FullImageName
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Docker push failed!" -ForegroundColor Red
        exit 1
    }
    Write-Host "✅ Image pushed successfully" -ForegroundColor Green
}

# Create namespace
Write-Host "📝 Creating namespace..." -ForegroundColor Yellow
kubectl apply -f namespace.yaml
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Failed to create namespace!" -ForegroundColor Red
    exit 1
}

# Deploy Redis
Write-Host "🔴 Deploying Redis..." -ForegroundColor Yellow
kubectl apply -f redis/pvc.yaml
kubectl apply -f redis/deployment.yaml
kubectl apply -f redis/service.yaml

# Wait for Redis to be ready
Write-Host "⏳ Waiting for Redis to be ready..." -ForegroundColor Yellow
kubectl wait --for=condition=ready pod -l app=redis -n free-file --timeout=120s

# Create ConfigMap
Write-Host "📋 Creating ConfigMap..." -ForegroundColor Yellow
kubectl apply -f app/configmap.yaml

# Create Secret
if (-not $SkipSecret) {
    if (Test-Path "../.env") {
        Write-Host "🔐 Creating Secret from .env file..." -ForegroundColor Yellow
        kubectl create secret generic app-secrets --from-env-file=../.env -n free-file --dry-run=client -o yaml | kubectl apply -f -
    } else {
        Write-Host "⚠️  .env file not found. Skipping secret creation." -ForegroundColor Yellow
        Write-Host "   Create secret manually: kubectl create secret generic app-secrets --from-env-file=.env -n free-file" -ForegroundColor Yellow
    }
}

# Update deployment with image
if ($Registry) {
    Write-Host "🔄 Updating deployment image..." -ForegroundColor Yellow
    $FullImageName = "$Registry/free-file-app:$ImageTag"
    kubectl set image deployment/free-file-app app=$FullImageName -n free-file --dry-run=client -o yaml | kubectl apply -f -
}

# Deploy Application
Write-Host "🚀 Deploying Application..." -ForegroundColor Yellow
kubectl apply -f app/deployment.yaml
kubectl apply -f app/service.yaml

# Deploy Ingress (optional)
$DeployIngress = Read-Host "Deploy Ingress? (y/n)"
if ($DeployIngress -eq "y" -or $DeployIngress -eq "Y") {
    Write-Host "🌐 Deploying Ingress..." -ForegroundColor Yellow
    kubectl apply -f ingress.yaml
}

Write-Host ""
Write-Host "✅ Deployment completed!" -ForegroundColor Green
Write-Host ""
Write-Host "📊 Check status with:" -ForegroundColor Cyan
Write-Host "   kubectl get all -n free-file" -ForegroundColor White
Write-Host ""
Write-Host "📝 View logs with:" -ForegroundColor Cyan
Write-Host "   kubectl logs -f deployment/free-file-app -n free-file" -ForegroundColor White
Write-Host ""
Write-Host "🔌 Port forward with:" -ForegroundColor Cyan
Write-Host "   kubectl port-forward service/free-file-app 3000:80 -n free-file" -ForegroundColor White
