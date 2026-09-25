const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../portal');
http
  .createServer((req, res) => {
    const route = new URL(req.url, 'http://localhost').pathname;
    if (route === '/auth-config') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(
        JSON.stringify({
          authorizationUrl: 'https://identity.example.com/authorize',
          clientId: 'preview',
        }),
      );
    }
    if (route === '/socket.io/socket.io.js') {
      res.setHeader('Content-Type', 'application/javascript');
      return res.end('');
    }
    const target = path.resolve(root, '.' + (route === '/' ? '/index.html' : route));
    if (!target.startsWith(root + path.sep)) {
      res.writeHead(403);
      return res.end();
    }
    fs.readFile(target, (error, data) => {
      if (error) {
        res.writeHead(404);
        return res.end();
      }
      res.setHeader(
        'Content-Type',
        {
          '.html': 'text/html; charset=utf-8',
          '.css': 'text/css',
          '.js': 'application/javascript',
        }[path.extname(target)] ?? 'application/octet-stream',
      );
      res.end(data);
    });
  })
  .listen(4173, '127.0.0.1', () => console.log('Portal preview: http://localhost:4173'));
