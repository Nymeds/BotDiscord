const { Client, GatewayIntentBits, Partials } = require('discord.js');
const express = require('express');

// Load .env when running with `node index.js` (Node 20+).
try {
  process.loadEnvFile();
} catch (_) {
  // Ignore when .env does not exist (e.g. hosted env vars).
}

const app = express();
app.use(express.json());

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message],
});

// ===================== ESTADO GLOBAL =====================
// auto-reply: Map<userId, { ativo: bool, resposta: string }>
const autoReplyConfig = new Map();

// loops ativos: Map<userId, { interval, texto, intervalo }>
const dmLoops = new Map();

// ===================== BOT READY =====================
client.once('clientReady', () => {
  console.log(`✅ Bot online como ${client.user.tag}`);
  client.user.setActivity('Encher o saco dos amigos 😈', { type: 'PLAYING' });
});

// ===================== HANDLER PRINCIPAL =====================
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const isDM = message.channel.type === 1; // 1 = DM channel

  // ── AUTO-REPLY: intercepta DMs de alvos configurados ─────────────────────
  if (isDM) {
    const config = autoReplyConfig.get(message.author.id);
    if (config && config.ativo) {
      await sleep(500 + Math.random() * 1000); // delay humano aleatório
      await message.reply(config.resposta);
      return;
    }
  }

  const prefix = '!';
  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  // ==========================================================================
  // COMANDOS DE DM
  // ==========================================================================

  // ── !dmloop @user <mensagem> <intervalo_segundos> ──────────────────────────
  if (command === 'dmloop') {
    const alvo = message.mentions.users.first();
    const intervalo = parseInt(args[args.length - 1]) || 10;
    const texto = args.slice(1, -1).join(' ') || '👀';

    if (!alvo) return message.reply('❌ Use: `!dmloop @usuario <mensagem> <segundos>`\nPara parar: `!dmstop @usuario`');
    if (intervalo < 5) return message.reply('❌ Mínimo 5 segundos de intervalo!');
    if (intervalo > 300) return message.reply('❌ Máximo 300 segundos!');
    if (dmLoops.has(alvo.id)) return message.reply(`⚠️ Já tem loop ativo pra ${alvo.username}! Use \`!dmstop @usuario\` primeiro.`);

    await message.reply(`🔁 Loop iniciado! Mandando *"${texto}"* pra ${alvo.username} a cada ${intervalo}s.\nUse \`!dmstop @${alvo.username}\` pra parar.`);

    const sendDM = async () => {
      try {
        const dm = await alvo.createDM();
        await dm.send(texto);
        console.log(`[DMLoop] "${texto}" → ${alvo.username}`);
      } catch (err) {
        console.error(`[DMLoop] Erro: ${err.message}`);
        clearInterval(interval);
        dmLoops.delete(alvo.id);
      }
    };

    await sendDM();
    const interval = setInterval(sendDM, intervalo * 1000);
    dmLoops.set(alvo.id, { interval, texto, intervalo });
  }

  // ── !dmstop @user ─────────────────────────────────────────────────────────
  if (command === 'dmstop') {
    const alvo = message.mentions.users.first();
    if (!alvo) return message.reply('❌ Use: `!dmstop @usuario`');

    if (dmLoops.has(alvo.id)) {
      clearInterval(dmLoops.get(alvo.id).interval);
      dmLoops.delete(alvo.id);
      await message.reply(`✅ Loop parado pra ${alvo.username}. Ele pode descansar... por enquanto 😈`);
    } else {
      await message.reply(`⚠️ Sem loop ativo pra ${alvo.username}.`);
    }
  }

  // ── !dmstopall ─────────────────────────────────────────────────────────────
  if (command === 'dmstopall') {
    if (dmLoops.size === 0) return message.reply('Nenhum loop ativo no momento.');
    for (const [, { interval }] of dmLoops) clearInterval(interval);
    const total = dmLoops.size;
    dmLoops.clear();
    await message.reply(`✅ ${total} loop(s) parado(s)! Paz por hoje.`);
  }

  // ── !dmloops ───────────────────────────────────────────────────────────────
  if (command === 'dmloops') {
    if (dmLoops.size === 0) return message.reply('Nenhum loop ativo no momento.');
    let lista = '🔁 **Loops ativos:**\n';
    for (const [userId, config] of dmLoops) {
      const user = await client.users.fetch(userId).catch(() => null);
      lista += `• ${user ? user.username : userId} — *"${config.texto}"* a cada ${config.intervalo}s\n`;
    }
    await message.reply(lista);
  }

  // ── !autoreply @user <resposta> ────────────────────────────────────────────
  if (command === 'autoreply') {
    const alvo = message.mentions.users.first();
    const resposta = args.slice(1).join(' ');

    if (!alvo) return message.reply('❌ Use: `!autoreply @usuario <resposta>`\nPara parar: `!autostop @usuario`');
    if (!resposta) return message.reply('❌ Inclua a resposta! Ex: `!autoreply @amigo Não me enche!`');

    autoReplyConfig.set(alvo.id, { ativo: true, resposta });
    await message.reply(`✅ Auto-reply ativado!\nToda DM que ${alvo.username} mandar pro bot, vou responder: *"${resposta}"*`);
  }

  // ── !autostop @user ────────────────────────────────────────────────────────
  if (command === 'autostop') {
    const alvo = message.mentions.users.first();
    if (!alvo) return message.reply('❌ Use: `!autostop @usuario`');

    if (autoReplyConfig.has(alvo.id)) {
      autoReplyConfig.delete(alvo.id);
      await message.reply(`✅ Auto-reply desativado pra ${alvo.username}.`);
    } else {
      await message.reply(`⚠️ Sem auto-reply ativo pra ${alvo.username}.`);
    }
  }

  // ── !autoreplies ───────────────────────────────────────────────────────────
  if (command === 'autoreplies') {
    if (autoReplyConfig.size === 0) return message.reply('Nenhum auto-reply ativo.');
    let lista = '🤖 **Auto-replies ativos:**\n';
    for (const [userId, config] of autoReplyConfig) {
      const user = await client.users.fetch(userId).catch(() => null);
      lista += `• ${user ? user.username : userId} → *"${config.resposta}"*\n`;
    }
    await message.reply(lista);
  }

  // ── !dmspam @user <quantidade> <mensagem> ─────────────────────────────────
  if (command === 'dmspam') {
    const alvo = message.mentions.users.first();
    const quantidade = parseInt(args[1]);
    const texto = args.slice(2).join(' ') || '👀';

    if (!alvo) return message.reply('❌ Use: `!dmspam @usuario <1-20> <mensagem>`');
    if (!quantidade || quantidade < 1 || quantidade > 20) return message.reply('❌ Quantidade: 1 a 20!');

    await message.reply(`📨 Mandando ${quantidade} DMs pra ${alvo.username}...`);
    try {
      const dm = await alvo.createDM();
      for (let i = 0; i < quantidade; i++) {
        await dm.send(texto);
        await sleep(700);
      }
      await message.channel.send(`✅ Feito! ${alvo.username} recebeu ${quantidade} DMs 😈`);
    } catch {
      await message.channel.send('❌ Não consegui abrir DM com essa pessoa.');
    }
  }

  // ── !dmmisterioso @user <mensagem> ────────────────────────────────────────
  // Fica "digitando..." por alguns segundos antes de mandar — parece humano
  if (command === 'dmmisterioso') {
    const alvo = message.mentions.users.first();
    const texto = args.slice(1).join(' ') || '...';

    if (!alvo) return message.reply('❌ Use: `!dmmisterioso @usuario <mensagem>`');

    await message.delete().catch(() => {});
    try {
      const dm = await alvo.createDM();
      await dm.sendTyping();
      await sleep(3000 + Math.random() * 2000);
      await dm.send(texto);
      await message.channel.send(`🕵️ Mensagem misteriosa enviada pra ${alvo.username}!`);
    } catch {
      await message.channel.send('❌ Não consegui abrir DM com essa pessoa.');
    }
  }

  // ── !contato @user <mensagem> ─────────────────────────────────────────────
  // DM silenciosa — não avisa no canal (ideal pra susto)
  if (command === 'contato') {
    const alvo = message.mentions.users.first();
    const texto = args.slice(1).join(' ') || 'Alguém te procura...';

    if (!alvo) return message.reply('❌ Use: `!contato @usuario <mensagem>`');

    await message.delete().catch(() => {});
    try {
      const dm = await alvo.createDM();
      await dm.sendTyping();
      await sleep(2000);
      await dm.send(`📞 ${texto}`);
    } catch {
      // silêncio intencional — não avisa nada
    }
  }

  // ==========================================================================
  // COMANDOS DE SERVIDOR
  // ==========================================================================

  if (command === 'spam') {
    const quantidade = parseInt(args[0]);
    const texto = args.slice(1).join(' ');
    if (!quantidade || isNaN(quantidade) || quantidade < 1 || quantidade > 50)
      return message.reply('❌ Use: `!spam <1-50> <mensagem>`');
    if (!texto) return message.reply('❌ Use: `!spam <quantidade> <mensagem>`');
    await message.delete().catch(() => {});
    for (let i = 0; i < quantidade; i++) {
      await message.channel.send(texto);
      await sleep(600);
    }
  }

  if (command === 'mencao' || command === 'mencionar') {
    const alvo = message.mentions.users.first();
    const quantidade = parseInt(args[1]) || 5;
    if (!alvo) return message.reply('❌ Use: `!mencao @usuario <quantidade>`');
    if (quantidade > 20) return message.reply('❌ Máximo de 20 menções!');
    await message.delete().catch(() => {});
    for (let i = 0; i < quantidade; i++) {
      await message.channel.send(`${alvo} 👀`);
      await sleep(700);
    }
  }

  if (command === 'eco') {
    const texto = args.join(' ');
    if (!texto) return message.reply('❌ Use: `!eco <mensagem>`');
    await message.delete().catch(() => {});
    await message.channel.send(texto);
  }

  if (command === 'reverse') {
    const texto = args.join(' ');
    if (!texto) return message.reply('❌ Use: `!reverse <mensagem>`');
    await message.delete().catch(() => {});
    await message.channel.send(texto.split('').reverse().join(''));
  }

  if (command === 'oi') {
    const alvo = message.mentions.users.first();
    const quantidade = parseInt(args[1]) || 5;
    if (!alvo) return message.reply('❌ Use: `!oi @usuario <quantidade>`');
    if (quantidade > 15) return message.reply('❌ Máximo 15!');
    await message.delete().catch(() => {});
    try {
      const dm = await alvo.createDM();
      for (let i = 0; i < quantidade; i++) {
        await dm.send('oi');
        await sleep(800);
      }
      await message.channel.send(`📨 Mandei ${quantidade} "oi" pro ${alvo.username} 😏`);
    } catch {
      await message.channel.send('❌ Não consegui enviar DM pra essa pessoa.');
    }
  }

  if (command === 'emoji') {
    const emoji = args[0];
    const quantidade = parseInt(args[1]) || 10;
    if (!emoji) return message.reply('❌ Use: `!emoji <emoji> <quantidade>`');
    if (quantidade > 30) return message.reply('❌ Máximo 30!');
    await message.delete().catch(() => {});
    await message.channel.send(`${emoji} `.repeat(quantidade));
  }

  if (command === 'contagem') {
    const numero = parseInt(args[0]);
    const texto = args.slice(1).join(' ') || '💥 BOOM!';
    if (!numero || numero < 1 || numero > 10)
      return message.reply('❌ Use: `!contagem <1-10> <mensagem>`');
    await message.delete().catch(() => {});
    for (let i = numero; i >= 1; i--) {
      await message.channel.send(`**${i}...**`);
      await sleep(1000);
    }
    await message.channel.send(`🚨 ${texto}`);
  }

  if (command === 'lento') {
    const alvo = message.mentions.users.first();
    const restArgs = args.slice(1);
    const vezes = parseInt(restArgs[restArgs.length - 2]) || 3;
    const intervalo = parseInt(restArgs[restArgs.length - 1]) || 5;
    const texto = restArgs.slice(0, -2).join(' ') || 'Ei...';
    if (!alvo) return message.reply('❌ Use: `!lento @usuario <mensagem> <vezes> <segundos>`');
    if (vezes > 10) return message.reply('❌ Máximo 10 vezes!');
    if (intervalo > 30) return message.reply('❌ Máximo 30 segundos!');
    await message.delete().catch(() => {});
    await message.channel.send(`⏳ Iniciando tortura lenta em ${alvo.username}...`);
    for (let i = 0; i < vezes; i++) {
      await sleep(intervalo * 1000);
      await message.channel.send(`${alvo} — ${texto} (${i + 1}/${vezes})`);
    }
  }

  if (command === 'copycat') {
    const alvo = message.mentions.users.first();
    const vezes = parseInt(args[1]) || 5;
    if (!alvo) return message.reply('❌ Use: `!copycat @usuario <quantidade>`');
    if (vezes > 10) return message.reply('❌ Máximo 10!');
    await message.delete().catch(() => {});
    await message.channel.send(`🐱 Vou repetir tudo que ${alvo.username} falar por ${vezes} mensagens...`);
    let contador = 0;
    const collector = message.channel.createMessageCollector({
      filter: (m) => m.author.id === alvo.id,
      max: vezes,
      time: 60000,
    });
    collector.on('collect', async (m) => {
      contador++;
      await message.channel.send(`${alvo} disse: "${m.content}" 🦜`);
    });
    collector.on('end', async () => {
      await message.channel.send(`✅ Repeti ${contador} mensagens de ${alvo.username}!`);
    });
  }

  if (command === 'caguetar') {
    const alvo = message.mentions.users.first();
    if (!alvo) return message.reply('❌ Use: `!caguetar @usuario`');
    const msgs = await message.channel.messages.fetch({ limit: 100 });
    const ultima = msgs.find((m) => m.author.id === alvo.id && m.id !== message.id);
    if (!ultima) return message.reply('❌ Não achei mensagem recente dessa pessoa aqui.');
    await message.channel.send(
      `🚨 **CAGUETANDO ${alvo.username.toUpperCase()}** 🚨\nÚltima mensagem: *"${ultima.content}"*`
    );
  }

  // ── !help ─────────────────────────────────────────────────────────────────
  if (command === 'help' || command === 'ajuda') {
    await message.reply(`
😈 **Bot Troll — Todos os Comandos** 😈

**📨 DM Loop**
\`!dmloop @user <msg> <seg>\` — Loop infinito de DMs (mínimo 5s)
\`!dmstop @user\` — Para o loop de alguém
\`!dmstopall\` — Para TODOS os loops
\`!dmloops\` — Lista loops ativos
\`!dmspam @user <1-20> <msg>\` — Rafaga de DMs
\`!dmmisterioso @user <msg>\` — DM com "digitando..." antes (parece humano)
\`!contato @user <msg>\` — DM silenciosa sem avisar no canal

**🤖 Auto-Reply em DM**
\`!autoreply @user <resposta>\` — Responde toda DM que ele mandar pro bot
\`!autostop @user\` — Para o auto-reply de alguém
\`!autoreplies\` — Lista auto-replies ativos

**📢 Canal**
\`!spam <1-50> <msg>\` — Manda X vezes no canal
\`!mencao @user <1-20>\` — Menciona X vezes
\`!eco <msg>\` — Mensagem anônima
\`!reverse <msg>\` — Mensagem ao contrário
\`!oi @user <1-15>\` — Manda "oi" por DM
\`!emoji <emoji> <1-30>\` — Enche de emoji
\`!contagem <1-10> <msg>\` — Contagem regressiva dramática
\`!lento @user <msg> <vezes> <seg>\` — Assombra lentamente
\`!copycat @user <vezes>\` — Repete tudo que a pessoa falar
\`!caguetar @user\` — Expõe última mensagem
    `);
  }
});

// ===================== SLEEP HELPER =====================
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ===================== EXPRESS (keep-alive Render) =====================
app.get('/', (req, res) => res.send('Bot troll online 😈'));
app.get('/ping', (req, res) => res.json({
  status: 'alive',
  loops_ativos: dmLoops.size,
  autoreplies_ativos: autoReplyConfig.size,
  time: new Date().toISOString()
}));

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`Servidor HTTP na porta ${PORT}`));
server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`[HTTP] Porta ${PORT} ja esta em uso. Finalize o processo dessa porta ou defina PORT.`);
    process.exit(1);
  }
  throw err;
});

// ===================== KEEP-ALIVE (anti-sleep Render) =====================
if (process.env.RENDER_URL) {
  const https = require('https');
  const http = require('http');
  setInterval(() => {
    const url = process.env.RENDER_URL;
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, (res) => {
      console.log(`[KeepAlive] ${res.statusCode} — ${new Date().toLocaleTimeString('pt-BR')}`);
    }).on('error', (err) => console.error(`[KeepAlive] Erro: ${err.message}`));
  }, 14 * 60 * 1000);
  console.log('🔁 Keep-alive ativado!');
}

// ===================== LOGIN =====================
const token = (process.env.DISCORD_TOKEN || '').trim();
if (!token) {
  console.error('[Discord] DISCORD_TOKEN nao encontrado. Defina no .env ou nas variaveis de ambiente.');
  process.exit(1);
}
if (token.split('.').length !== 3 || token.length < 50) {
  console.error(`[Discord] DISCORD_TOKEN parece invalido/incompleto (len=${token.length}). Gere um novo token e atualize o .env.`);
  process.exit(1);
}
client.login(token).catch((err) => {
  console.error(`[Discord] Falha no login: ${err.code || err.message}`);
  process.exit(1);
});
