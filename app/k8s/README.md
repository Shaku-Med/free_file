# Kubernetes Manifests

This directory contains all Kubernetes manifests for deploying the Free File application.

## Directory Structure

```
k8s/
├── namespace.yaml          # Namespace definition
├── redis/                  # Redis deployment
│   ├── deployment.yaml
│   ├── service.yaml
│   └── pvc.yaml
├── app/                    # Application deployment
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── configmap.yaml
│   └── secret.yaml.template
├── ingress.yaml           # Ingress configuration
├── kustomization.yaml     # Kustomize configuration
├── deploy.ps1            # PowerShell deployment script
└── deploy.sh             # Bash deployment script
```

## Quick Start

### Using Deployment Scripts

**Windows (PowerShell):**
```powershell
cd k8s
.\deploy.ps1 -Build
```

**Linux/Mac (Bash):**
```bash
cd k8s
chmod +x deploy.sh
./deploy.sh --build
```

### Manual Deployment

1. **Create namespace:**
   ```bash
   kubectl apply -f namespace.yaml
   ```

2. **Deploy Redis:**
   ```bash
   kubectl apply -f redis/
   ```

3. **Create secrets:**
   ```bash
   kubectl create secret generic app-secrets --from-env-file=../.env -n free-file
   ```

4. **Deploy application:**
   ```bash
   kubectl apply -f app/
   ```

5. **Deploy ingress (optional):**
   ```bash
   kubectl apply -f ingress.yaml
   ```

### Using Kustomize

```bash
kubectl apply -k .
```

## Configuration

Before deploying, make sure to:

1. **Update `app/deployment.yaml`:**
   - Set the correct image name and tag
   - Adjust resource limits
   - Set replica count

2. **Update `ingress.yaml`:**
   - Set your domain name
   - Configure TLS if needed
   - Update ingress class name

3. **Create secrets:**
   ```bash
   kubectl create secret generic app-secrets \
     --from-env-file=.env \
     -n free-file
   ```

4. **Update `redis/pvc.yaml`:**
   - Set the correct storage class for your cluster

## Environment Variables

The application expects environment variables to be provided via:
- **ConfigMap** (`app/configmap.yaml`) - for non-sensitive configuration
- **Secret** (`app-secrets`) - for sensitive data like API keys, passwords, etc.

Create the secret from your `.env` file:
```bash
kubectl create secret generic app-secrets --from-env-file=.env -n free-file
```

## Scaling

Scale the application:
```bash
kubectl scale deployment/free-file-app --replicas=3 -n free-file
```

## Monitoring

Check status:
```bash
kubectl get all -n free-file
```

View logs:
```bash
kubectl logs -f deployment/free-file-app -n free-file
```

## Cleanup

Remove all resources:
```bash
kubectl delete namespace free-file
```

## Additional Resources

See [KUBERNETES_SETUP.md](../KUBERNETES_SETUP.md) for detailed setup instructions.
