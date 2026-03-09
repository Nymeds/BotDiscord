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
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
});

// channelId -> { timer, text, intervalSec }
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

      clearLoop(channelId);

      let sending = false;
      const timer = setInterval(async () => {
        if (sending) return;
        sending = true;
        try {
          await channel.send(text.slice(0, 2000));
        } catch (err) {
          console.error(`[fala] Erro no canal ${channelId}: ${err.message}`);
          clearLoop(channelId);
        } finally {
          sending = false;
        }
      }, intervalSec * 1000);

      activeLoops.set(channelId, { timer, text, intervalSec });
      await interaction.reply(`Loop iniciado. Mensagem a cada ${intervalSec}s. Use /pare para parar.`);
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

// Mimic works in guild channels and DMs with the bot
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!mimicChannels.has(message.channelId)) return;

  const content = (message.content || '').trim();
  if (!content) return;

  try {
    await message.channel.send(content.slice(0, 2000));
  } catch (err) {
    console.error(`[mimic] Erro no canal ${message.channelId}: ${err.message}`);
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
