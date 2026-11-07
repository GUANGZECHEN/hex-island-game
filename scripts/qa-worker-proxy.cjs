const http = require('node:http');
const httpProxy = require('http-proxy');

const target = process.env.WORKER_ORIGIN;
if (!target || !/^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.workers\.dev$/.test(target)) {
  throw new Error('Invalid WORKER_ORIGIN.');
}

const proxy = httpProxy.createProxyServer({
  target,
  changeOrigin: true,
  ws: true,
  secure: true,
  xfwd: false,
});

proxy.on('error', (_error, _req, resOrSocket) => {
  if ('writeHead' in resOrSocket) {
    try {
      resOrSocket.writeHead(502, {'Content-Type':'text/plain','Cache-Control':'no-store'});
      resOrSocket.end('upstream unavailable');
    } catch {}
  } else {
    try { resOrSocket.destroy(); } catch {}
  }
});

const server = http.createServer((req,res)=>proxy.web(req,res));
server.on('upgrade',(req,socket,head)=>proxy.ws(req,socket,head));
server.listen(8788,'127.0.0.1',()=>process.stdout.write('proxy-ready\n'));
