require("dotenv").config();
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});
const {
  Client,
  GatewayIntentBits,
  Partials,
  SlashCommandBuilder,
} = require("discord.js");
const {
  ApplicationIntegrationType,
  InteractionContextType,
} = require("discord-api-types/v10");

const express = require("express");
const app = express();
app.get("/", (req, res) => res.send("Bot online"));

const PORT = process.env.PORT || 3000;
app.listen(PORT);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});
client.on("error", (err) => {
  console.error("Discord client error:", err);
});
client.on("interactionCreate", async (interaction) => {
  console.log("Interaction recebida:", interaction.commandName);
});
client.on("shardError", (err) => {
  console.error("Shard error:", err);
});
const MAX_BURST = 5;
const MAX_FOLLOWUPS = 5;
const MAX_MESSAGES_PER_INTERACTION = 1 + MAX_FOLLOWUPS;
const FOLLOWUP_MIN_DELAY = 800;
const FOLLOWUP_MAX_DELAY = 1400;
const COMMAND_INTEGRATIONS = [
  ApplicationIntegrationType.UserInstall,
  ApplicationIntegrationType.GuildInstall,
];
const COMMAND_CONTEXTS = [
  InteractionContextType.Guild,
  InteractionContextType.BotDM,
  InteractionContextType.PrivateChannel,
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function randomDelay(min = FOLLOWUP_MIN_DELAY, max = FOLLOWUP_MAX_DELAY) {
  return Math.floor(Math.random() * (max - min) + min);
}

function truncate(text, limit = 2000) {
  if (!text) return "";
  return text.length > limit ? text.slice(0, limit) : text;
}

function withContexts(command) {
  return command
    .setIntegrationTypes(...COMMAND_INTEGRATIONS)
    .setContexts(...COMMAND_CONTEXTS);
}

const DUENDE_PHRASES = [
  "O duende apareceu.",
  "Bateu a saudade do duende.",
  "Ei! O duende ta de olho 👀",
  "To aqui so pra incomodar um pouco.",
  "Respira fundo que o duende chegou.",
  "Duende passando pra dar bom dia.",
  "Opa, so um toque do duende.",
];
const CUTUCA_PHRASES = [
  "ei",
  "ei?",
  "opa",
  "cade voce?",
  "fala comigo",
  "to aqui",
];

function clampCount(value, max = MAX_BURST) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 1;
  return Math.max(1, Math.min(Math.floor(num), max));
}

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

const DUENDE_STYLE = [
  "Voce e o Duende, um personagem brincalhao e levemente provocador.",
  "Fale em portugues do Brasil, informal e direto.",
  "Nao diga que e IA, assistente ou modelo.",
  "Nao mencione Gemini nem Google.",
  "Responda curto quando possivel, com tom zoeiro.",
].join(" ");

function buildDuendePrompt(userPrompt, type) {
  const modeLine =
    type === "imagem"
      ? "Gere uma imagem fiel ao pedido. Se adicionar texto, seja breve."
      : "Responda como o Duende.";
  return `${DUENDE_STYLE}\n${modeLine}\nPedido: ${userPrompt}`;
}

function splitTextLimited(
  text,
  maxMessages = MAX_MESSAGES_PER_INTERACTION,
  limit = 2000
) {
  if (!text) return [];
  const maxChars = maxMessages * limit;
  let trimmed = text;

  if (text.length > maxChars) {
    const suffix = "\n...(cortado)";
    const keep = Math.max(0, maxChars - suffix.length);
    trimmed = text.slice(0, keep) + suffix;
  }

  return splitText(trimmed, limit);
}

async function sendFollowups(
  interaction,
  messages,
  maxFollowups = MAX_FOLLOWUPS
) {
  let sent = 0;
  for (const message of messages) {
    if (sent >= maxFollowups) break;
    await sleep(randomDelay());
    try {
      await interaction.followUp(truncate(message));
      sent += 1;
    }catch (err) {
  console.error("Erro Gemini:", err);

  const msg = truncate(err?.message || "Erro desconhecido", 1800);

  try {
    await interaction.editReply(`Falha ao chamar a IA:\n${msg}`);
  } catch (e) {
    console.error("Falha ao responder interaction:", e);
  }
}
  }
}

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_TEXT_MODEL = "gemini-2.5-flash";
const GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image";

function splitText(text, limit = 2000) {
  if (!text) return [];
  const chunks = [];
  for (let i = 0; i < text.length; i += limit) {
    chunks.push(text.slice(i, i + limit));
  }
  return chunks;
}

function extractTextFromParts(parts) {
  return parts
    .map((p) => p.text)
    .filter(Boolean)
    .join("\n")
    .trim();
}

function extractImageFromParts(parts) {
  const part = parts.find((p) => p.inlineData || p.inline_data);
  if (!part) return null;

  const inline = part.inlineData || part.inline_data;
  const data = inline?.data;
  const mime =
    inline?.mimeType || inline?.mime_type || "image/png";

  if (!data) return null;
  return { data, mime };
}

async function geminiGenerate({ apiKey, prompt, type }) {
  const model = type === "imagem" ? GEMINI_IMAGE_MODEL : GEMINI_TEXT_MODEL;
  const url = `${GEMINI_API_BASE}/${model}:generateContent`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini ${res.status}`);
    }

    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function handleGeminiInteraction(interaction, prompt, type) {
  const apiKey = process.env.IAKEY;

  if (!apiKey) {
    await interaction.reply("IAKEY nao configurada no .env.");
    return;
  }

  await interaction.deferReply();

  try {
    const data = await geminiGenerate({
      apiKey,
      prompt: buildDuendePrompt(prompt, type),
      type,
    });
    const parts = data?.candidates?.[0]?.content?.parts || [];

    if (type === "imagem") {
      const image = extractImageFromParts(parts);
      const text = extractTextFromParts(parts);

      if (!image) {
        await interaction.editReply("Nao consegui gerar a imagem.");
        if (text) {
          const chunks = splitTextLimited(text);
          if (chunks.length) {
            await sendFollowups(interaction, chunks);
          }
        }
        return;
      }

      const buffer = Buffer.from(image.data, "base64");
      const ext = image.mime.split("/")[1] || "png";

      await interaction.editReply({
        content: "Olha o presente do Duende:",
        files: [{ attachment: buffer, name: `duende.${ext}` }],
      });

      if (text) {
        const chunks = splitTextLimited(text);
        if (chunks.length) {
          await sendFollowups(interaction, chunks);
        }
      }

      return;
    }

    const text = extractTextFromParts(parts);
    if (!text) {
      await interaction.editReply("Nao recebi texto da IA.");
      return;
    }

    const chunks = splitTextLimited(text);
    await interaction.editReply(chunks.shift());
    if (chunks.length) {
      await sendFollowups(interaction, chunks);
    }
  } catch (err) {
    await interaction.editReply(`Falha ao chamar a IA: ${err.message}`);
  }
}

client.once("clientReady", async () => {
  console.log("Bot online:", client.user.tag);

  const commands = [
    withContexts(
      new SlashCommandBuilder()
        .setName("fala")
        .setDescription("Envia a mensagem (modo app)")
        .addStringOption((o) =>
          o.setName("mensagem").setDescription("texto").setRequired(true)
        )
        .addIntegerOption((o) =>
          o
            .setName("intervalo")
            .setDescription("segundos")
            .setMinValue(1)
            .setMaxValue(3600)
        )
    ),

    withContexts(
      new SlashCommandBuilder()
        .setName("spam")
        .setDescription("Envia varias mensagens (limitado)")
        .addStringOption((o) =>
          o.setName("mensagem").setDescription("texto").setRequired(true)
        )
        .addIntegerOption((o) =>
          o.setName("quantidade").setDescription("quantidade").setRequired(true)
        )
    ),

    withContexts(
      new SlashCommandBuilder()
        .setName("spamloop")
        .setDescription("Indisponivel no modo app")
        .addStringOption((o) =>
          o.setName("mensagem").setDescription("texto").setRequired(true)
        )
        .addIntegerOption((o) =>
          o.setName("intervalo").setDescription("segundos")
        )
    ),

    withContexts(
      new SlashCommandBuilder()
        .setName("mimic")
        .setDescription("Indisponivel no modo app")
    ),

    withContexts(
      new SlashCommandBuilder()
        .setName("pare")
        .setDescription("Indisponivel no modo app")
    ),

    withContexts(
      new SlashCommandBuilder()
        .setName("duende")
        .setDescription("Mensagens do duende (limitado)")
        .addIntegerOption((o) =>
          o
            .setName("quantidade")
            .setDescription("quantas mensagens")
            .setMinValue(1)
            .setMaxValue(MAX_BURST)
        )
    ),

    withContexts(
      new SlashCommandBuilder()
        .setName("grita")
        .setDescription("Repete em CAPS (limitado)")
        .addStringOption((o) =>
          o.setName("mensagem").setDescription("texto").setRequired(true)
        )
        .addIntegerOption((o) =>
          o
            .setName("quantidade")
            .setDescription("quantas mensagens")
            .setMinValue(1)
            .setMaxValue(MAX_BURST)
        )
    ),

    withContexts(
      new SlashCommandBuilder()
        .setName("eco")
        .setDescription("Repete a mensagem (limitado)")
        .addStringOption((o) =>
          o.setName("mensagem").setDescription("texto").setRequired(true)
        )
        .addIntegerOption((o) =>
          o
            .setName("quantidade")
            .setDescription("quantas mensagens")
            .setMinValue(1)
            .setMaxValue(MAX_BURST)
        )
    ),

    withContexts(
      new SlashCommandBuilder()
        .setName("cutuca")
        .setDescription("So pra irritar (limitado)")
        .addIntegerOption((o) =>
          o
            .setName("quantidade")
            .setDescription("quantas mensagens")
            .setMinValue(1)
            .setMaxValue(MAX_BURST)
        )
    ),

    withContexts(
      new SlashCommandBuilder()
        .setName("responda")
        .setDescription("Pergunta para a IA")
        .addStringOption((o) =>
          o.setName("prompt").setDescription("pergunta").setRequired(true)
        )
    ),

    withContexts(
      new SlashCommandBuilder()
        .setName("imagem")
        .setDescription("Gera imagem do duende")
        .addStringOption((o) =>
          o.setName("prompt").setDescription("descricao").setRequired(true)
        )
    ),

    withContexts(
      new SlashCommandBuilder()
        .setName("oi")
        .setDescription("Diz oi")
    ),
  ].map((c) => c.toJSON());

  await client.application.commands.set(commands);
});

client.on("interactionCreate", async (interaction) => {try
{
  if (!interaction.isChatInputCommand()) return;

  const command = interaction.commandName;
  const unsupportedNotice =
    "No modo app/DM, este comando nao funciona. Use o bot em um servidor.";

  if (command === "fala") {
    const text = interaction.options.getString("mensagem");
    const interval = interaction.options.getInteger("intervalo");

    await interaction.reply(truncate(text));

    if (interval) {
      await interaction.followUp(
        "No modo app/DM, o intervalo e ignorado (nao faco loop)."
      );
    }

    return;
  }

  if (command === "spam") {
    const text = interaction.options.getString("mensagem");
    const qty = interaction.options.getInteger("quantidade");
    const count = clampCount(qty);
    const message = truncate(text);
    const followups = [];

    for (let i = 1; i < count; i++) {
      followups.push(message);
    }

    if (qty > MAX_BURST) {
      followups.push(
        `Limite no modo app/DM: ${MAX_BURST} mensagens por comando.`
      );
    }

    await interaction.reply(message);

    if (followups.length) {
      await sendFollowups(interaction, followups);
    }

    return;
  }

  if (command === "duende") {
    const count = clampCount(
      interaction.options.getInteger("quantidade")
    );
    const messages = Array.from({ length: count }, () =>
      pickRandom(DUENDE_PHRASES)
    );

    await interaction.reply(truncate(messages.shift()));

    if (messages.length) {
      await sendFollowups(interaction, messages);
    }

    return;
  }

  if (command === "grita") {
    const text = interaction.options.getString("mensagem");
    const count = clampCount(
      interaction.options.getInteger("quantidade")
    );
    const message = truncate(text.toUpperCase());

    await interaction.reply(message);

    if (count > 1) {
      await sendFollowups(
        interaction,
        Array.from({ length: count - 1 }, () => message)
      );
    }

    return;
  }

  if (command === "eco") {
    const text = interaction.options.getString("mensagem");
    const count = clampCount(
      interaction.options.getInteger("quantidade")
    );
    const message = truncate(text);

    await interaction.reply(message);

    if (count > 1) {
      await sendFollowups(
        interaction,
        Array.from({ length: count - 1 }, () => message)
      );
    }

    return;
  }

  if (command === "cutuca") {
    const count = clampCount(
      interaction.options.getInteger("quantidade")
    );
    const messages = Array.from({ length: count }, () =>
      pickRandom(CUTUCA_PHRASES)
    );

    await interaction.reply(truncate(messages.shift()));

    if (messages.length) {
      await sendFollowups(interaction, messages);
    }

    return;
  }

  if (command === "responda") {
    const prompt = interaction.options.getString("prompt");
    await handleGeminiInteraction(interaction, prompt, "texto");
    return;
  }

  if (command === "imagem") {
    const prompt = interaction.options.getString("prompt");
    await handleGeminiInteraction(interaction, prompt, "imagem");
    return;
  }

  if (command === "spamloop" || command === "mimic" || command === "pare") {
    await interaction.reply(unsupportedNotice);
    return;
  }

  if (command === "oi") {
    await interaction.reply("Oi 👋");
  }
  } catch (err) {
    console.error("Erro na interaction:", err);

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp("O duende tropeçou em algo aqui.");
      } else {
        await interaction.reply("O duende tropeçou em algo aqui.");
      }
    } catch (e) {
      console.error("Erro ao enviar fallback:", e);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
