// keepalive.js — rode isso em outro serviço gratuito (ex: cron-job.org)
// OU adicione no próprio bot para ele se pingar

const https = require('https');
const http = require('http');

const URL = process.env.RENDER_URL || 'https://SEU-APP.onrender.com/ping';

function ping() {
  const lib = URL.startsWith('https') ? https : http;
  lib.get(URL, (res) => {
    console.log(`[KeepAlive] Ping OK — Status: ${res.statusCode} — ${new Date().toLocaleTimeString('pt-BR')}`);
  }).on('error', (err) => {
    console.error(`[KeepAlive] Erro no ping: ${err.message}`);
  });
}

// Pinga a cada 14 minutos (Render dorme após 15 min sem atividade)
setInterval(ping, 14 * 60 * 1000);
ping(); // pinga imediatamente ao iniciar

module.exports = { ping };