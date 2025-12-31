#!/bin/bash
# Kubernetes Deployment Script for Linux/Mac
# This script helps deploy the application to Kubernetes

set -e

BUILD=false
PUSH=false
IMAGE_TAG="latest"
REGISTRY=""
SKIP_SECRET=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --build)
            BUILD=true
            shift
            ;;
        --push)
            PUSH=true
            shift
            ;;
        --tag)
            IMAGE_TAG="$2"
            shift 2
            ;;
        --registry)
            REGISTRY="$2"
            shift 2
            ;;
        --skip-secret)
            SKIP_SECRET=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

echo "🚀 Free File Kubernetes Deployment Script"
echo ""

# Build Docker image
if [ "$BUILD" = true ]; then
    echo "📦 Building Docker image..."
    docker build -t free-file-app:$IMAGE_TAG .
    echo "✅ Docker image built successfully"
fi

# Push to registry
if [ "$PUSH" = true ] && [ -n "$REGISTRY" ]; then
    echo "📤 Pushing image to registry..."
    FULL_IMAGE_NAME="$REGISTRY/free-file-app:$IMAGE_TAG"
    docker tag free-file-app:$IMAGE_TAG $FULL_IMAGE_NAME
    docker push $FULL_IMAGE_NAME
    echo "✅ Image pushed successfully"
fi

# Create namespace
echo "📝 Creating namespace..."
kubectl apply -f namespace.yaml

# Deploy Redis
echo "🔴 Deploying Redis..."
kubectl apply -f redis/pvc.yaml
kubectl apply -f redis/deployment.yaml
kubectl apply -f redis/service.yaml

# Wait for Redis to be ready
echo "⏳ Waiting for Redis to be ready..."
kubectl wait --for=condition=ready pod -l app=redis -n free-file --timeout=120s || true

# Create ConfigMap
echo "📋 Creating ConfigMap..."
kubectl apply -f app/configmap.yaml

# Create Secret
if [ "$SKIP_SECRET" = false ]; then
    if [ -f "../.env" ]; then
        echo "🔐 Creating Secret from .env file..."
        kubectl create secret generic app-secrets --from-env-file=../.env -n free-file --dry-run=client -o yaml | kubectl apply -f -
    else
        echo "⚠️  .env file not found. Skipping secret creation."
        echo "   Create secret manually: kubectl create secret generic app-secrets --from-env-file=.env -n free-file"
    fi
fi

# Update deployment with image
if [ -n "$REGISTRY" ]; then
    echo "🔄 Updating deployment image..."
    FULL_IMAGE_NAME="$REGISTRY/free-file-app:$IMAGE_TAG"
    kubectl set image deployment/free-file-app app=$FULL_IMAGE_NAME -n free-file --dry-run=client -o yaml | kubectl apply -f -
fi

# Deploy Application
echo "🚀 Deploying Application..."
kubectl apply -f app/deployment.yaml
kubectl apply -f app/service.yaml

# Deploy Ingress (optional)
read -p "Deploy Ingress? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🌐 Deploying Ingress..."
    kubectl apply -f ingress.yaml
fi

echo ""
echo "✅ Deployment completed!"
echo ""
echo "📊 Check status with:"
echo "   kubectl get all -n free-file"
echo ""
echo "📝 View logs with:"
echo "   kubectl logs -f deployment/free-file-app -n free-file"
echo ""
echo "🔌 Port forward with:"
echo "   kubectl port-forward service/free-file-app 3000:80 -n free-file"
