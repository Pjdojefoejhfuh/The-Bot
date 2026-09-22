require("dotenv").config();
const {
  Client, GatewayIntentBits, AttachmentBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField,
  ChannelType, StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} = require("discord.js");
const fetch = require("node-fetch");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { pathToFileURL } = require("url");
const { exec } = require("child_process");

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

// ============================================================
// ⚠️ OWNER CONFIG — ONLY THIS USER CAN USE COMMANDS
// ============================================================
const OWNER_ID = "1474433573174907054"; // ⚠️ REPLACE WITH YOUR DISCORD ID

const AUTHORIZED_DEOBF_ID = OWNER_ID;

const CLYDE_PATH =
  process.env.CLYDE_PATH ||
  path.join(__dirname, "..", "src", "clyde", "dist", "index.js");

const CLYDE_DEOBF_CLI = path.join(__dirname, "ClydeDeobf", "cli.js");

const EMOJI = {
  yes: "<a:MCE_yes:1549726857090441296>",
  no: "<a:No:1549726859661545492>",
  loading: "<a:loading:1549726853424615424>",
};

// ============================================================
// PANEL SYSTEM
// ============================================================
const PANELS = {
  "code sniper": {
    displayName: "🎯 Code Sniper",
    roleId: "1551905830897451119",
    script: 'loadstring(game:HttpGet("https://api.obscuravm.com/scripts/8343230685547954685"))()',
    color: 0x7c3aed,
    description: "The ultimate **Code Sniper** toolkit. Whitelisted members only.",
    emoji: "🎯",
    keywords: ["code", "sniper", "code sniper", "codesniper", "cs", "snip", "snipe", "c sniper"],
  },
  "ap gift": {
    displayName: "🎁 AP Gift",
    roleId: "1551906017187729409",
    script: 'loadstring(game:HttpGet("https://api.obscuravm.com/scripts/4736094501447000867"))()',
    color: 0x22c55e,
    description: "Exclusive **AP Gift** script. Whitelisted members only.",
    emoji: "🎁",
    keywords: ["ap", "gift", "ap gift", "apgift", "gifts", "a p gift"],
  },
  "nova visual": {
    displayName: "👁️ Nova Visual",
    roleId: "1551906110590558309",
    script: 'loadstring(game:HttpGet("https://api.obscuravm.com/scripts/9138196775171921051"))()',
    color: 0xf59e0b,
    description: "Next-level **Nova Visual** experience. Whitelisted members only.",
    emoji: "👁️",
    keywords: ["nova", "visual", "nova visual", "novavisual", "nv", "vis", "nov", "visuals"],
  },
};

// ============================================================
// FUZZY MATCHING
// ============================================================
function levenshtein(a, b) {
  a = a.toLowerCase();
  b = b.toLowerCase();
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

function similarityScore(input, keyword) {
  input = input.toLowerCase().trim();
  keyword = keyword.toLowerCase().trim();

  if (input === keyword) return 0;
  if (input.includes(keyword)) return 1;
  if (keyword.includes(input)) return 2;

  const dist = levenshtein(input, keyword);
  const maxLen = Math.max(input.length, keyword.length);
  const ratio = dist / maxLen;
  if (ratio <= 0.4) return 10 + dist;

  return Infinity;
}

function resolvePanel(input) {
  if (!input) return null;
  const cleaned = input.toLowerCase().trim().replace(/\s+/g, " ");

  if (PANELS[cleaned]) return cleaned;

  let best = null;
  let bestScore = Infinity;

  for (const [panelKey, panel] of Object.entries(PANELS)) {
    const candidates = [panelKey, panel.displayName.toLowerCase(), ...panel.keywords];

    for (const candidate of candidates) {
      const score = similarityScore(cleaned, candidate);
      if (score < bestScore) {
        bestScore = score;
        best = panelKey;
      }
    }
  }

  if (best && bestScore < Infinity) return best;
  return null;
}

// ============================================================
// ROLE NAME HELPER
// ============================================================
async function getRoleName(guild, roleId) {
  try {
    const role = guild.roles.cache.get(roleId) || (await guild.roles.fetch(roleId));
    if (role) return `@${role.name}`;
  } catch {}
  return "@Unknown Role";
}

// ============================================================
// CONFIG
// ============================================================
const CONFIG_PATH = path.join(__dirname, "bot-config.json");

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
      return {
        categoryId: cfg.categoryId || null,
        ticketCounter: cfg.ticketCounter || 0,
        obfChannels: cfg.obfChannels || [],
        guildConfigs: cfg.guildConfigs || {},
      };
    }
  } catch (e) {
    console.error("[config] load error:", e.message);
  }
  return { categoryId: null, ticketCounter: 0, obfChannels: [], guildConfigs: {} };
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

function getGuildConfig(guildId) {
  const cfg = loadConfig();
  if (!cfg.guildConfigs) cfg.guildConfigs = {};
  if (!cfg.guildConfigs[guildId]) {
    cfg.guildConfigs[guildId] = {
      categoryId: cfg.categoryId || null,
      obfChannels: cfg.obfChannels || [],
      ticketCounter: 0,
    };
    saveConfig(cfg);
  }
  return cfg.guildConfigs[guildId];
}

function saveGuildConfig(guildId, guildCfg) {
  const cfg = loadConfig();
  if (!cfg.guildConfigs) cfg.guildConfigs = {};
  cfg.guildConfigs[guildId] = guildCfg;
  saveConfig(cfg);
}

// ============================================================
// CLYDE LOADER
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

function runClydeDeobf(inputCode) {
  return new Promise((resolve, reject) => {
    const tempInput = path.join(__dirname, "temp_deobf_input.lua");
    const tempOutput = path.join(__dirname, "temp_deobf_output.lua");

    fs.writeFileSync(tempInput, inputCode, "utf-8");

    const cmd = `node "${CLYDE_DEOBF_CLI}" "${tempInput}" -o "${tempOutput}"`;

    exec(cmd, { timeout: 120000 }, (error, stdout, stderr) => {
      if (fs.existsSync(tempInput)) fs.unlinkSync(tempInput);

      if (error) {
        if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput);
        return reject(new Error(stderr || error.message));
      }

      if (!fs.existsSync(tempOutput)) {
        return reject(new Error("ClydeDeobf produced no output file."));
      }

      const result = fs.readFileSync(tempOutput, "utf-8");
      fs.unlinkSync(tempOutput);
      resolve(result);
    });
  });
}

async function createGist(description, filename, content, isPublic = true) {
  const res = await fetch("https://api.github.com/gists", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      description,
      public: isPublic,
      files: { [filename]: { content } },
    }),
  });

  const gist = await res.json();
  if (!res.ok) {
    throw new Error(gist.message || "GitHub Gist error");
  }

  const fileKey = Object.keys(gist.files)[0];
  return {
    id: gist.id,
    htmlUrl: gist.html_url,
    rawUrl: gist.files[fileKey].raw_url,
  };
}

// ============================================================
// READY
// ============================================================
client.once("ready", () => {
  console.log("");
  console.log("  ⚡ SiteObfusque Bot");
  console.log("  ────────────────────");
  console.log(`  🤖 ${client.user.tag}`);
  console.log(`  👑 Owner: ${OWNER_ID}`);
  console.log(`  🧠 Clyde: ${clyde ? "✅" : "❌"}`);
  console.log(`  🔓 ClydeDeobf: ${fs.existsSync(CLYDE_DEOBF_CLI) ? "✅" : "❌"}`);
  console.log(`  🐙 GitHub: ${GITHUB_TOKEN ? "✅" : "❌"}`);
  console.log(`  🎯 Panels: ${Object.keys(PANELS).length}`);
  console.log(`  🌐 Guilds: ${client.guilds.cache.size}`);
  console.log("");
  client.user.setActivity("⚡ owner-only", { type: 3 });
});

// ============================================================
// ROUTER — OWNER ONLY
// ============================================================
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;
  if (!message.content.startsWith(PREFIX)) return;

  // 🚫 OWNER-ONLY GATE
  if (message.author.id !== OWNER_ID) {
    return;
  }

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  if (command === "obf" || command === "obfuscate") return handleObf(message);
  if (command === "deobf") return handleDeobf(message);
  if (command === "loader") return handleLoader(message, args);
  if (command === "upload") return handleUpload(message);
  if (command === "fetch" || command === "raw" || command === "get") {
    const fullArg = message.content.slice(PREFIX.length + command.length).trim();
    return handleFetch(message, fullArg);
  }
  if (command === "panel") {
    const fullArg = message.content.slice(PREFIX.length + command.length).trim();
    return handlePanel(message, fullArg);
  }
  if (command === "realpanel" || command === "rp" || command === "adminpanel") {
    return handleRealPanel(message);
  }
  if (command === "w" || command === "whitelist") return handleWhitelist(message, args);
  if (command === "help" || command === "aide") return handleHelp(message);
  if (command === "tuto" || command === "tutorial") return handleTuto(message);
  if (command === "purge") return handlePurge(message, args);
  if (command === "setcategoryticket") return handleSetCategory(message, args);
  if (command === "setobfchannels") return handleSetObfChannels(message, args);
  if (command === "ticketchannel" || command === "tickerchannel")
    return handleTicketPanel(message);
});

// ============================================================
// HELP
// ============================================================
async function handleHelp(message) {
  const embed = new EmbedBuilder()
    .setTitle(`${EMOJI.yes} SiteObfusque Bot — Commands (Owner Only)`)
    .setColor(0x7c3aed)
    .addFields(
      { name: "`.obf`", value: "Obfuscate a `.lua` / `.luau` file" },
      { name: "`.deobf`", value: "Deobfuscate a Clyde-obfuscated script." },
      { name: "`.loader [\"<key>\"]`", value: "Create a protected loader." },
      { name: "`.upload`", value: "Upload a file to GitHub Gist + loadstring" },
      { name: "`.fetch <url|loadstring>`", value: "Fetch a raw URL or extract URL from a loadstring" },
      { name: "`.panel <code sniper|ap gift|nova visual>`", value: "Show the whitelist panel (fuzzy matching)" },
      { name: "`.realpanel`", value: "Open the admin control panel" },
      { name: "`.w @user|id <sniper|AP|visual>`", value: "Give a whitelist role to a member" },
      { name: "`.tuto`", value: "Show the tutorial panel" },
      { name: "`.purge <1-100>`", value: "Delete N messages" },
      { name: "`.setcategoryticket <id>`", value: "Set the category ID for tickets" },
      { name: "`.setobfchannels <id1> <id2>`", value: "Set the channels where `.obf` is allowed" },
      { name: "`.ticketchannel`", value: "Send the ticket panel in this channel" },
      { name: "`.help`", value: "Show this message" }
    )
    .setFooter({ text: "SiteObfusque — Owner Only" });
  await message.reply({ embeds: [embed] });
}

// ============================================================
// TUTORIAL PANEL
// ============================================================
async function handleTuto(message) {
  const embed = new EmbedBuilder()
    .setTitle("📖 SiteObfusque — Tutorial")
    .setColor(0x7c3aed)
    .setDescription("Welcome! Here's everything you need to know to use the bot.")
    .addFields(
      { name: "1️⃣  Get your script ready", value: "Save your Lua/Luau script as a `.lua`, `.luau`, or `.txt` file." },
      { name: "2️⃣  Obfuscate it", value: "Go to an authorized channel and send:\n```\n.obf\n```\n**with your file attached.**" },
      { name: "3️⃣  Deobfuscate a script", value: "Send:\n```\n.deobf\n```\nwith the file attached." },
      { name: "4️⃣  Create a protected loader", value: "Send:\n```\n.loader \"your-key\"\n```\nor just `\`.loader\`` (auto-generated key). Attach your file." },
      { name: "5️⃣  Upload it (optional)", value: "Send:\n```\n.upload\n```\nwith the file attached to get a loadstring." },
      { name: "6️⃣  Fetch a raw script", value: "Send:\n```\n.fetch https://raw.githubusercontent.com/...\n```\nor paste a loadstring." },
      { name: "7️⃣  Open a panel", value: "Send:\n```\n.panel code sniper\n.panel ap gift\n.panel nova visual\n```\n**Fuzzy matching supported**." },
      { name: "⚠️  Note", value: "All commands are **owner-only**." }
    )
    .setFooter({ text: "SiteObfusque" })
    .setTimestamp();

  await message.channel.send({ embeds: [embed] });
}

// ============================================================
// REAL PANEL
// ============================================================
async function handleRealPanel(message) {
  const guildCfg = getGuildConfig(message.guild.id);

  const embed = new EmbedBuilder()
    .setTitle("🛠️ SiteObfusque — Admin Control Panel")
    .setColor(0x7c3aed)
    .setDescription(
      "Welcome to the **admin control panel**.\n" +
      "Use the buttons below to manage the bot on this server."
    )
    .addFields(
      {
        name: "📊 Bot Stats",
        value:
          `**Guilds:** ${client.guilds.cache.size}\n` +
          `**Users:** ${client.users.cache.size}\n` +
          `**Ping:** ${client.ws.ping}ms\n` +
          `**Uptime:** ${formatUptime(client.uptime)}`,
        inline: true,
      },
      {
        name: "🌐 Server Info",
        value:
          `**Name:** ${message.guild.name}\n` +
          `**ID:** \`${message.guild.id}\`\n` +
          `**Members:** ${message.guild.memberCount}\n` +
          `**Owner:** <@${message.guild.ownerId}>`,
        inline: true,
      },
      {
        name: "⚙️ Current Config",
        value:
          `**Ticket Category:** ${guildCfg.categoryId ? `<#${guildCfg.categoryId}>` : "*not set*"}\n` +
          `**Obf Channels:** ${guildCfg.obfChannels && guildCfg.obfChannels.length ? guildCfg.obfChannels.map((id) => `<#${id}>`).join(", ") : "*not set*"}\n` +
          `**Tickets Created:** ${guildCfg.ticketCounter || 0}`,
        inline: false,
      }
    )
    .setThumbnail(client.user.displayAvatarURL())
    .setFooter({ text: "SiteObfusque — Admin Panel" })
    .setTimestamp();

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("rp_refresh")
      .setLabel("Refresh")
      .setEmoji("🔄")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("rp_ticket_help")
      .setLabel("Ticket Category")
      .setEmoji("🎫")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("rp_obf_help")
      .setLabel("Obf Channels")
      .setEmoji("🧠")
      .setStyle(ButtonStyle.Primary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("rp_guilds")
      .setLabel("Manage Guilds")
      .setEmoji("🌐")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("rp_reload")
      .setLabel("Reload Clyde")
      .setEmoji("🧠")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("rp_shutdown")
      .setLabel("Shutdown Bot")
      .setEmoji("🛑")
      .setStyle(ButtonStyle.Danger)
  );

  await message.reply({ embeds: [embed], components: [row1, row2] });
}

// ============================================================
// HELPERS
// ============================================================
function formatUptime(ms) {
  if (!ms) return "unknown";
  const sec = Math.floor(ms / 1000);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}

// ============================================================
// PANEL
// ============================================================
async function handlePanel(message, input) {
  const raw = (input || "").trim().toLowerCase();

  if (!raw) {
    return message.reply(
      `${EMOJI.no} Usage: \`.panel <code sniper | ap gift | nova visual>\`\n\n` +
      `**Fuzzy matching supported** — you can also try:\n` +
      `• \`.panel sniper\` / \`.panel cs\` / \`.panel code\`\n` +
      `• \`.panel ap\` / \`.panel gift\`\n` +
      `• \`.panel nova\` / \`.panel visual\` / \`.panel vis\``
    );
  }

  const panelKey = resolvePanel(raw);

  if (!panelKey || !PANELS[panelKey]) {
    return message.reply(
      `${EMOJI.no} Unknown panel: \`${input}\`\n` +
      `Use: \`.panel code sniper\`, \`.panel ap gift\` or \`.panel nova visual\``
    );
  }

  const panel = PANELS[panelKey];
  const member = message.member;

  const hasRole = member.roles.cache.has(panel.roleId);
  const roleName = await getRoleName(message.guild, panel.roleId);

  const embed = new EmbedBuilder()
    .setTitle(`${panel.emoji} ${panel.displayName} — Panel`)
    .setColor(panel.color)
    .setDescription(
      panel.description +
      "\n\n" +
      (hasRole
        ? "✅ You are **whitelisted**. Click the button below to receive your script in DM."
        : `🔒 You need to be whitelisted or have the **${roleName}** role to unlock this script.`)
    )
    .addFields(
      { name: "🔐 Required Role", value: `**${roleName}**`, inline: true },
      { name: "📬 Delivery", value: "DM (private message)", inline: true }
    )
    .setFooter({ text: "SiteObfusque — Panel" })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`panel_get_${panelKey.replace(/\s+/g, "_")}`)
      .setLabel("Get Script")
      .setEmoji("📥")
      .setStyle(ButtonStyle.Success)
  );

  await message.channel.send({ embeds: [embed], components: [row] });
}

// ============================================================
// WHITELIST
// ============================================================
async function handleWhitelist(message, args) {
  if (args.length < 2) {
    return message.reply(
      `${EMOJI.no} Usage: \`.w @user|userID <sniper|AP|visual>\`\n\n` +
      `Examples:\n` +
      `• \`.w @John sniper\`\n` +
      `• \`.w 123456789012345678 visual\`\n` +
      `• \`.w @John AP\``
    );
  }

  const targetArg = args[0];
  const roleArg = args.slice(1).join(" ").toLowerCase();

  let targetId = null;
  const mentionMatch = targetArg.match(/^<@!?(\d{17,20})>$/);
  if (mentionMatch) {
    targetId = mentionMatch[1];
  } else if (/^\d{17,20}$/.test(targetArg)) {
    targetId = targetArg;
  }

  if (!targetId) {
    return message.reply(`${EMOJI.no} Mention a user or provide their ID.`);
  }

  const panelKey = resolvePanel(roleArg);

  if (!panelKey || !PANELS[panelKey]) {
    return message.reply(
      `${EMOJI.no} Unknown role: \`${roleArg}\`\n` +
      `Use: \`sniper\`, \`AP\` or \`visual\` (fuzzy matching supported).`
    );
  }

  const panel = PANELS[panelKey];

  let target;
  try {
    target = await message.guild.members.fetch(targetId);
  } catch {
    return message.reply(`${EMOJI.no} User not found on this server.`);
  }

  if (!target) {
    return message.reply(`${EMOJI.no} User not found.`);
  }

  let role;
  try {
    role = await message.guild.roles.fetch(panel.roleId);
  } catch {
    return message.reply(`${EMOJI.no} The role \`${panel.roleId}\` does not exist on this server.`);
  }

  if (!role) {
    return message.reply(`${EMOJI.no} The role \`${panel.roleId}\` could not be found.`);
  }

  const botMember = message.guild.members.me;
  if (role.position >= botMember.roles.highest.position) {
    return message.reply(
      `${EMOJI.no} I can't assign this role (it's above my highest role in the hierarchy).`
    );
  }

  const roleName = `@${role.name}`;

  try {
    if (target.roles.cache.has(panel.roleId)) {
      const embed = new EmbedBuilder()
        .setTitle(`${EMOJI.yes} Already Whitelisted`)
        .setColor(0xf59e0b)
        .setDescription(
          `<@${target.id}> already has the **${roleName}** role (**${panel.displayName}**).`
        );
      return message.reply({ embeds: [embed] });
    }

    await target.roles.add(role);

    const embed = new EmbedBuilder()
      .setTitle(`${EMOJI.yes} Whitelist Successful`)
      .setColor(0x22c55e)
      .setDescription(
        `<@${target.id}> has received the **${roleName}** role (**${panel.displayName}**).`
      )
      .addFields(
        { name: "👤 Member", value: `<@${target.id}> (\`${target.id}\`)`, inline: true },
        { name: "🎭 Role", value: `**${roleName}**`, inline: true },
        { name: "🛡️ By", value: `<@${message.author.id}>`, inline: true }
      )
      .setFooter({ text: "SiteObfusque — Whitelist" })
      .setTimestamp();

    await message.reply({ embeds: [embed] });

    target.send(
      `${panel.emoji} You have been whitelisted for **${panel.displayName}**!\n` +
      `Use \`.panel ${panelKey}\` in the server to get your script.`
    ).catch(() => {});
  } catch (e) {
    console.error("[.w error]", e);
    message.reply(`${EMOJI.no} Error while adding the role: ${e.message}`);
  }
}

// ============================================================
// FETCH
// ============================================================
async function handleFetch(message, input) {
  input = (input || "").trim();

  if (!input) {
    const urlInMessage = message.content.match(/https?:\/\/[^\s"'`)\]]+/i);
    if (urlInMessage) input = urlInMessage[0];
  }

  if (!input) {
    return message.reply(
      `${EMOJI.no} Usage:\n` +
      "```\n" +
      ".fetch https://raw.githubusercontent.com/user/repo/main/file.lua\n" +
      '.fetch loadstring(game:HttpGet("https://raw.githubusercontent.com/..."))()\n' +
      "```"
    );
  }

  let url = null;

  const httpGetMatch = input.match(/HttpGet\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/i);
  if (httpGetMatch) url = httpGetMatch[1];

  if (!url) {
    const anyUrl = input.match(/https?:\/\/[^\s"'`)\]]+/i);
    if (anyUrl) url = anyUrl[0];
  }

  if (!url) {
    const clean = input.replace(/["'`]/g, "").trim();
    if (/^https?:\/\/.+/i.test(clean)) url = clean;
  }

  if (!url) {
    return message.reply(`${EMOJI.no} No valid URL found in your message.`);
  }

  url = url.replace(/[)\].,;:!?]+$/g, "").trim();

  if (!/^https?:\/\//i.test(url)) {
    return message.reply(`${EMOJI.no} The URL must start with \`http://\` or \`https://\`.`);
  }

  const processing = await message.reply(`${EMOJI.loading} Fetching...`);

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "SiteObfusque-Bot/1.0" },
    });

    if (!res.ok) {
      return processing.edit(
        `${EMOJI.no} HTTP Error **${res.status}** — \`${res.statusText}\`\nURL: \`${url}\``
      );
    }

    const content = await res.text();

    if (!content || content.length === 0) {
      return processing.edit(`${EMOJI.no} The file is empty.`);
    }

    const lower = url.toLowerCase();
    let lang = "";
    if (lower.endsWith(".lua") || lower.endsWith(".luau")) lang = "lua";
    else if (lower.endsWith(".js")) lang = "javascript";
    else if (lower.endsWith(".json")) lang = "json";
    else if (lower.endsWith(".py")) lang = "python";
    else if (lower.endsWith(".ts")) lang = "typescript";
    else if (lower.endsWith(".html")) lang = "html";
    else if (lower.endsWith(".css")) lang = "css";
    else if (lower.endsWith(".txt")) lang = "";

    const MAX_EMBED = 3900;

    if (content.length > MAX_EMBED) {
      const buffer = Buffer.from(content, "utf-8");

      let ext = "txt";
      if (lang === "lua") ext = "lua";
      else if (lang === "javascript") ext = "js";
      else if (lang === "json") ext = "json";
      else if (lang === "python") ext = "py";

      const file = new AttachmentBuilder(buffer, { name: `fetched.${ext}` });

      const embed = new EmbedBuilder()
        .setTitle(`${EMOJI.yes} Content Retrieved`)
        .setColor(0x22c55e)
        .setDescription(
          `📄 **${content.length} characters** — too long to display here.\n` +
          `🔗 [Source link](${url})`
        )
        .addFields({
          name: "🔗 Extracted URL",
          value: `\`${url.length > 200 ? url.slice(0, 197) + "..." : url}\``,
          inline: false,
        })
        .setFooter({ text: "SiteObfusque — fetch" });

      const preview = content.slice(0, 500).replace(/```/g, "``\u200b`");
      embed.addFields({
        name: "👁️ Preview",
        value:
          "```" + (lang || "") + "\n" + preview +
          (content.length > 500 ? "\n..." : "") + "\n```",
        inline: false,
      });

      return processing.edit({ content: "", embeds: [embed], files: [file] });
    }

    const safeContent = content.replace(/```/g, "``\u200b`");

    const embed = new EmbedBuilder()
      .setTitle(`${EMOJI.yes} Content Retrieved`)
      .setColor(0x22c55e)
      .setDescription("```" + (lang || "") + "\n" + safeContent + "\n```")
      .addFields(
        {
          name: "🔗 Extracted URL",
          value: `\`${url.length > 200 ? url.slice(0, 197) + "..." : url}\``,
          inline: false,
        },
        { name: "📏 Size", value: `${content.length} characters`, inline: true },
        { name: "🌐 Status", value: `HTTP ${res.status}`, inline: true }
      )
      .setFooter({ text: "SiteObfusque — fetch" });

    await processing.edit({ content: "", embeds: [embed] });
  } catch (e) {
    console.error("[.fetch error]", e);
    await processing.edit(`${EMOJI.no} Error: ${e.message}`);
  }
}

// ============================================================
// OBF
// ============================================================
async function handleObf(message) {
  const cfg = loadConfig();
  const guildCfg = getGuildConfig(message.guild.id);
  const obfChannels = guildCfg.obfChannels && guildCfg.obfChannels.length ? guildCfg.obfChannels : cfg.obfChannels;

  if (!obfChannels.includes(message.channel.id)) {
    const allowed = obfChannels.length
      ? obfChannels.map((id) => `<#${id}>`).join(", ")
      : "*none configured yet*";
    return message.reply(
      `${EMOJI.no} \`.obf\` is not allowed in this channel.\nAuthorized: ${allowed}`
    );
  }

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
// DEOBF
// ============================================================
async function handleDeobf(message) {
  if (!fs.existsSync(CLYDE_DEOBF_CLI)) {
    return message.reply(`${EMOJI.no} ClydeDeobf is not installed.`);
  }

  const attachment = message.attachments.first();
  if (!attachment) {
    return message.reply(`${EMOJI.no} Attach a \`.lua\` file to deobfuscate.`);
  }

  const filename = attachment.name.toLowerCase();
  if (!filename.endsWith(".lua") && !filename.endsWith(".luau") && !filename.endsWith(".txt")) {
    return message.reply(`${EMOJI.no} Supported: \`.lua\`, \`.luau\`, \`.txt\``);
  }

  const processing = await message.reply(`${EMOJI.loading} Deobfuscating... (this may take a moment)`);

  try {
    const res = await fetch(attachment.url);
    const source = await res.text();

    if (source.length > 500000) {
      return processing.edit(`${EMOJI.no} File too long (max 500 KB).`);
    }

    const t0 = Date.now();
    const output = await runClydeDeobf(source);
    const duration = Date.now() - t0;

    const buffer = Buffer.from(output, "utf-8");
    const file = new AttachmentBuilder(buffer, { name: "deobfuscated.lua" });

    const embed = new EmbedBuilder()
      .setTitle(`${EMOJI.yes} Deobfuscation Complete`)
      .setColor(0x22c55e)
      .addFields(
        { name: "Input", value: `${source.length} chars`, inline: true },
        { name: "Output", value: `${output.length} chars`, inline: true },
        { name: "Duration", value: `${duration}ms`, inline: true }
      )
      .setFooter({ text: "SiteObfusque — ClydeDeobf" });

    await processing.edit({ content: "", embeds: [embed], files: [file] });
  } catch (e) {
    console.error("[.deobf error]", e);
    await processing.edit(`${EMOJI.no} Error: ${e.message}`);
  }
}

// ============================================================
// LOADER
// ============================================================
async function handleLoader(message, args) {
  if (!GITHUB_TOKEN) {
    return message.reply(`${EMOJI.no} \`GITHUB_TOKEN\` not configured.`);
  }

  const raw = args.join(" ").trim();
  let key = null;
  let keyWasGenerated = false;

  if (raw.length > 0) {
    const keyMatch = raw.match(/^["'`](.+?)["'`]/);
    if (keyMatch) key = keyMatch[1];
    else key = raw;
  }

  if (!key) {
    key = crypto.randomBytes(8).toString("hex");
    keyWasGenerated = true;
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

  if (!clyde) {
    return message.reply(`${EMOJI.no} Obfuscator not loaded.`);
  }

  const processing = await message.reply(`${EMOJI.loading} Creating loader...`);

  try {
    const res = await fetch(attachment.url);
    const source = await res.text();

    if (source.length > 500000) {
      return processing.edit(`${EMOJI.no} File too long (max 500 KB).`);
    }

    const obfuscated = await obfuscateSource(source, {
      vm: true,
      strings: true,
      flow: true,
      vmLevel: "maximum",
    });

    const payloadFilename = crypto.randomBytes(6).toString("hex") + ".lua";
    const payloadGist = await createGist(
      "SiteObfusque payload",
      payloadFilename,
      obfuscated,
      true
    );

    const djb2 = (str) => {
      let h = 5381;
      for (let i = 0; i < str.length; i++) {
        h = ((h * 33) + str.charCodeAt(i)) >>> 0;
      }
      return h;
    };
    const keyHash = djb2(key);

    const encodedUrl = Buffer.from(payloadGist.rawUrl, "utf-8").toString("base64");

    const loader = buildLoaderTemplate({ keyHash, encodedUrl });

    const loaderGist = await createGist(
      "SiteObfusque loader",
      "loader.lua",
      loader,
      true
    );

    const loaderBuffer = Buffer.from(loader, "utf-8");
    const loaderFile = new AttachmentBuilder(loaderBuffer, { name: "loader.lua" });

    const loadstring = `loadstring(game:HttpGet("${loaderGist.rawUrl}"))()`;

    const descriptionParts = [
      "**Open-source loader with built-in key system** ✅",
      "• If `getgenv().SiteObfusque_Key` is already valid → **direct load**",
      "• Otherwise → **key input UI** appears",
      "",
      "**Loadstring:**",
      "```lua\n" + loadstring + "\n```",
    ];

    const embed = new EmbedBuilder()
      .setTitle(`${EMOJI.yes} Loader Created`)
      .setColor(0x22c55e)
      .setDescription(descriptionParts.join("\n"))
      .addFields(
        { name: "📦 Payload", value: `${obfuscated.length} chars`, inline: true },
        { name: "🧠 Obfuscation", value: "VM + strings + flow", inline: true },
        { name: "🌐 Loader (raw)", value: `\`${loaderGist.rawUrl}\``, inline: false }
      )
      .setFooter({ text: "SiteObfusque — Loader" });

    if (keyWasGenerated) {
      embed.addFields({
        name: "🔑 Auto-generated Key",
        value: "```\n" + key + "\n```\n⚠️ Save it now, it will **never** be shown again.",
        inline: false,
      });
    } else {
      embed.addFields({
        name: "🔑 Key",
        value: "```\n" + key + "\n```",
        inline: false,
      });
    }

    embed.addFields({
      name: "🔐 Hash (djb2)",
      value: `\`${keyHash}\``,
      inline: true,
    });

    await processing.edit({
      content: "",
      embeds: [embed],
      files: [loaderFile],
    });
  } catch (e) {
    console.error("[.loader error]", e);
    await processing.edit(`${EMOJI.no} Error: ${e.message}`);
  }
}

// ============================================================
// LOADER TEMPLATE
// ============================================================
function buildLoaderTemplate({ keyHash, encodedUrl }) {
  return `--[[
    SiteObfusque Loader (open source)
    ──────────────────────────────────
    • The key is NOT stored in plaintext (only its djb2 hash)
    • The source is NOT in this file (remote payload)
    • If getgenv().SiteObfusque_Key is valid → direct load
    • Otherwise → key input UI
]]

local KEY_HASH = ${keyHash}
local ENC_URL  = "${encodedUrl}"

local function b64d(data)
    local b = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    data = string.gsub(data, '[^'..b..'=]', '')
    return (data:gsub('.', function(x)
        if (x == '=') then return '' end
        local r, f = '', (b:find(x) - 1)
        for i = 6, 1, -1 do
            r = r .. (f % 2^i - f % 2^(i-1) > 0 and '1' or '0')
        end
        return r
    end):gsub('%d%d%d?%d?%d?%d?%d?%d?', function(x)
        if (#x ~= 8) then return '' end
        local c = 0
        for i = 1, 8 do
            c = c + (x:sub(i,i) == '1' and 2^(8-i) or 0)
        end
        return string.char(c)
    end))
end

local function djb2(s)
    local h = 5381
    for i = 1, #s do
        h = (h * 33 + s:byte(i)) % 4294967296
    end
    return h
end

local function LoadPayload()
    local url = b64d(ENC_URL)
    local ok, src = pcall(function() return game:HttpGet(url) end)
    if not ok or type(src) ~= "string" or #src == 0 then
        warn("[SiteObfusque] Failed to fetch payload.")
        return false
    end
    local fn, err = loadstring(src)
    if not fn then
        warn("[SiteObfusque] Failed to compile payload: " .. tostring(err))
        return false
    end
    local ok2, err2 = pcall(fn)
    if not ok2 then
        warn("[SiteObfusque] Error in payload: " .. tostring(err2))
        return false
    end
    return true
end

local storedKey = nil
if getgenv then storedKey = getgenv().SiteObfusque_Key end

if storedKey and storedKey ~= "" and djb2(storedKey) == KEY_HASH then
    LoadPayload()
    return
end

local Services = {
    Players = game:GetService("Players"),
    TweenService = game:GetService("TweenService"),
    UserInputService = game:GetService("UserInputService"),
    RunService = game:GetService("RunService")
}

local Player = Services.Players.LocalPlayer
local PlayerGui = Player:WaitForChild("PlayerGui")

local Config = { MaxKeyLength = 50, AnimationSpeed = 0.4, ParticleCount = 60, ParticleSpeed = 60 }

local Colors = {
    Background = Color3.fromRGB(18, 18, 22),
    Surface = Color3.fromRGB(25, 25, 30),
    Primary = Color3.fromRGB(45, 45, 50),
    Secondary = Color3.fromRGB(35, 35, 40),
    Border = Color3.fromRGB(40, 40, 45),
    TextPrimary = Color3.fromRGB(220, 220, 225),
    TextSecondary = Color3.fromRGB(140, 140, 150),
    Success = Color3.fromRGB(25, 135, 84),
    Error = Color3.fromRGB(180, 50, 50),
    Warning = Color3.fromRGB(200, 120, 30),
    HoverPrimary = Color3.fromRGB(55, 55, 60),
    NeonWhite = Color3.fromRGB(255, 255, 255),
    NeonGlow = Color3.fromRGB(240, 248, 255)
}

local State = {
    IsLoading = false, Particles = {}, Animations = {}, IsDestroyed = false,
    MousePosition = {X = 0, Y = 0},
    FocusStates = { InputFocused = false, ButtonHovered = {}, AnimationsActive = true }
}

local UI = {}

local function CreateMainGUI()
    local screenGui = Instance.new("ScreenGui")
    screenGui.Name = "KeySystemGUI"
    screenGui.ResetOnSpawn = false
    screenGui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
    screenGui.IgnoreGuiInset = true
    screenGui.DisplayOrder = 100
    screenGui.Parent = PlayerGui
    UI.ScreenGui = screenGui
    return screenGui
end

local function CreateBackdrop(parent)
    local backdrop = Instance.new("Frame")
    backdrop.Name = "Backdrop"
    backdrop.Size = UDim2.new(1, 0, 1, 0)
    backdrop.BackgroundColor3 = Color3.fromRGB(0, 0, 0)
    backdrop.BackgroundTransparency = 0.1
    backdrop.BorderSizePixel = 0
    backdrop.ZIndex = 100
    backdrop.Parent = parent
    UI.Backdrop = backdrop
    return backdrop
end

local function CreateContainer(parent)
    local container = Instance.new("Frame")
    container.Name = "MainContainer"
    container.Size = UDim2.new(0, 420, 0, 500)
    container.Position = UDim2.new(0.5, -210, 0.5, -250)
    container.BackgroundColor3 = Colors.Background
    container.BorderSizePixel = 0
    container.ZIndex = 110
    container.Selectable = false
    container.Parent = parent
    local corner = Instance.new("UICorner")
    corner.CornerRadius = UDim.new(0, 20)
    corner.Parent = container
    local stroke = Instance.new("UIStroke")
    stroke.Color = Colors.Border
    stroke.Thickness = 1
    stroke.Transparency = 0.3
    stroke.Parent = container
    UI.Container = container
    return container
end

local function CreateAnimatedBorder(parent)
    local border = Instance.new("Frame")
    border.Name = "AnimatedBorder"
    border.Size = UDim2.new(1, 6, 1, 6)
    border.Position = UDim2.new(0, -3, 0, -3)
    border.BackgroundTransparency = 1
    border.ZIndex = 109
    border.Selectable = false
    border.Parent = parent
    local corner = Instance.new("UICorner")
    corner.CornerRadius = UDim.new(0, 23)
    corner.Parent = border
    local stroke = Instance.new("UIStroke")
    stroke.Color = Colors.NeonWhite
    stroke.Thickness = 2
    stroke.Transparency = 0.3
    stroke.Parent = border
    local gradient = Instance.new("UIGradient")
    gradient.Color = ColorSequence.new{
        ColorSequenceKeypoint.new(0, Colors.NeonWhite),
        ColorSequenceKeypoint.new(0.5, Colors.NeonGlow),
        ColorSequenceKeypoint.new(1, Colors.NeonWhite)
    }
    gradient.Transparency = NumberSequence.new{
        NumberSequenceKeypoint.new(0, 0.9),
        NumberSequenceKeypoint.new(0.2, 0.1),
        NumberSequenceKeypoint.new(0.8, 0.1),
        NumberSequenceKeypoint.new(1, 0.9)
    }
    gradient.Parent = stroke
    UI.AnimatedBorder = {Frame = border, Gradient = gradient, Stroke = stroke}
    return border
end

local function CreateHeader(parent)
    local header = Instance.new("Frame")
    header.Name = "Header"
    header.Size = UDim2.new(1, 0, 0, 100)
    header.BackgroundTransparency = 1
    header.ZIndex = 11
    header.Selectable = false
    header.Parent = parent
    local iconContainer = Instance.new("Frame")
    iconContainer.Size = UDim2.new(0, 56, 0, 56)
    iconContainer.Position = UDim2.new(0.5, -28, 0, 24)
    iconContainer.BackgroundColor3 = Colors.Primary
    iconContainer.BorderSizePixel = 0
    iconContainer.ZIndex = 12
    iconContainer.Selectable = false
    iconContainer.Parent = header
    local iconCorner = Instance.new("UICorner")
    iconCorner.CornerRadius = UDim.new(0, 14)
    iconCorner.Parent = iconContainer
    local iconGlow = Instance.new("Frame")
    iconGlow.Size = UDim2.new(1, 12, 1, 12)
    iconGlow.Position = UDim2.new(0, -6, 0, -6)
    iconGlow.BackgroundTransparency = 1
    iconGlow.ZIndex = 11
    iconGlow.Selectable = false
    iconGlow.Parent = iconContainer
    local glowCorner = Instance.new("UICorner")
    glowCorner.CornerRadius = UDim.new(0, 20)
    glowCorner.Parent = iconGlow
    local glowStroke = Instance.new("UIStroke")
    glowStroke.Color = Colors.NeonWhite
    glowStroke.Thickness = 3
    glowStroke.Transparency = 0.2
    glowStroke.Parent = iconGlow
    local glowGradient = Instance.new("UIGradient")
    glowGradient.Color = ColorSequence.new{
        ColorSequenceKeypoint.new(0, Colors.NeonWhite),
        ColorSequenceKeypoint.new(0.5, Colors.NeonGlow),
        ColorSequenceKeypoint.new(1, Colors.NeonWhite)
    }
    glowGradient.Transparency = NumberSequence.new{
        NumberSequenceKeypoint.new(0, 0.8),
        NumberSequenceKeypoint.new(0.2, 0.05),
        NumberSequenceKeypoint.new(0.8, 0.05),
        NumberSequenceKeypoint.new(1, 0.8)
    }
    glowGradient.Parent = glowStroke
    local iconImage = Instance.new("ImageLabel")
    iconImage.Size = UDim2.new(0.8, 0, 0.8, 0)
    iconImage.Position = UDim2.new(0.1, 0, 0.1, 0)
    iconImage.BackgroundTransparency = 1
    iconImage.Image = "rbxassetid://95233466475324"
    iconImage.ImageColor3 = Colors.NeonWhite
    iconImage.ImageTransparency = 0.1
    iconImage.ScaleType = Enum.ScaleType.Fit
    iconImage.ZIndex = 13
    iconImage.Parent = iconContainer
    UI.Header = {Container = header, IconGlow = glowGradient, IconStroke = glowStroke}
    return header
end

local function CreateContent(parent)
    local content = Instance.new("Frame")
    content.Name = "Content"
    content.Size = UDim2.new(1, -64, 0, 340)
    content.Position = UDim2.new(0, 32, 0, 120)
    content.BackgroundTransparency = 1
    content.ZIndex = 11
    content.Selectable = false
    content.Parent = parent
    local title = Instance.new("TextLabel")
    title.Size = UDim2.new(1, 0, 0, 32)
    title.BackgroundTransparency = 1
    title.Text = "Access Key Required"
    title.TextColor3 = Colors.TextPrimary
    title.TextSize = 24
    title.Font = Enum.Font.GothamBold
    title.TextXAlignment = Enum.TextXAlignment.Center
    title.ZIndex = 12
    title.Parent = content
    local subtitle = Instance.new("TextLabel")
    subtitle.Size = UDim2.new(1, 0, 0, 40)
    subtitle.Position = UDim2.new(0, 0, 0, 40)
    subtitle.BackgroundTransparency = 1
    subtitle.Text = "Enter your access key to continue"
    subtitle.TextColor3 = Colors.TextSecondary
    subtitle.TextSize = 16
    subtitle.Font = Enum.Font.Gotham
    subtitle.TextXAlignment = Enum.TextXAlignment.Center
    subtitle.TextWrapped = true
    subtitle.ZIndex = 12
    subtitle.Parent = content
    UI.Content = content
    return content
end

local function CreateInputSection(parent)
    local section = Instance.new("Frame")
    section.Size = UDim2.new(1, 0, 0, 100)
    section.Position = UDim2.new(0, 0, 0, 100)
    section.BackgroundTransparency = 1
    section.ZIndex = 12
    section.Selectable = false
    section.Parent = parent
    local inputContainer = Instance.new("Frame")
    inputContainer.Size = UDim2.new(1, 0, 0, 52)
    inputContainer.BackgroundColor3 = Colors.Surface
    inputContainer.BorderSizePixel = 0
    inputContainer.ZIndex = 13
    inputContainer.Selectable = false
    inputContainer.Parent = section
    local corner = Instance.new("UICorner")
    corner.CornerRadius = UDim.new(0, 12)
    corner.Parent = inputContainer
    local stroke = Instance.new("UIStroke")
    stroke.Color = Colors.Border
    stroke.Thickness = 1
    stroke.Transparency = 0.3
    stroke.Parent = inputContainer
    local inputGlow = Instance.new("Frame")
    inputGlow.Size = UDim2.new(1, 8, 1, 8)
    inputGlow.Position = UDim2.new(0, -4, 0, -4)
    inputGlow.BackgroundTransparency = 1
    inputGlow.ZIndex = inputContainer.ZIndex - 1
    inputGlow.Visible = false
    inputGlow.Selectable = false
    inputGlow.Parent = inputContainer
    local glowCorner = Instance.new("UICorner")
    glowCorner.CornerRadius = UDim.new(0, 16)
    glowCorner.Parent = inputGlow
    local glowStroke = Instance.new("UIStroke")
    glowStroke.Color = Colors.NeonWhite
    glowStroke.Thickness = 2
    glowStroke.Transparency = 0.3
    glowStroke.Parent = inputGlow
    local glowGradient = Instance.new("UIGradient")
    glowGradient.Color = ColorSequence.new{
        ColorSequenceKeypoint.new(0, Colors.NeonWhite),
        ColorSequenceKeypoint.new(0.5, Colors.NeonGlow),
        ColorSequenceKeypoint.new(1, Colors.NeonWhite)
    }
    glowGradient.Transparency = NumberSequence.new{
        NumberSequenceKeypoint.new(0, 0.8),
        NumberSequenceKeypoint.new(0.2, 0.1),
        NumberSequenceKeypoint.new(0.8, 0.1),
        NumberSequenceKeypoint.new(1, 0.8)
    }
    glowGradient.Parent = glowStroke
    local textInput = Instance.new("TextBox")
    textInput.Size = UDim2.new(1, -24, 1, 0)
    textInput.Position = UDim2.new(0, 12, 0, 0)
    textInput.BackgroundTransparency = 1
    textInput.Text = ""
    textInput.PlaceholderText = "Enter key here"
    textInput.TextColor3 = Colors.TextPrimary
    textInput.PlaceholderColor3 = Colors.TextSecondary
    textInput.TextSize = 16
    textInput.Font = Enum.Font.Gotham
    textInput.TextXAlignment = Enum.TextXAlignment.Left
    textInput.ClearTextOnFocus = false
    textInput.ZIndex = 14
    textInput.Selectable = true
    textInput.Parent = inputContainer
    local charCounter = Instance.new("TextLabel")
    charCounter.Size = UDim2.new(0, 80, 0, 20)
    charCounter.Position = UDim2.new(1, -85, 0, 60)
    charCounter.BackgroundTransparency = 1
    charCounter.Text = "0/" .. Config.MaxKeyLength
    charCounter.TextColor3 = Colors.TextSecondary
    charCounter.TextSize = 12
    charCounter.Font = Enum.Font.Gotham
    charCounter.TextXAlignment = Enum.TextXAlignment.Right
    charCounter.ZIndex = 13
    charCounter.Parent = section
    UI.Input = { Container = inputContainer, TextBox = textInput, Counter = charCounter, Stroke = stroke,
        Glow = {Frame = inputGlow, Stroke = glowStroke, Gradient = glowGradient} }
    return section
end

local function CreateSubmitButton(parent)
    local submitButton = Instance.new("TextButton")
    submitButton.Size = UDim2.new(1, 0, 0, 48)
    submitButton.Position = UDim2.new(0, 0, 0, 200)
    submitButton.BackgroundColor3 = Colors.Primary
    submitButton.BorderSizePixel = 0
    submitButton.Text = "Verify Access Key"
    submitButton.TextColor3 = Colors.TextPrimary
    submitButton.TextSize = 16
    submitButton.Font = Enum.Font.GothamMedium
    submitButton.AutoButtonColor = false
    submitButton.ZIndex = 13
    submitButton.Selectable = true
    submitButton.Parent = parent
    local submitCorner = Instance.new("UICorner")
    submitCorner.CornerRadius = UDim.new(0, 12)
    submitCorner.Parent = submitButton
    local loadingContainer = Instance.new("Frame")
    loadingContainer.Size = UDim2.new(0, 24, 0, 24)
    loadingContainer.Position = UDim2.new(0.5, -12, 0, 12)
    loadingContainer.BackgroundTransparency = 1
    loadingContainer.Visible = false
    loadingContainer.ZIndex = 14
    loadingContainer.Selectable = false
    loadingContainer.Parent = submitButton
    local spinner = Instance.new("Frame")
    spinner.Size = UDim2.new(1, 0, 1, 0)
    spinner.BackgroundColor3 = Colors.TextPrimary
    spinner.BorderSizePixel = 0
    spinner.ZIndex = 15
    spinner.Selectable = false
    spinner.Parent = loadingContainer
    local spinnerCorner = Instance.new("UICorner")
    spinnerCorner.CornerRadius = UDim.new(1, 0)
    spinnerCorner.Parent = spinner
    local spinnerGradient = Instance.new("UIGradient")
    spinnerGradient.Transparency = NumberSequence.new{
        NumberSequenceKeypoint.new(0, 0),
        NumberSequenceKeypoint.new(0.8, 0.8),
        NumberSequenceKeypoint.new(1, 1)
    }
    spinnerGradient.Parent = spinner
    UI.Buttons = { Submit = submitButton, Loading = {Container = loadingContainer, Spinner = spinner} }
    return submitButton
end

local function CreateStatus(parent)
    local statusContainer = Instance.new("Frame")
    statusContainer.Size = UDim2.new(1, 0, 0, 60)
    statusContainer.Position = UDim2.new(0, 0, 0, 260)
    statusContainer.BackgroundTransparency = 1
    statusContainer.ZIndex = 12
    statusContainer.Selectable = false
    statusContainer.Parent = parent
    local statusLabel = Instance.new("TextLabel")
    statusLabel.Size = UDim2.new(1, 0, 1, 0)
    statusLabel.BackgroundTransparency = 1
    statusLabel.Text = ""
    statusLabel.TextColor3 = Colors.Error
    statusLabel.TextSize = 14
    statusLabel.Font = Enum.Font.Gotham
    statusLabel.TextXAlignment = Enum.TextXAlignment.Center
    statusLabel.TextWrapped = true
    statusLabel.ZIndex = 13
    statusLabel.Parent = statusContainer
    UI.Status = statusLabel
    return statusLabel
end

local function CreateParticleContainer(parent)
    local container = Instance.new("Frame")
    container.Size = UDim2.new(1, 0, 1, 0)
    container.BackgroundTransparency = 1
    container.ZIndex = 105
    container.Selectable = false
    container.Parent = parent
    UI.ParticleContainer = container
    return container
end

local function CreateParticle()
    if not UI.ParticleContainer or not UI.ParticleContainer.Parent or State.IsDestroyed then return nil end
    local size = math.random(8, 24)
    local particle = Instance.new("Frame")
    particle.Size = UDim2.new(0, size, 0, size)
    particle.Position = UDim2.new(math.random() * 1.4 - 0.2, 0, 1.2, 0)
    particle.BackgroundColor3 = Colors.NeonWhite
    particle.BackgroundTransparency = math.random(60, 85) / 100
    particle.BorderSizePixel = 0
    particle.ZIndex = 106
    particle.Selectable = false
    particle.Parent = UI.ParticleContainer
    local corner = Instance.new("UICorner")
    corner.CornerRadius = UDim.new(1, 0)
    corner.Parent = particle
    local gradient = Instance.new("UIGradient")
    local bubbleColors = {
        Color3.fromRGB(200, 230, 255), Color3.fromRGB(180, 220, 255),
        Color3.fromRGB(220, 240, 255), Color3.fromRGB(190, 210, 240)
    }
    local color1 = bubbleColors[math.random(#bubbleColors)]
    local color2 = bubbleColors[math.random(#bubbleColors)]
    gradient.Color = ColorSequence.new{
        ColorSequenceKeypoint.new(0, color1),
        ColorSequenceKeypoint.new(0.3, Color3.fromRGB(255, 255, 255)),
        ColorSequenceKeypoint.new(0.7, color2),
        ColorSequenceKeypoint.new(1, color1)
    }
    gradient.Rotation = math.random(0, 360)
    gradient.Parent = particle
    local highlight = Instance.new("Frame")
    highlight.Size = UDim2.new(0.3, 0, 0.3, 0)
    highlight.Position = UDim2.new(0.2, 0, 0.15, 0)
    highlight.BackgroundColor3 = Color3.fromRGB(255, 255, 255)
    highlight.BackgroundTransparency = 0.3
    highlight.BorderSizePixel = 0
    highlight.ZIndex = particle.ZIndex + 1
    highlight.Parent = particle
    local highlightCorner = Instance.new("UICorner")
    highlightCorner.CornerRadius = UDim.new(1, 0)
    highlightCorner.Parent = highlight
    local glow = Instance.new("Frame")
    glow.Size = UDim2.new(1.8, 0, 1.8, 0)
    glow.Position = UDim2.new(-0.4, 0, -0.4, 0)
    glow.BackgroundColor3 = Color3.fromRGB(200, 230, 255)
    glow.BackgroundTransparency = 0.9
    glow.BorderSizePixel = 0
    glow.ZIndex = particle.ZIndex - 1
    glow.Parent = particle
    local glowCorner = Instance.new("UICorner")
    glowCorner.CornerRadius = UDim.new(1, 0)
    glowCorner.Parent = glow
    local particleData = {
        frame = particle, vx = (math.random() - 0.5) * 0.004, vy = -math.random(20, 50) / 10000,
        created = tick(), rotation = 0, rotationSpeed = (math.random() - 0.5) * 2,
        pulsePhase = math.random() * math.pi * 2, driftPhase = math.random() * math.pi * 2,
        originalTransparency = particle.BackgroundTransparency, glow = glow, highlight = highlight,
        lifetime = math.random(30, 60), originalSize = size, wobblePhase = math.random() * math.pi * 2,
        repelForce = {x = 0, y = 0}, mass = size / 10
    }
    table.insert(State.Particles, particleData)
    return particle
end

local function UpdateParticles()
    if State.IsDestroyed or not UI.ParticleContainer then return end
    local screenSize = UI.ScreenGui.AbsoluteSize
    local mouseScreenX = State.MousePosition.X / screenSize.X
    local mouseScreenY = State.MousePosition.Y / screenSize.Y
    for i = #State.Particles, 1, -1 do
        local p = State.Particles[i]
        if not p or not p.frame or not p.frame.Parent then
            table.remove(State.Particles, i)
        else
            local currentPos = p.frame.Position
            local age = tick() - p.created
            if currentPos.Y.Scale < -0.3 or age > p.lifetime then
                p.frame:Destroy()
                table.remove(State.Particles, i)
            else
                local distanceToMouse = math.sqrt(
                    (currentPos.X.Scale - mouseScreenX)^2 + (currentPos.Y.Scale - mouseScreenY)^2)
                local repelStrength = 0.08
                local repelRadius = 0.15
                local repelForceX = 0
                local repelForceY = 0
                if distanceToMouse < repelRadius and distanceToMouse > 0 then
                    local repelPower = (repelRadius - distanceToMouse) / repelRadius
                    repelPower = repelPower * repelStrength / p.mass
                    local directionX = (currentPos.X.Scale - mouseScreenX) / distanceToMouse
                    local directionY = (currentPos.Y.Scale - mouseScreenY) / distanceToMouse
                    repelForceX = directionX * repelPower
                    repelForceY = directionY * repelPower
                end
                p.repelForce.x = p.repelForce.x * 0.85 + repelForceX * 0.15
                p.repelForce.y = p.repelForce.y * 0.85 + repelForceY * 0.15
                local newX = currentPos.X.Scale + p.vx + p.repelForce.x
                local newY = currentPos.Y.Scale + p.vy + p.repelForce.y
                if newX <= -0.2 then newX = 1.2 elseif newX >= 1.2 then newX = -0.2 end
                local wobbleTime = tick() * 1.5 + p.wobblePhase
                newX = newX + math.sin(wobbleTime) * 0.002
                newY = newY + math.cos(wobbleTime * 0.7) * 0.001
                newX = newX + (math.random() - 0.5) * 0.0008
                newY = newY + (math.random() - 0.5) * 0.0005
                p.rotation = p.rotation + p.rotationSpeed
                p.frame.Rotation = p.rotation
                local breathe = math.sin(tick() * 2.5 + p.pulsePhase) * 0.1 + 1
                local currentSize = p.originalSize * breathe
                p.frame.Size = UDim2.new(0, currentSize, 0, currentSize)
                local transparencyPulse = math.sin(tick() * 3 + p.pulsePhase) * 0.1
                local newTransparency = math.max(0.5, math.min(0.95, p.originalTransparency + transparencyPulse))
                p.frame.BackgroundTransparency = newTransparency
                local glowIntensity = 0.9
                if distanceToMouse < 0.2 then glowIntensity = 0.7 + (distanceToMouse / 0.2) * 0.2 end
                p.glow.BackgroundTransparency = glowIntensity
                local shimmer = math.sin(tick() * 4 + p.pulsePhase) * 0.2 + 0.3
                p.highlight.BackgroundTransparency = shimmer
                p.vx = p.vx * 0.995
                p.vy = p.vy * 0.998
                p.frame.Position = UDim2.new(newX, 0, newY, 0)
            end
        end
    end
end

local function CreateButtonGlow(button, hoverColor, originalColor)
    local glowBorder = Instance.new("Frame")
    glowBorder.Size = UDim2.new(1, 8, 1, 8)
    glowBorder.Position = UDim2.new(0, -4, 0, -4)
    glowBorder.BackgroundTransparency = 1
    glowBorder.ZIndex = button.ZIndex - 1
    glowBorder.Visible = false
    glowBorder.Selectable = false
    glowBorder.Parent = button
    local corner = Instance.new("UICorner")
    corner.CornerRadius = UDim.new(0, 14)
    corner.Parent = glowBorder
    local stroke = Instance.new("UIStroke")
    stroke.Color = Colors.NeonWhite
    stroke.Thickness = 2
    stroke.Transparency = 0.3
    stroke.Parent = glowBorder
    local gradient = Instance.new("UIGradient")
    gradient.Color = ColorSequence.new{
        ColorSequenceKeypoint.new(0, Colors.NeonWhite),
        ColorSequenceKeypoint.new(0.5, Colors.NeonGlow),
        ColorSequenceKeypoint.new(1, Colors.NeonWhite)
    }
    gradient.Transparency = NumberSequence.new{
        NumberSequenceKeypoint.new(0, 0.8),
        NumberSequenceKeypoint.new(0.2, 0.1),
        NumberSequenceKeypoint.new(0.8, 0.1),
        NumberSequenceKeypoint.new(1, 0.8)
    }
    gradient.Parent = stroke
    local currentTween = nil
    local buttonId = tostring(button)
    button.MouseEnter:Connect(function()
        State.FocusStates.ButtonHovered[buttonId] = true
        glowBorder.Visible = true
        Services.TweenService:Create(button, TweenInfo.new(0.2, Enum.EasingStyle.Quad),
            {BackgroundColor3 = hoverColor}):Play()
        Services.TweenService:Create(stroke, TweenInfo.new(0.2, Enum.EasingStyle.Quad),
            {Transparency = 0.1}):Play()
        if currentTween then currentTween:Cancel() end
        currentTween = Services.TweenService:Create(gradient,
            TweenInfo.new(1.5, Enum.EasingStyle.Linear, Enum.EasingDirection.InOut, -1),
            {Rotation = 360})
        currentTween:Play()
    end)
    button.MouseLeave:Connect(function()
        State.FocusStates.ButtonHovered[buttonId] = false
        Services.TweenService:Create(button, TweenInfo.new(0.2, Enum.EasingStyle.Quad),
            {BackgroundColor3 = originalColor}):Play()
        Services.TweenService:Create(stroke, TweenInfo.new(0.3, Enum.EasingStyle.Quad),
            {Transparency = 0.8}):Play()
        if currentTween then
            currentTween:Cancel()
            gradient.Rotation = 0
        end
        task.spawn(function()
            task.wait(0.3)
            if glowBorder and glowBorder.Parent then glowBorder.Visible = false end
        end)
    end)
    return {glowBorder, stroke, gradient}
end

local function ShowStatus(message, isError, isSuccess)
    if not UI.Status then return end
    UI.Status.Text = message
    if isSuccess then UI.Status.TextColor3 = Colors.Success
    elseif isError then UI.Status.TextColor3 = Colors.Error
    else UI.Status.TextColor3 = Colors.Warning end
    UI.Status.TextTransparency = 1
    Services.TweenService:Create(UI.Status, TweenInfo.new(0.3, Enum.EasingStyle.Quad),
        {TextTransparency = 0}):Play()
end

local function ClearStatus()
    if UI.Status then
        Services.TweenService:Create(UI.Status, TweenInfo.new(0.3, Enum.EasingStyle.Quad),
            {TextTransparency = 1}):Play()
    end
end

local function SetLoading(isLoading)
    State.IsLoading = isLoading
    if not UI.Buttons then return end
    UI.Buttons.Loading.Container.Visible = isLoading
    UI.Buttons.Submit.Text = isLoading and "" or "Verify Access Key"
    if isLoading then
        local tween = Services.TweenService:Create(UI.Buttons.Loading.Spinner,
            TweenInfo.new(1, Enum.EasingStyle.Linear, Enum.EasingDirection.InOut, -1),
            {Rotation = 360})
        tween:Play()
        State.Animations.SpinTween = tween
    else
        if State.Animations.SpinTween then
            State.Animations.SpinTween:Cancel()
            UI.Buttons.Loading.Spinner.Rotation = 0
        end
    end
end

local function UpdateCharCounter()
    if not UI.Input then return end
    local currentLength = string.len(UI.Input.TextBox.Text)
    UI.Input.Counter.Text = currentLength .. "/" .. Config.MaxKeyLength
    if currentLength >= Config.MaxKeyLength then UI.Input.Counter.TextColor3 = Colors.Error
    elseif currentLength >= Config.MaxKeyLength * 0.8 then UI.Input.Counter.TextColor3 = Colors.Warning
    else UI.Input.Counter.TextColor3 = Colors.TextSecondary end
end

local function ValidateKey()
    if State.IsLoading then return end
    local key = UI.Input.TextBox.Text
    if key == "" then
        ShowStatus("Please enter an access key", true)
        UI.Input.TextBox:CaptureFocus()
        return
    end
    SetLoading(true)
    ShowStatus("Validating key...", false, false)
    task.spawn(function()
        task.wait(0.6)
        if djb2(key) == KEY_HASH then
            if getgenv then getgenv().SiteObfusque_Key = key end
            SetLoading(false)
            ShowStatus("Access granted! Loading...", false, true)
            task.wait(1)
            State.IsDestroyed = true
            if UI.ScreenGui and UI.ScreenGui.Parent then UI.ScreenGui:Destroy() end
            LoadPayload()
        else
            SetLoading(false)
            ShowStatus("Invalid access key", true)
        end
    end)
end

local function ConnectEvents()
    Services.UserInputService.InputChanged:Connect(function(input, gameProcessed)
        if input.UserInputType == Enum.UserInputType.MouseMovement then
            State.MousePosition.X = input.Position.X
            State.MousePosition.Y = input.Position.Y
        end
    end)
    UI.Input.TextBox:GetPropertyChangedSignal("Text"):Connect(function()
        local currentText = UI.Input.TextBox.Text
        if string.len(currentText) > Config.MaxKeyLength then
            UI.Input.TextBox.Text = string.sub(currentText, 1, Config.MaxKeyLength)
            ShowStatus("Maximum character limit reached (" .. Config.MaxKeyLength .. ")", true)
        end
        UpdateCharCounter()
        ClearStatus()
    end)
    local inputGlowTween = nil
    UI.Input.TextBox.Focused:Connect(function()
        State.FocusStates.InputFocused = true
        UI.Input.Glow.Frame.Visible = true
        Services.TweenService:Create(UI.Input.Stroke,
            TweenInfo.new(0.2, Enum.EasingStyle.Quad),
            {Color = Colors.NeonWhite, Transparency = 0.1}):Play()
        Services.TweenService:Create(UI.Input.Glow.Stroke,
            TweenInfo.new(0.2, Enum.EasingStyle.Quad),
            {Transparency = 0.1}):Play()
        if inputGlowTween then inputGlowTween:Cancel() end
        inputGlowTween = Services.TweenService:Create(UI.Input.Glow.Gradient,
            TweenInfo.new(2, Enum.EasingStyle.Linear, Enum.EasingDirection.InOut, -1),
            {Rotation = 360})
        inputGlowTween:Play()
        State.Animations.InputGlowTween = inputGlowTween
        ClearStatus()
    end)
    UI.Input.TextBox.FocusLost:Connect(function()
        State.FocusStates.InputFocused = false
        Services.TweenService:Create(UI.Input.Stroke,
            TweenInfo.new(0.2, Enum.EasingStyle.Quad),
            {Color = Colors.Border, Transparency = 0.3}):Play()
        Services.TweenService:Create(UI.Input.Glow.Stroke,
            TweenInfo.new(0.3, Enum.EasingStyle.Quad),
            {Transparency = 0.8}):Play()
        if inputGlowTween then
            inputGlowTween:Cancel()
            UI.Input.Glow.Gradient.Rotation = 0
            State.Animations.InputGlowTween = nil
        end
        task.spawn(function()
            task.wait(0.3)
            if UI.Input.Glow.Frame and UI.Input.Glow.Frame.Parent then
                UI.Input.Glow.Frame.Visible = false
            end
        end)
    end)
    Services.UserInputService.InputBegan:Connect(function(input, gameProcessed)
        if gameProcessed or State.IsDestroyed then return end
        if input.KeyCode == Enum.KeyCode.Return and UI.Input.TextBox:IsFocused() then
            ValidateKey()
        end
    end)
    UI.Buttons.Submit.MouseButton1Click:Connect(function()
        ValidateKey()
    end)
end

local function StartAnimationLoops()
    State.Animations.BorderTween = nil
    State.Animations.IconTween = nil
    State.FocusStates.AnimationsActive = true
    task.spawn(function()
        for i = 1, 25 do
            if State.IsDestroyed then break end
            CreateParticle()
            task.wait(math.random(20, 100) / 1000)
        end
        while not State.IsDestroyed and UI.ScreenGui and UI.ScreenGui.Parent do
            if #State.Particles < Config.ParticleCount then CreateParticle() end
            task.wait(math.random(400, 1200) / 1000)
        end
    end)
    task.spawn(function()
        while not State.IsDestroyed and UI.ScreenGui and UI.ScreenGui.Parent do
            pcall(UpdateParticles)
            task.wait(1/Config.ParticleSpeed)
        end
    end)
    task.spawn(function()
        while not State.IsDestroyed and UI.AnimatedBorder and UI.AnimatedBorder.Frame.Parent do
            if State.Animations.BorderTween then State.Animations.BorderTween:Cancel() end
            local startRotation = UI.AnimatedBorder.Gradient.Rotation
            local tween = Services.TweenService:Create(UI.AnimatedBorder.Gradient,
                TweenInfo.new(4, Enum.EasingStyle.Linear),
                {Rotation = startRotation + 360})
            State.Animations.BorderTween = tween
            tween:Play()
            local success = pcall(function() tween.Completed:Wait() end)
            if not success then task.wait(4) end
            if UI.AnimatedBorder and UI.AnimatedBorder.Gradient and UI.AnimatedBorder.Gradient.Parent then
                UI.AnimatedBorder.Gradient.Rotation = UI.AnimatedBorder.Gradient.Rotation % 360
            end
            task.wait(0.1)
        end
    end)
    task.spawn(function()
        while not State.IsDestroyed and UI.Header and UI.Header.IconGlow and UI.Header.IconGlow.Parent do
            if State.Animations.IconTween then State.Animations.IconTween:Cancel() end
            local startRotation = UI.Header.IconGlow.Rotation
            State.Animations.IconTween = Services.TweenService:Create(UI.Header.IconGlow,
                TweenInfo.new(3, Enum.EasingStyle.Linear),
                {Rotation = startRotation + 360})
            State.Animations.IconTween:Play()
            local success = pcall(function() State.Animations.IconTween.Completed:Wait() end)
            if not success then task.wait(3) end
            if UI.Header and UI.Header.IconGlow and UI.Header.IconGlow.Parent then
                UI.Header.IconGlow.Rotation = UI.Header.IconGlow.Rotation % 360
            end
            task.wait(0.1)
        end
    end)
end

local function PlayEntranceAnimation()
    UI.Container.Size = UDim2.new(0, 0, 0, 0)
    UI.Container.BackgroundTransparency = 1
    UI.Backdrop.BackgroundTransparency = 1
    Services.TweenService:Create(UI.Backdrop,
        TweenInfo.new(0.3, Enum.EasingStyle.Quad),
        {BackgroundTransparency = 0.1}):Play()
    task.wait(0.1)
    Services.TweenService:Create(UI.Container,
        TweenInfo.new(0.4, Enum.EasingStyle.Back, Enum.EasingDirection.Out),
        {Size = UDim2.new(0, 420, 0, 500), BackgroundTransparency = 0}):Play()
    task.wait(0.5)
    UI.Input.TextBox:CaptureFocus()
end

local function Initialize()
    local screenGui = CreateMainGUI()
    local backdrop = CreateBackdrop(screenGui)
    CreateParticleContainer(backdrop)
    local container = CreateContainer(screenGui)
    CreateAnimatedBorder(container)
    CreateHeader(container)
    local content = CreateContent(container)
    CreateInputSection(content)
    CreateSubmitButton(content)
    CreateStatus(content)
    CreateButtonGlow(UI.Buttons.Submit, Colors.HoverPrimary, Colors.Primary)
    UpdateCharCounter()
    ConnectEvents()
    StartAnimationLoops()
    PlayEntranceAnimation()
end

Initialize()
`;
}

// ============================================================
// UPLOAD
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
  if (!filename.endsWith(".lua") && !filename.endsWith(".luau") && !filename.endsWith(".txt")) {
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
// PURGE
// ============================================================
async function handlePurge(message, args) {
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
// SETCATEGORYTICKET
// ============================================================
async function handleSetCategory(message, args) {
  const id = args[0];
  if (!id || !/^\d{17,20}$/.test(id)) {
    return message.reply(
      `${EMOJI.no} Usage: \`.setcategoryticket <category-id>\`\n\n` +
      `💡 Enable Developer Mode → right-click the category → **Copy Category ID**.`
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
  const guildCfg = getGuildConfig(message.guild.id);
  guildCfg.categoryId = category.id;
  saveGuildConfig(message.guild.id, guildCfg);
  cfg.categoryId = category.id;
  saveConfig(cfg);

  const embed = new EmbedBuilder()
    .setTitle(`${EMOJI.yes} Ticket Category Set`)
    .setColor(0x22c55e)
    .setDescription(`Tickets will now be created in **${category.name}** (\`${category.id}\`).`);

  await message.reply({ embeds: [embed] });
}

// ============================================================
// SETOBFCHANNELS
// ============================================================
async function handleSetObfChannels(message, args) {
  if (args.length < 1) {
    return message.reply(`${EMOJI.no} Usage: \`.setobfchannels <channel-id1> [<channel-id2>]\``);
  }

  const ids = args.filter((a) => /^\d{17,20}$/.test(a));
  if (ids.length === 0) {
    return message.reply(`${EMOJI.no} No valid channel IDs provided.`);
  }

  const valid = [];
  for (const id of ids) {
    try {
      const ch = await message.guild.channels.fetch(id);
      if (ch && ch.type === ChannelType.GuildText) valid.push(ch.id);
    } catch {}
  }

  if (valid.length === 0) {
    return message.reply(`${EMOJI.no} None of the provided IDs are valid text channels.`);
  }

  const cfg = loadConfig();
  const guildCfg = getGuildConfig(message.guild.id);
  guildCfg.obfChannels = valid;
  saveGuildConfig(message.guild.id, guildCfg);
  cfg.obfChannels = valid;
  saveConfig(cfg);

  const embed = new EmbedBuilder()
    .setTitle(`${EMOJI.yes} Obfuscation Channels Set`)
    .setColor(0x22c55e)
    .setDescription(`\`.obf\` is now allowed in:\n` + valid.map((id) => `<#${id}>`).join("\n"));

  await message.reply({ embeds: [embed] });
}

// ============================================================
// TICKET PANEL
// ============================================================
async function handleTicketPanel(message) {
  const cfg = loadConfig();
  const guildCfg = getGuildConfig(message.guild.id);
  const categoryId = guildCfg.categoryId || cfg.categoryId;

  if (!categoryId) {
    return message.reply(`${EMOJI.no} Set the category first: \`.setcategoryticket <category-id>\``);
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
// INTERACTIONS
// ============================================================
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  // ==========================================================
  // REALPANEL BUTTONS — all respond (fix for "did not respond in time")
  // ==========================================================

  if (interaction.customId === "rp_refresh") {
    try {
      await interaction.deferUpdate();
      const guildCfg = getGuildConfig(interaction.guild.id);

      const embed = new EmbedBuilder()
        .setTitle("🛠️ SiteObfusque — Admin Control Panel")
        .setColor(0x7c3aed)
        .setDescription(
          "Welcome to the **admin control panel**.\n" +
          "Use the buttons below to manage the bot on this server."
        )
        .addFields(
          {
            name: "📊 Bot Stats",
            value:
              `**Guilds:** ${client.guilds.cache.size}\n` +
              `**Users:** ${client.users.cache.size}\n` +
              `**Ping:** ${client.ws.ping}ms\n` +
              `**Uptime:** ${formatUptime(client.uptime)}`,
            inline: true,
          },
          {
            name: "🌐 Server Info",
            value:
              `**Name:** ${interaction.guild.name}\n` +
              `**ID:** \`${interaction.guild.id}\`\n` +
              `**Members:** ${interaction.guild.memberCount}\n` +
              `**Owner:** <@${interaction.guild.ownerId}>`,
            inline: true,
          },
          {
            name: "⚙️ Current Config",
            value:
              `**Ticket Category:** ${guildCfg.categoryId ? `<#${guildCfg.categoryId}>` : "*not set*"}\n` +
              `**Obf Channels:** ${guildCfg.obfChannels && guildCfg.obfChannels.length ? guildCfg.obfChannels.map((id) => `<#${id}>`).join(", ") : "*not set*"}\n` +
              `**Tickets Created:** ${guildCfg.ticketCounter || 0}`,
            inline: false,
          }
        )
        .setThumbnail(client.user.displayAvatarURL())
        .setFooter({ text: "SiteObfusque — Admin Panel" })
        .setTimestamp();

      const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("rp_refresh").setLabel("Refresh").setEmoji("🔄").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("rp_ticket_help").setLabel("Ticket Category").setEmoji("🎫").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("rp_obf_help").setLabel("Obf Channels").setEmoji("🧠").setStyle(ButtonStyle.Primary)
      );
      const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("rp_guilds").setLabel("Manage Guilds").setEmoji("🌐").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("rp_reload").setLabel("Reload Clyde").setEmoji("🧠").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("rp_shutdown").setLabel("Shutdown Bot").setEmoji("🛑").setStyle(ButtonStyle.Danger)
      );

      await interaction.editReply({ embeds: [embed], components: [row1, row2] });
    } catch (e) {
      console.error("[rp_refresh]", e);
    }
    return;
  }

  if (interaction.customId === "rp_ticket_help") {
    await interaction.reply({
      content:
        "**🎫 How to set the Ticket Category**\n\n" +
        "1. Enable **Developer Mode** in Discord settings\n" +
        "2. Right-click the category you want → **Copy Category ID**\n" +
        "3. Send: `.setcategoryticket <category-id>`\n\n" +
        "Then send `.ticketchannel` in the channel where you want the panel.",
      ephemeral: true,
    });
    return;
  }

  if (interaction.customId === "rp_obf_help") {
    await interaction.reply({
      content:
        "**🧠 How to set Obfuscation Channels**\n\n" +
        "1. Enable **Developer Mode** in Discord settings\n" +
        "2. Right-click the channel → **Copy Channel ID**\n" +
        "3. Send: `.setobfchannels <id1> <id2>`\n\n" +
        "Those are the only channels where `.obf` will work.",
      ephemeral: true,
    });
    return;
  }

  if (interaction.customId === "rp_guilds") {
    try {
      const guilds = [...client.guilds.cache.values()].slice(0, 25);
      const list = guilds
        .map(
          (g, i) =>
            `**${i + 1}.** **${g.name}**\n` +
            `> 🆔 \`${g.id}\`\n` +
            `> 👥 \`${g.memberCount}\` members`
        )
        .join("\n\n") || "*No guilds*";

      const embed = new EmbedBuilder()
        .setTitle(`🌐 Guilds (${client.guilds.cache.size})`)
        .setColor(0x7c3aed)
        .setDescription(list)
        .setFooter({ text: "SiteObfusque — Guilds" })
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });
    } catch (e) {
      console.error("[rp_guilds]", e);
      await interaction.reply({ content: `${EMOJI.no} Error fetching guilds.`, ephemeral: true });
    }
    return;
  }

  if (interaction.customId === "rp_reload") {
    await interaction.reply({
      content: `${EMOJI.loading} Reloading Clyde...`,
      ephemeral: true,
    });

    try {
      const ok = await loadClyde();
      await interaction.editReply({
        content: ok
          ? `${EMOJI.yes} Clyde reloaded successfully.`
          : `${EMOJI.no} Failed to reload Clyde. Check the console.`,
      });
    } catch (e) {
      console.error("[rp_reload]", e);
      await interaction.editReply({ content: `${EMOJI.no} Reload failed: ${e.message}` });
    }
    return;
  }

  if (interaction.customId === "rp_shutdown") {
    await interaction.reply({
      content: `${EMOJI.no} **Shutting down the bot in 3 seconds...**`,
      ephemeral: true,
    });

    setTimeout(() => {
      console.log("[rp_shutdown] Bot shutting down...");
      process.exit(0);
    }, 3000);
    return;
  }

  // ==========================================================
  // PANEL GET SCRIPT
  // ==========================================================
  if (interaction.customId.startsWith("panel_get_")) {
    const panelKey = interaction.customId.replace("panel_get_", "").replace(/_/g, " ");
    const panel = PANELS[panelKey];

    if (!panel) {
      return interaction.reply({ content: `${EMOJI.no} Panel not found.`, ephemeral: true });
    }

    const member = interaction.member;
    const roleName = await getRoleName(interaction.guild, panel.roleId);

    if (!member.roles.cache.has(panel.roleId)) {
      return interaction.reply({
        content:
          `${EMOJI.no} **You need to be whitelisted or have the ${roleName} role to unlock this script.**`,
        ephemeral: true,
      });
    }

    try {
      const dmEmbed = new EmbedBuilder()
        .setTitle(`${panel.emoji} ${panel.displayName} — Script`)
        .setColor(panel.color)
        .setDescription(
          "Here is your script. Copy and paste it into your executor.\n\n" +
          "```lua\n" + panel.script + "\n```"
        )
        .setFooter({ text: "SiteObfusque — DM Delivery" })
        .setTimestamp();

      await interaction.user.send({ embeds: [dmEmbed] });

      await interaction.reply({
        content: `${EMOJI.yes} Script sent to your DM! Check your private messages.`,
        ephemeral: true,
      });
    } catch (e) {
      console.error("[panel DM error]", e);
      await interaction.reply({
        content:
          `${EMOJI.no} I couldn't send you a DM. Please enable DMs from server members and try again.`,
        ephemeral: true,
      });
    }
    return;
  }

  // ==========================================================
  // TICKET CREATE
  // ==========================================================
  if (interaction.customId === "create_ticket") {
    try {
      await interaction.deferReply({ ephemeral: true });

      const cfg = loadConfig();
      const guildCfg = getGuildConfig(interaction.guild.id);
      const categoryId = guildCfg.categoryId || cfg.categoryId;

      if (!categoryId) {
        return interaction.editReply(`${EMOJI.no} No ticket category configured.`);
      }

      const guild = interaction.guild;
      const user = interaction.user;

      const existing = guild.channels.cache.find(
        (c) =>
          c.name === `ticket-${user.username.toLowerCase()}` &&
          c.parentId === categoryId
      );
      if (existing) {
        return interaction.editReply(
          `${EMOJI.no} You already have an open ticket: <#${existing.id}>`
        );
      }

      guildCfg.ticketCounter = (guildCfg.ticketCounter || 0) + 1;
      saveGuildConfig(guild.id, guildCfg);

      const channel = await guild.channels.create({
        name: `ticket-${user.username.toLowerCase()}`,
        type: ChannelType.GuildText,
        parent: categoryId,
        permissionOverwrites: [
          { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
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

  // ==========================================================
  // TICKET CLOSE
  // ==========================================================
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
// STARTUP
// ============================================================
(async () => {
  await loadClyde();
  client.login(process.env.DISCORD_TOKEN);
})();