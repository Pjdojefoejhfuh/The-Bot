require("dotenv").config();
const {
  Client, GatewayIntentBits, AttachmentBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField,
  ChannelType,
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

// ⚠️ REMPLACE PAR TON ID DISCORD (clic droit sur ton profil → Copier l'identifiant)
const AUTHORIZED_DEOBF_ID = "1474433573174907054";

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
// CONFIG (tickets + obf channels)
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
      };
    }
  } catch (e) {
    console.error("[config] load error:", e.message);
  }
  return { categoryId: null, ticketCounter: 0, obfChannels: [] };
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
// DÉOBFUSCATION VIA CLYDEDEOBF (Node.js)
// ============================================================
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

// ============================================================
// HELPERS GITHUB GIST
// ============================================================
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
// DISCORD CLIENT
// ============================================================
client.once("ready", () => {
  console.log("");
  console.log("  ⚡ SiteObfusque Bot");
  console.log("  ────────────────────");
  console.log(`  🤖 ${client.user.tag}`);
  console.log(`  🧠 Clyde: ${clyde ? "✅" : "❌"}`);
  console.log(`  🔓 ClydeDeobf: ${fs.existsSync(CLYDE_DEOBF_CLI) ? "✅" : "❌"}`);
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
  if (command === "deobf") return handleDeobf(message);
  if (command === "loader") return handleLoader(message, args);
  if (command === "upload") return handleUpload(message);
  if (command === "help" || command === "aide") return handleHelp(message);
  if (command === "tuto") return handleTuto(message);
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
    .setTitle(`${EMOJI.yes} SiteObfusque Bot — Commands`)
    .setColor(0x7c3aed)
    .addFields(
      { name: "`.obf`", value: "Obfuscate a `.lua` / `.luau` file (only in authorized channels)" },
      { name: "`.deobf`", value: "Deobfuscate a Clyde-obfuscated script. **Restricted.**" },
      { name: "`.loader \"<key>\"`", value: "Create an open-source loader tied to a key (payload & key stay hidden)" },
      { name: "`.upload`", value: "Upload a file to GitHub Gist + loadstring" },
      { name: "`.tuto`", value: "Show the tutorial panel" },
      { name: "`.purge <1-100>`", value: "Delete N messages (Manage Messages required)" },
      { name: "`.setcategoryticket <id>`", value: "Set the category ID for tickets (Manage Server required)" },
      { name: "`.setobfchannels <id1> <id2>`", value: "Set the 2 channels where `.obf` is allowed (Manage Server required)" },
      { name: "`.ticketchannel`", value: "Send the ticket panel in this channel (Manage Server required)" },
      { name: "`.help`", value: "Show this message" }
    )
    .setFooter({ text: "SiteObfusque" });
  await message.reply({ embeds: [embed] });
}

// ============================================================
// TUTO PANEL
// ============================================================
async function handleTuto(message) {
  const embed = new EmbedBuilder()
    .setTitle("📖 SiteObfusque — Tutorial")
    .setColor(0x7c3aed)
    .setDescription("Welcome! Here's everything you need to know to use the bot.")
    .addFields(
      {
        name: "1️⃣  Get your script ready",
        value: "Save your Lua/Luau script as a `.lua`, `.luau`, or `.txt` file on your computer.",
      },
      {
        name: "2️⃣  Obfuscate it",
        value:
          "Go to an authorized channel and send:\n```\n.obf\n```\n" +
          "**with your file attached in the same message.**",
      },
      {
        name: "3️⃣  Deobfuscate a script (restricted)",
        value:
          "Send:\n```\n.deobf\n```\n" +
          "with the file attached. Only Clyde-obfuscated scripts are supported.",
      },
      {
        name: "4️⃣  Create a protected loader",
        value:
          "Send:\n```\n.loader \"your-key\"\n```\n" +
          "with the file attached. You'll get an open-source loader + a loadstring.",
      },
      {
        name: "5️⃣  Upload it (optional)",
        value:
          "Send:\n```\n.upload\n```\n" +
          "with the file attached to get a loadstring.",
      },
      {
        name: "6️⃣  Need help?",
        value: "Open a ticket with the button in the ticket panel channel.",
      },
      {
        name: "⚠️  Rules",
        value: "• `.obf` only works in authorized channels.\n• Max file size: **500 KB**.",
      }
    )
    .setFooter({ text: "SiteObfusque" })
    .setTimestamp();

  await message.channel.send({ embeds: [embed] });
}

// ============================================================
// OBF
// ============================================================
async function handleObf(message) {
  const cfg = loadConfig();

  if (!cfg.obfChannels.includes(message.channel.id)) {
    const allowed = cfg.obfChannels.length
      ? cfg.obfChannels.map((id) => `<#${id}>`).join(", ")
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
// DEOBF (ClydeDeobf — restricted)
// ============================================================
async function handleDeobf(message) {
  if (message.author.id !== AUTHORIZED_DEOBF_ID) {
    return message.reply(`${EMOJI.no} You are not authorized to use this command.`);
  }

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
// LOADER  —  .loader "<key>"  + fichier attaché
// ------------------------------------------------------------
// 1) Obfusque le fichier
// 2) Upload le payload obfusqué sur un Gist GitHub public
// 3) Génère un loader Lua OPEN SOURCE
//    → contient seulement le HASH djb2 de la clé (pas la clé en clair)
//    → contient l'URL du payload encodée en base64 (pas la source)
// 4) Upload le loader sur un second Gist public
// 5) Renvoie le loader.lua + le loadstring raw
// ============================================================
async function handleLoader(message, args) {
  if (!GITHUB_TOKEN) {
    return message.reply(`${EMOJI.no} \`GITHUB_TOKEN\` not configured.`);
  }

  // Récupère la clé (supporte les guillemets)
  const raw = args.join(" ").trim();
  const key = raw.replace(/^["'`]|["'`]$/g, "").trim();

  if (!key) {
    return message.reply(
      `${EMOJI.no} Usage: \`.loader "<key>"\` with a \`.lua\` file attached.`
    );
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

    // ---------- 1) Obfuscation ----------
    const obfuscated = await obfuscateSource(source, {
      vm: true,
      strings: true,
      flow: true,
      vmLevel: "maximum",
    });

    // ---------- 2) Upload payload obfusqué (Gist public) ----------
    const payloadFilename = crypto.randomBytes(6).toString("hex") + ".lua";
    const payloadGist = await createGist(
      "SiteObfusque payload",
      payloadFilename,
      obfuscated,
      true
    );

    // ---------- 3) Hash djb2 de la clé ----------
    const djb2 = (str) => {
      let h = 5381;
      for (let i = 0; i < str.length; i++) {
        h = ((h * 33) + str.charCodeAt(i)) >>> 0;
      }
      return h;
    };
    const keyHash = djb2(key);

    // ---------- 4) Encodage base64 de l'URL du payload ----------
    const encodedUrl = Buffer.from(payloadGist.rawUrl, "utf-8").toString("base64");

    // ---------- 5) Génération du loader Lua ----------
    const loader = `--[[
    SiteObfusque Loader (open source)
    ──────────────────────────────────
    • La clé n'est PAS dans ce fichier (seulement son hash djb2)
    • La source n'est PAS dans ce fichier (payload récupéré à distance)
    • Le loader est open source, tu peux le lire et le vérifier
]]

local KEY_HASH = ${keyHash}
local ENC_URL  = "${encodedUrl}"

-- base64 decode
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

-- djb2 (identique côté bot)
local function djb2(s)
    local h = 5381
    for i = 1, #s do
        h = (h * 33 + s:byte(i)) % 4294967296
    end
    return h
end

-- Récupération de la clé
local key = nil
if getgenv then key = getgenv().SiteObfusque_Key end

if not key or key == "" then
    warn("[SiteObfusque] Please set getgenv().SiteObfusque_Key = '<your-key>' before running this loader.")
    return
end

if djb2(key) ~= KEY_HASH then
    warn("[SiteObfusque] Invalid key.")
    return
end

-- Fetch du payload
local url = b64d(ENC_URL)
local ok, src = pcall(function() return game:HttpGet(url) end)
if not ok or type(src) ~= "string" or #src == 0 then
    warn("[SiteObfusque] Failed to fetch payload.")
    return
end

local fn, err = loadstring(src)
if not fn then
    warn("[SiteObfusque] Failed to compile payload: " .. tostring(err))
    return
end

fn()
`;

    // ---------- 6) Upload du loader (Gist public) ----------
    const loaderGist = await createGist(
      "SiteObfusque loader",
      "loader.lua",
      loader,
      true
    );

    // ---------- 7) Réponse Discord ----------
    const loaderBuffer = Buffer.from(loader, "utf-8");
    const loaderFile = new AttachmentBuilder(loaderBuffer, { name: "loader.lua" });

    const loadstring =
      `getgenv().SiteObfusque_Key = "${key.replace(/"/g, '\\"')}"\n` +
      `loadstring(game:HttpGet("${loaderGist.rawUrl}"))()`;

    const embed = new EmbedBuilder()
      .setTitle(`${EMOJI.yes} Loader Created`)
      .setColor(0x22c55e)
      .setDescription(
        "**Loader open-source** généré ✅\n" +
        "Ni la **clé** ni la **source** ne sont présentes dedans.\n\n" +
        "**Loadstring à utiliser :**\n" +
        "```lua\n" + loadstring + "\n```"
      )
      .addFields(
        { name: "🔑 Key hash (djb2)", value: `\`${keyHash}\``, inline: true },
        { name: "📦 Payload", value: `${obfuscated.length} chars`, inline: true },
        { name: "🧠 Obfuscation", value: "VM + strings + flow", inline: true },
        { name: "🌐 Loader (raw)", value: `\`${loaderGist.rawUrl}\``, inline: false },
        { name: "📄 Loader (page)", value: `[Open on GitHub](${loaderGist.htmlUrl})`, inline: false }
      )
      .setFooter({ text: "SiteObfusque — Loader" });

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
// PURGE
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
// SETCATEGORYTICKET
// ============================================================
async function handleSetCategory(message, args) {
  if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
    return message.reply(`${EMOJI.no} You need \`Manage Server\` permission.`);
  }

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
  if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
    return message.reply(`${EMOJI.no} You need \`Manage Server\` permission.`);
  }

  if (args.length < 1) {
    return message.reply(
      `${EMOJI.no} Usage: \`.setobfchannels <channel-id1> [<channel-id2>]\``
    );
  }

  const ids = args.filter((a) => /^\d{17,20}$/.test(a));
  if (ids.length === 0) {
    return message.reply(`${EMOJI.no} No valid channel IDs provided.`);
  }

  const valid = [];
  for (const id of ids) {
    try {
      const ch = await message.guild.channels.fetch(id);
      if (ch && ch.type === ChannelType.GuildText) {
        valid.push(ch.id);
      }
    } catch {}
  }

  if (valid.length === 0) {
    return message.reply(`${EMOJI.no} None of the provided IDs are valid text channels.`);
  }

  const cfg = loadConfig();
  cfg.obfChannels = valid;
  saveConfig(cfg);

  const embed = new EmbedBuilder()
    .setTitle(`${EMOJI.yes} Obfuscation Channels Set`)
    .setColor(0x22c55e)
    .setDescription(
      `\`.obf\` is now allowed in:\n` + valid.map((id) => `<#${id}>`).join("\n")
    );

  await message.reply({ embeds: [embed] });
}

// ============================================================
// TICKET PANEL
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
// INTERACTIONS
// ============================================================
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  if (interaction.customId === "create_ticket") {
    try {
      await interaction.deferReply({ ephemeral: true });

      const cfg = loadConfig();
      if (!cfg.categoryId) {
        return interaction.editReply(`${EMOJI.no} No ticket category configured.`);
      }

      const guild = interaction.guild;
      const user = interaction.user;

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