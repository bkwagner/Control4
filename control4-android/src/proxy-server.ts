import * as http from 'http';
import * as https from 'https';
import httpProxy from 'http-proxy';

let server: http.Server | null = null;

export function startProxy(targetIp: string, targetPort: number = 443): Promise<void> {
  return new Promise((resolve, reject) => {
    if (server) {
      console.log('[Proxy] Server already running');
      resolve();
      return;
    }

    const proxy = httpProxy.createProxyServer({
      target: `https://${targetIp}:${targetPort}`,
      changeOrigin: true,
      // Disable SSL verification for the upstream HTTPS connection
      https: {
        rejectUnauthorized: false,
      } as any,
      // Preserve the path and query string
      followRedirects: true,
    });

    // Handle errors
    proxy.on('error', (err, req, res) => {
      console.error('[Proxy] Proxy error:', err);
      if (res instanceof http.ServerResponse) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: 'Proxy error',
            message: err instanceof Error ? err.message : String(err),
          })
        );
      }
    });

    // Create HTTP server that listens on localhost
    server = http.createServer((req, res) => {
      // Log requests
      console.log('[Proxy]', req.method, req.url);

      // Forward to proxy
      proxy.web(req, res);
    });

    server.on('upgrade', (req, socket, head) => {
      // Handle WebSocket upgrades
      console.log('[Proxy] WebSocket upgrade:', req.url);
      proxy.ws(req, socket, head);
    });

    server.listen(8080, '127.0.0.1', () => {
      console.log('[Proxy] HTTP proxy listening on http://127.0.0.1:8080');
      resolve();
    });

    server.on('error', (err) => {
      console.error('[Proxy] Server error:', err);
      reject(err);
    });
  });
}

export function stopProxy(): void {
  if (server) {
    server.close(() => {
      console.log('[Proxy] Server stopped');
    });
    server = null;
  }
}
