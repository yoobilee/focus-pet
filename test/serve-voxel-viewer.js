// Zero-dependency static file server (Node's built-in http/fs only, no npm
// packages) so test/voxel-viewer.html can be opened over http:// instead
// of file:// - opening it directly as a file fails because Chromium
// blocks a module's relative import of a sibling file (voxel-viewer.js
// importing ../windows/shared/voxel-engine.js, which itself imports
// 'three') when the page itself was loaded via file://; this is a browser
// restriction on the file: protocol, not something fixable in the page's
// own code. Serves the whole project root (so relative imports up to
// ../windows/... and ../node_modules/three/... resolve normally) rather
// than just test/, and only ever reads files - nothing is written,
// executed, or proxied.
// Usage: node test/serve-voxel-viewer.js [port]
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.argv[2]) || 8420;
const ROOT = path.join(__dirname, '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.css': 'text/css',
  '.png': 'image/png',
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const filePath = path.normalize(path.join(ROOT, urlPath));
  // Refuse anything that escapes ROOT (e.g. via ../../) - this server has
  // no need to serve outside the project directory.
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found: ' + urlPath);
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Voxel viewer running at: http://localhost:${PORT}/test/voxel-viewer.html`);
  console.log('Open that URL in your browser. Ctrl+C here to stop the server.');
});
