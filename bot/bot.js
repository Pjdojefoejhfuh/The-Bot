require("dotenv").config();
const {
  Client, GatewayIntentBits, AttachmentBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField,
  ChannelType,
} = require("discord.js");
const fetch = require("node-fetch");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

const PREFIX = ".";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

const CLYDE_PATH =
  process.env.CLYDE_PATH ||
  path.join(__dirname, "..", "src", "clyde", "dist", "index.js");

const EMOJI = {
  yes: "<a:MCE_yes:1549726857090441296>",
  no: "<a:No:1549726859661545492>",
  loading: "<a:loading:1549726853424615424>",
};

// ============================================================
// CONFIG TICKETS (stockée dans un json local)
// ============================================================
const CONFIG_PATH = path.join(__dirname, "ticket-config.json");

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    }
  } catch (e) {
    console.error("[config] load error:", e.message);
  }
  return { categoryId: null, ticketCounter: 0 };
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

// ============================================================
// CHARGEMENT DIRECT DE CLYDE
// ============================================================
let clyde = null;

async function loadClyde() {
  try {
    const url = pathToFileURL(CLYDE_PATH).href;
    clyde = await import(url);
    console.log("[OK] Clyde loaded from", CLYDE_PATH);
    return true;
  } catch (e) {
    console.error("[ERROR] Clyde not loaded:", e.message);
    return false;
  }
}

async function obfuscateSource(source, options = {}) {
  if (!clyde) throw new Error("Obfuscator not loaded");

  const opts = {
    renameLocals: true,
    preserveGlobals: true,
    encodeStrings: options.strings !== false,
    scramble: options.flow !== false,
    oneLine: false,
    vmType: options.vm ? "stack" : "none",
    vmLevel: options.vmLevel || "maximum",
  };

  const { tokens } = clyde.lex(source);
  const ast = clyde.parse(tokens);
  const obfuscated = clyde.obfuscate(ast, opts);

  let output;
  if (opts.vmType !== "none") {
    const bytecode = clyde.compile(obfuscated);
    output = clyde.generateVM(bytecode, { level: opts.vmLevel });
  } else {
    output = clyde.printChunk(obfuscated);
  }

  return output;
}

// ============================================================
// DISCORD CLIENT
// ============================================================
client.once("ready", () => {
  console.log("");
  console.log("  ⚡ SiteObfusque Bot");
  console.log("  ────────────────────");
  console.log(`  🤖 ${client.user.tag}`);
  console.log(`  🧠 Clyde: ${clyde ? "✅" : "❌"}`);
  console.log(`  🐙 GitHub: ${GITHUB_TOKEN ? "✅" : "❌"}`);
  console.log("");
  client.user.setActivity("⚡ .help", { type: 3 });
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  if (command === "obf" || command === "obfuscate") return handleObf(message);
  if (command === "upload") return handleUpload(message);
  if (command === "help" || command === "aide") return handleHelp(message);
  if (command === "purge") return handlePurge(message, args);
  if (command === "setcategoryticket") return handleSetCategory(message, args);
  if (command === "ticketchannel" || command === "tickerchannel")
    return handleTicketPanel(message);
});

// ============================================================
// COMMANDES — HELP
// ============================================================
async function handleHelp(message) {
  const embed = new EmbedBuilder()
    .setTitle(`${EMOJI.yes} SiteObfusque Bot — Commands`)
    .setColor(0x7c3aed)
    .addFields(
      { name: "`.obf`", value: "Obfuscate a `.lua` / `.luau` file (local, VM-based)" },
      { name: "`.upload`", value: "Upload a file to GitHub Gist + loadstring" },
      { name: "`.purge <1-100>`", value: "Delete N messages (Manage Messages required)" },
      { name: "`.setcategoryticket <id>`", value: "Set the category ID for tickets (Manage Server required)" },
      { name: "`.ticketchannel`", value: "Send the ticket panel in this channel (Manage Server required)" },
      { name: "`.help`", value: "Show this message" }
    )
    .setFooter({ text: "SiteObfusque" });
  await message.reply({ embeds: [embed] });
}

// ============================================================
// COMMANDES — OBF
// ============================================================
async function handleObf(message) {
  const attachment = message.attachments.first();
  if (!attachment) {
    return message.reply(`${EMOJI.no} Attach a \`.lua\` / \`.luau\` file.`);
  }

  const filename = attachment.name.toLowerCase();
  if (
    !filename.endsWith(".lua") &&
    !filename.endsWith(".luau") &&
    !filename.endsWith(".txt")
  ) {
    return message.reply(`${EMOJI.no} Supported: \`.lua\`, \`.luau\`, \`.txt\``);
  }

  if (!clyde) {
    return message.reply(`${EMOJI.no} Obfuscator not loaded.`);
  }

  const processing = await message.reply(`${EMOJI.loading} Obfuscating...`);

  try {
    const res = await fetch(attachment.url);
    const source = await res.text();

    if (source.length > 500000) {
      return processing.edit(`${EMOJI.no} File too long (max 500 KB).`);
    }

    const t0 = Date.now();
    const output = await obfuscateSource(source, {
      vm: true,
      strings: true,
      flow: true,
      vmLevel: "maximum",
    });
    const duration = Date.now() - t0;

    const buffer = Buffer.from(output, "utf-8");
    const file = new AttachmentBuilder(buffer, { name: "obfuscated.lua" });

    const embed = new EmbedBuilder()
      .setTitle(`${EMOJI.yes} Obfuscation Successful`)
      .setColor(0x22c55e)
      .addFields(
        { name: "Input", value: `${source.length} chars`, inline: true },
        { name: "Output", value: `${output.length} chars`, inline: true },
        { name: "Ratio", value: `${(output.length / source.length).toFixed(2)}x`, inline: true },
        { name: "Duration", value: `${duration}ms`, inline: true }
      )
      .setFooter({ text: "SiteObfusque — local" });

    await processing.edit({ content: "", embeds: [embed], files: [file] });
  } catch (e) {
    console.error("[.obf error]", e);
    await processing.edit(`${EMOJI.no} Error: ${e.message}`);
  }
}

// ============================================================
// COMMANDES — UPLOAD
// ============================================================
async function handleUpload(message) {
  if (!GITHUB_TOKEN) {
    return message.reply(`${EMOJI.no} \`GITHUB_TOKEN\` not configured.`);
  }

  const attachment = message.attachments.first();
  if (!attachment) {
    return message.reply(`${EMOJI.no} Attach a \`.lua\` file.`);
  }

  const filename = attachment.name.toLowerCase();
  if (
    !filename.endsWith(".lua") &&
    !filename.endsWith(".luau") &&
    !filename.endsWith(".txt")
  ) {
    return message.reply(`${EMOJI.no} Supported: \`.lua\`, \`.luau\`, \`.txt\``);
  }

  const processing = await message.reply(`${EMOJI.loading} Uploading to GitHub...`);

  try {
    const res = await fetch(attachment.url);
    const content = await res.text();

    const gistRes = await fetch("https://api.github.com/gists", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        description: `SiteObfusque — ${attachment.name}`,
        public: false,
        files: { [attachment.name]: { content } },
      }),
    });

    const gist = await gistRes.json();
    if (!gistRes.ok) {
      return processing.edit(`${EMOJI.no} GitHub error: ${gist.message || "unknown"}`);
    }

    const fileKey = Object.keys(gist.files)[0];
    const rawUrl = gist.files[fileKey].raw_url;
    const loadstring = `loadstring(game:HttpGet("${rawUrl}"))()`;

    const embed = new EmbedBuilder()
      .setTitle(`${EMOJI.yes} Upload Successful`)
      .setColor(0x22c55e)
      .addFields(
        { name: "📄 File", value: `\`${attachment.name}\``, inline: false },
        { name: "🔗 Raw URL", value: `\`${rawUrl}\``, inline: false },
        { name: "⚡ Loadstring", value: "```lua\n" + loadstring + "\n```", inline: false }
      )
      .setFooter({ text: "SiteObfusque" });

    await processing.edit({ content: "", embeds: [embed] });
  } catch (e) {
    console.error("[.upload error]", e);
    await processing.edit(`${EMOJI.no} Error: ${e.message}`);
  }
}

// ============================================================
// COMMANDES — PURGE
// ============================================================
async function handlePurge(message, args) {
  if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
    return message.reply(`${EMOJI.no} You need \`Manage Messages\` permission.`);
  }

  const amount = parseInt(args[0], 10);
  if (isNaN(amount) || amount < 1 || amount > 100) {
    return message.reply(`${EMOJI.no} Usage: \`.purge <1-100>\``);
  }

  try {
    const deleted = await message.channel.bulkDelete(amount, true);
    const reply = await message.channel.send(
      `${EMOJI.yes} Deleted **${deleted.size}** message(s).`
    );
    setTimeout(() => reply.delete().catch(() => {}), 4000);
  } catch (e) {
    console.error("[.purge error]", e);
    message.reply(`${EMOJI.no} Error: ${e.message}`);
  }
}

// ============================================================
// COMMANDES — SETCATEGORYTICKET
// ============================================================
async function handleSetCategory(message, args) {
  if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
    return message.reply(`${EMOJI.no} You need \`Manage Server\` permission.`);
  }

  const id = args[0];
  if (!id || !/^\d{17,20}$/.test(id)) {
    return message.reply(
      `${EMOJI.no} Usage: \`.setcategoryticket <category-id>\`\n\n` +
      `💡 How to get the ID:\n` +
      `1. Enable **Developer Mode** (User Settings → Advanced)\n` +
      `2. Right-click the category → **Copy Category ID**\n` +
      `3. Paste it after the command.`
    );
  }

  let category;
  try {
    category = await message.guild.channels.fetch(id);
  } catch {
    return message.reply(`${EMOJI.no} No channel found with ID \`${id}\`.`);
  }

  if (!category || category.type !== ChannelType.GuildCategory) {
    return message.reply(`${EMOJI.no} \`${id}\` is not a category.`);
  }

  const cfg = loadConfig();
  cfg.categoryId = category.id;
  saveConfig(cfg);

  const embed = new EmbedBuilder()
    .setTitle(`${EMOJI.yes} Ticket Category Set`)
    .setColor(0x22c55e)
    .setDescription(`Tickets will now be created in **${category.name}** (\`${category.id}\`).`);

  await message.reply({ embeds: [embed] });
}

// ============================================================
// COMMANDES — TICKET PANEL
// ============================================================
async function handleTicketPanel(message) {
  if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
    return message.reply(`${EMOJI.no} You need \`Manage Server\` permission.`);
  }

  const cfg = loadConfig();
  if (!cfg.categoryId) {
    return message.reply(
      `${EMOJI.no} Set the category first: \`.setcategoryticket <category-id>\``
    );
  }

  const embed = new EmbedBuilder()
    .setTitle("🎫 Support Tickets")
    .setColor(0x7c3aed)
    .setDescription(
      "Need help? Click the button below to open a private ticket.\n\n" +
      "**Our team will assist you as soon as possible.**"
    )
    .setFooter({ text: "SiteObfusque Support" });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("create_ticket")
      .setLabel("Create Ticket")
      .setEmoji("🎫")
      .setStyle(ButtonStyle.Primary)
  );

  await message.channel.send({ embeds: [embed], components: [row] });
}

// ============================================================
// INTERACTION — BOUTON CRÉER TICKET
// ============================================================
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  // ============================
  // CREATE TICKET
  // ============================
  if (interaction.customId === "create_ticket") {
    try {
      await interaction.deferReply({ ephemeral: true });

      const cfg = loadConfig();
      if (!cfg.categoryId) {
        return interaction.editReply(`${EMOJI.no} No ticket category configured.`);
      }

      const guild = interaction.guild;
      const user = interaction.user;

      // Vérifie si l'utilisateur a déjà un ticket ouvert
      const existing = guild.channels.cache.find(
        (c) =>
          c.name === `ticket-${user.username.toLowerCase()}` &&
          c.parentId === cfg.categoryId
      );
      if (existing) {
        return interaction.editReply(
          `${EMOJI.no} You already have an open ticket: <#${existing.id}>`
        );
      }

      cfg.ticketCounter = (cfg.ticketCounter || 0) + 1;
      saveConfig(cfg);

      const channel = await guild.channels.create({
        name: `ticket-${user.username.toLowerCase()}`,
        type: ChannelType.GuildText,
        parent: cfg.categoryId,
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            deny: [PermissionsBitField.Flags.ViewChannel],
          },
          {
            id: user.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ReadMessageHistory,
            ],
          },
          {
            id: client.user.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ManageChannels,
              PermissionsBitField.Flags.ReadMessageHistory,
            ],
          },
        ],
      });

      const ticketEmbed = new EmbedBuilder()
        .setTitle(`🎫 Ticket — ${user.username}`)
        .setColor(0x7c3aed)
        .setDescription(
          `Hello <@${user.id}>, a member of our team will be with you shortly.\n\n` +
          "Please describe your issue in detail."
        )
        .setFooter({ text: "SiteObfusque Support" });

      const closeRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("close_ticket")
          .setLabel("Close Ticket")
          .setEmoji("🔒")
          .setStyle(ButtonStyle.Danger)
      );

      await channel.send({
        content: `<@${user.id}>`,
        embeds: [ticketEmbed],
        components: [closeRow],
      });

      await interaction.editReply(`${EMOJI.yes} Ticket created: <#${channel.id}>`);
    } catch (e) {
      console.error("[ticket error]", e);
      if (interaction.deferred || interaction.replied) {
        interaction.editReply(`${EMOJI.no} Error: ${e.message}`).catch(() => {});
      }
    }
    return;
  }

  // ============================
  // CLOSE TICKET
  // ============================
  if (interaction.customId === "close_ticket") {
    try {
      await interaction.reply(`${EMOJI.loading} Closing ticket in 5 seconds...`);
      setTimeout(() => {
        interaction.channel.delete().catch(() => {});
      }, 5000);
    } catch (e) {
      console.error("[close ticket error]", e);
    }
    return;
  }
});

// ============================================================
// DÉMARRAGE
// ============================================================
(async () => {
  await loadClyde();
  client.login(process.env.DISCORD_TOKEN);
})();