const {
  Client,
  GatewayIntentBits,
  Partials,
  SlashCommandBuilder,
} = require("discord.js");

const express = require("express");

const app = express();
app.get("/", (req, res) => res.send("Bot online"));

const PORT = process.env.PORT || 3000;
app.listen(PORT);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

const loops = new Map();
const mimicChannels = new Set();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function humanDelay(min = 500, max = 2000) {
  return Math.floor(Math.random() * (max - min) + min);
}

function stopLoop(channelId) {
  const loop = loops.get(channelId);
  if (!loop) return false;

  loop.active = false;
  loops.delete(channelId);
  return true;
}

async function infiniteLoop(channel, channelId, text, interval) {
  const loop = { active: true };
  loops.set(channelId, loop);

  while (loop.active) {
    try {
      await channel.sendTyping();
      await sleep(humanDelay());

      await channel.send(text.slice(0, 2000));
    } catch (err) {
      console.log("Loop erro:", err.message);
      break;
    }

    await sleep(interval * 1000);
  }

  loops.delete(channelId);
}

async function spamMessages(channel, text, qty) {
  for (let i = 0; i < qty; i++) {
    try {
      await channel.sendTyping();
      await sleep(humanDelay());

      await channel.send(text.slice(0, 2000));
    } catch (err) {
      console.log("Spam erro:", err.message);
      break;
    }

    await sleep(2000);
  }
}

client.once("ready", async () => {
  console.log("Bot online:", client.user.tag);

  const commands = [
    new SlashCommandBuilder()
      .setName("fala")
      .setDescription("Repete mensagem em loop")
      .addStringOption((o) =>
        o.setName("mensagem").setDescription("texto").setRequired(true)
      )
      .addIntegerOption((o) =>
        o
          .setName("intervalo")
          .setDescription("segundos")
          .setMinValue(1)
          .setMaxValue(3600)
      ),

    new SlashCommandBuilder()
      .setName("spam")
      .setDescription("Envia varias mensagens")
      .addStringOption((o) =>
        o.setName("mensagem").setDescription("texto").setRequired(true)
      )
      .addIntegerOption((o) =>
        o.setName("quantidade").setDescription("quantidade").setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("spamloop")
      .setDescription("Spam infinito")
      .addStringOption((o) =>
        o.setName("mensagem").setDescription("texto").setRequired(true)
      )
      .addIntegerOption((o) =>
        o.setName("intervalo").setDescription("segundos")
      ),

    new SlashCommandBuilder()
      .setName("mimic")
      .setDescription("Repete tudo que falarem"),

    new SlashCommandBuilder()
      .setName("pare")
      .setDescription("Para tudo"),

    new SlashCommandBuilder()
      .setName("oiduende")
      .setDescription("Diz oi"),
  ].map((c) => c.toJSON());

  await client.application.commands.set(commands);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const channel = interaction.channel;
  const id = channel.id;

  if (interaction.commandName === "fala") {
    const text = interaction.options.getString("mensagem");
    const interval = interaction.options.getInteger("intervalo") || 5;

    stopLoop(id);

    infiniteLoop(channel, id, text, interval);

    interaction.reply(
      `Beleza 😈 vou repetir a cada ${interval}s.\nUse /pare se quiser me calar`
    );
  }

  if (interaction.commandName === "spam") {
    const text = interaction.options.getString("mensagem");
    const qty = interaction.options.getInteger("quantidade");

    interaction.reply(`Enviando ${qty} mensagens...`);

    spamMessages(channel, text, qty);
  }

  if (interaction.commandName === "spamloop") {
    const text = interaction.options.getString("mensagem");
    const interval = interaction.options.getInteger("intervalo") || 3;

    stopLoop(id);

    infiniteLoop(channel, id, text, interval);

    interaction.reply("Spam infinito iniciado 😈");
  }

  if (interaction.commandName === "mimic") {
    mimicChannels.add(id);
    interaction.reply("Agora vou repetir tudo que falarem 👀");
  }

  if (interaction.commandName === "pare") {
    const stopped = stopLoop(id);
    const mimic = mimicChannels.delete(id);

    if (!stopped && !mimic) {
      interaction.reply("Nada estava ativo aqui.");
      return;
    }

    interaction.reply("Ok parei 👍");
  }

  if (interaction.commandName === "oiduende") {
    interaction.reply("Oi 👋");
  }
});

client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;

  if (!mimicChannels.has(msg.channel.id)) return;

  const text = msg.content.trim();
  if (!text) return;

  try {
    await msg.channel.sendTyping();
    await sleep(humanDelay());

    await msg.channel.send(text);
  } catch (err) {
    console.log("Mimic erro:", err.message);
  }
});

client.login(process.env.DISCORD_TOKEN);