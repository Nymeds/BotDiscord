const {
  Client,
  GatewayIntentBits,
  Partials,
  SlashCommandBuilder,
  ApplicationIntegrationType,
  InteractionContextType,
} = require('discord.js');
const express = require('express');

// Load .env when running with `node index.js` (Node 20+)
try {
  process.loadEnvFile();
} catch (_) {
  // .env is optional when env vars are provided by the host
}

const app = express();
app.use(express.json());

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent, // OBRIGATÓRIO: habilitar no Discord Developer Portal também
  ],
  partials: [Partials.Channel, Partials.Message],
});

// channelId -> { timer, text, intervalSec, channelId }
const activeLoops = new Map();
// channelIds where mimic is enabled
const mimicChannels = new Set();

const slashCommands = [
  new SlashCommandBuilder()
    .setName('fala')
    .setDescription('Repete uma mensagem em loop')
    .addStringOption((opt) =>
      opt.setName('mensagem').setDescription('Texto que sera repetido').setRequired(true)
    )
    .addIntegerOption((opt) =>
      opt
        .setName('intervalo')
        .setDescription('Intervalo em segundos (padrao: 5)')
        .setMinValue(1)
        .setMaxValue(3600)
    )
    .setDMPermission(true),
  new SlashCommandBuilder()
    .setName('pare')
    .setDescription('Para o loop e desativa mimic neste chat')
    .setDMPermission(true),
  new SlashCommandBuilder()
    .setName('mimic')
    .setDescription('Repete tudo que as outras pessoas falarem neste chat')
    .setDMPermission(true),
  new SlashCommandBuilder()
    .setName('oiduende')
    .setDescription('Responde Oi')
    .setDMPermission(true),
].map((command) =>
  command
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall)
    .setContexts(
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel
    )
    .toJSON()
);

function canSend(channel) {
  return Boolean(channel && typeof channel.send === 'function');
}

function clearLoop(channelId) {
  const entry = activeLoops.get(channelId);
  if (!entry) return false;
  clearInterval(entry.timer);
  activeLoops.delete(channelId);
  return true;
}

function stopChannelFeatures(channelId) {
  const hadLoop = clearLoop(channelId);
  const hadMimic = mimicChannels.delete(channelId);
  return { hadLoop, hadMimic };
}

// Busca o canal pelo cache ou via fetch — evita referência stale
async function resolveChannel(channelId) {
  try {
    return client.channels.cache.get(channelId) || await client.channels.fetch(channelId);
  } catch {
    return null;
  }
}

client.once('clientReady', async () => {
  console.log(`Bot online como ${client.user.tag}`);
  client.user.setActivity('Slash commands', { type: 'PLAYING' });

  try {
    const guildId = (process.env.GUILD_ID || '').trim();
    if (guildId) {
      await client.application.commands.set(slashCommands, guildId);
      console.log(`[Slash] ${slashCommands.length} comando(s) registrado(s) no servidor ${guildId}.`);
    } else {
      console.log('[Slash] GUILD_ID nao definido; comandos de servidor podem demorar a aparecer globalmente.');
    }

    await client.application.commands.set(slashCommands);
    console.log(`[Slash] ${slashCommands.length} comando(s) registrado(s) globalmente.`);
  } catch (err) {
    console.error(`[Slash] Erro ao registrar comandos: ${err.message}`);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const channel = interaction.channel;
  if (!canSend(channel)) {
    await interaction.reply({ content: 'Nao consegui acessar este chat.', ephemeral: true }).catch(() => {});
    return;
  }

  const channelId = channel.id;
  const command = interaction.commandName;

  try {
    if (command === 'fala') {
      const text = interaction.options.getString('mensagem', true).trim();
      const intervalSec = interaction.options.getInteger('intervalo') ?? 5;

      if (!text) {
        await interaction.reply('Informe uma mensagem valida.');
        return;
      }

      // Para loop anterior se houver
      clearLoop(channelId);

      let errorCount = 0;
      const MAX_ERRORS = 3; // Só cancela após 3 erros consecutivos, não no primeiro

      const timer = setInterval(async () => {
        // Busca canal fresco a cada tick — evita referência stale
        const ch = await resolveChannel(channelId);

        if (!canSend(ch)) {
          errorCount++;
          console.error(`[fala] Canal ${channelId} inacessivel (tentativa ${errorCount}/${MAX_ERRORS})`);
          if (errorCount >= MAX_ERRORS) {
            console.error(`[fala] Cancelando loop do canal ${channelId} após ${MAX_ERRORS} falhas.`);
            clearLoop(channelId);
          }
          return;
        }

        try {
          await ch.send(text.slice(0, 2000));
          errorCount = 0; // Reset ao ter sucesso
        } catch (err) {
          errorCount++;
          console.error(`[fala] Erro ao enviar no canal ${channelId} (tentativa ${errorCount}/${MAX_ERRORS}): ${err.message}`);
          if (errorCount >= MAX_ERRORS) {
            console.error(`[fala] Cancelando loop do canal ${channelId} após ${MAX_ERRORS} falhas.`);
            clearLoop(channelId);
          }
        }
      }, intervalSec * 1000);

      activeLoops.set(channelId, { timer, text, intervalSec });
      await interaction.reply(`Loop iniciado. Mensagem a cada ${intervalSec}s. Use /pare para parar.`);
      return;
    }

    if (command === 'oiduende') {
      await interaction.reply('Oi');
      return;
    }

    if (command === 'mimic') {
      mimicChannels.add(channelId);
      await interaction.reply('Mimic ativado neste chat. Use /pare para desativar.');
      return;
    }

    if (command === 'pare') {
      const { hadLoop, hadMimic } = stopChannelFeatures(channelId);
      if (!hadLoop && !hadMimic) {
        await interaction.reply('Nao havia loop nem mimic ativos neste chat.');
        return;
      }

      const parts = [];
      if (hadLoop) parts.push('loop parado');
      if (hadMimic) parts.push('mimic desativado');
      await interaction.reply(`Ok: ${parts.join(' e ')}.`);
      return;
    }

    await interaction.reply('Comando nao reconhecido.');
  } catch (err) {
    console.error(`[Slash] Erro no comando /${command}:`, err);
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: 'Erro ao executar comando.' }).catch(() => {});
    } else {
      await interaction.reply({ content: 'Erro ao executar comando.', ephemeral: true }).catch(() => {});
    }
  }
});

// Mimic — funciona em servidores e DMs
client.on('messageCreate', async (message) => {
  // Ignora mensagens do próprio bot
  if (message.author.bot) return;

  // Usa channelId com fallback para channel.id
  const channelId = message.channelId ?? message.channel?.id;
  if (!channelId) return;

  if (!mimicChannels.has(channelId)) return;

  const content = (message.content || '').trim();
  if (!content) return;

  try {
    // Garante que o canal está acessível antes de enviar
    const ch = message.channel ?? await resolveChannel(channelId);
    if (!canSend(ch)) {
      console.error(`[mimic] Canal ${channelId} inacessivel.`);
      return;
    }
    await ch.send(content.slice(0, 2000));
  } catch (err) {
    console.error(`[mimic] Erro no canal ${channelId}: ${err.message}`);
  }
});

app.get('/', (_req, res) => res.send('Bot online'));
app.get('/ping', (_req, res) =>
  res.json({
    status: 'alive',
    loops_ativos: activeLoops.size,
    mimic_ativos: mimicChannels.size,
    time: new Date().toISOString(),
  })
);

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`Servidor HTTP na porta ${PORT}`));
server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`[HTTP] Porta ${PORT} ja esta em uso. Finalize o processo dessa porta ou defina PORT.`);
    process.exit(1);
  }
  throw err;
});

if (process.env.RENDER_URL) {
  const https = require('https');
  const http = require('http');

  setInterval(() => {
    const url = process.env.RENDER_URL;
    const lib = url.startsWith('https') ? https : http;
    lib
      .get(url, (res) => {
        console.log(`[KeepAlive] ${res.statusCode} - ${new Date().toLocaleTimeString('pt-BR')}`);
      })
      .on('error', (err) => console.error(`[KeepAlive] Erro: ${err.message}`));
  }, 14 * 60 * 1000);

  console.log('Keep-alive ativado.');
}

process.on('SIGINT', () => {
  for (const [, { timer }] of activeLoops) clearInterval(timer);
  activeLoops.clear();
  process.exit(0);
});

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