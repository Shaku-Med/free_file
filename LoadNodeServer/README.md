# Load Node Server

Node.js server for handling image and video loading with authentication and access control.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Set the required environment variables:
   - `SERVER_TO_SERVER_KEY` - The encryption key for server-to-server communication (must match the main app)
   - `MAIN_APP_URL` - The URL of the main application (default: http://localhost:3000)

   Example:
   ```bash
   export SERVER_TO_SERVER_KEY=your_server_to_server_key
   export MAIN_APP_URL=http://localhost:3000
   ```

   Or set them when starting:
   ```bash
   SERVER_TO_SERVER_KEY=your_key MAIN_APP_URL=http://localhost:3000 npm start
   ```

3. Build the project:
```bash
npm run build
```

4. Start the server:
```bash
npm start
```

For development:
```bash
npm run dev
```

The server will automatically fetch all other environment variables from the main app using encrypted server-to-server communication on startup.

## Endpoints

- `GET /api/load/image/*` - Image loading endpoint
- `GET /api/load/video/*` - Video loading endpoint
