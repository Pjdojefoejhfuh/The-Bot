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

// ⚠️ REMPLACE PAR TON ID DISCORD
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
  if (command === "fetch" || command === "raw" || command === "get") {
    // On passe TOUT le contenu après la commande, pas juste args[0]
    const fullArg = message.content.slice(PREFIX.length + command.length).trim();
    return handleFetch(message, fullArg);
  }
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
      { name: "`.loader [\"<key>\"]`", value: "Create a protected loader. If no key given, one is auto-generated." },
      { name: "`.upload`", value: "Upload a file to GitHub Gist + loadstring" },
      { name: "`.fetch <url|loadstring>`", value: "Fetch a raw URL or extract URL from a loadstring and display its content" },
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
          "or just `\`.loader\`` (auto-generated key). Attach your file.",
      },
      {
        name: "5️⃣  Upload it (optional)",
        value:
          "Send:\n```\n.upload\n```\n" +
          "with the file attached to get a loadstring.",
      },
      {
        name: "6️⃣  Fetch a raw script",
        value:
          "Send:\n```\n.fetch https://raw.githubusercontent.com/...\n```\n" +
          "or paste a loadstring:\n```\n.fetch loadstring(game:HttpGet(\"https://...\"))()\n```",
      },
      {
        name: "7️⃣  Need help?",
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
// FETCH — Extrait l'URL d'une loadstring ou d'une URL brute
// Accepte :
//   .fetch https://raw.githubusercontent.com/user/repo/main/script.lua
//   .fetch loadstring(game:HttpGet("https://raw.githubusercontent.com/..."))()
//   .fetch <n'importe quel texte contenant une URL>
// ============================================================
async function handleFetch(message, input) {
  input = (input || "").trim();

  // Si rien n'est fourni, on regarde dans les pièces jointes / contenu brut
  if (!input) {
    // Cherche une URL dans tout le message (au cas où)
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

  // ============================================================
  // EXTRACTION DE L'URL
  // ============================================================
  let url = null;

  // 1) Le plus courant : game:HttpGet("URL")
  const httpGetMatch = input.match(/HttpGet\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/i);
  if (httpGetMatch) {
    url = httpGetMatch[1];
  }

  // 2) Sinon : n'importe quelle URL http(s) dans le texte
  if (!url) {
    const anyUrl = input.match(/https?:\/\/[^\s"'`)\]]+/i);
    if (anyUrl) url = anyUrl[0];
  }

  // 3) Sinon : si l'input est déjà une URL propre
  if (!url) {
    const clean = input.replace(/["'`]/g, "").trim();
    if (/^https?:\/\/.+/i.test(clean)) url = clean;
  }

  if (!url) {
    return message.reply(`${EMOJI.no} Aucune URL valide trouvée dans ton message.`);
  }

  // Nettoyage final (enlève les caractères parasites en fin d'URL)
  url = url.replace(/[)\].,;:!?]+$/g, "").trim();

  if (!/^https?:\/\//i.test(url)) {
    return message.reply(`${EMOJI.no} L'URL doit commencer par \`http://\` ou \`https://\`.`);
  }

  const processing = await message.reply(`${EMOJI.loading} Fetching...`);

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "SiteObfusque-Bot/1.0" },
    });

    if (!res.ok) {
      return processing.edit(
        `${EMOJI.no} Erreur HTTP **${res.status}** — \`${res.statusText}\`\nURL : \`${url}\``
      );
    }

    const content = await res.text();

    if (!content || content.length === 0) {
      return processing.edit(`${EMOJI.no} Le fichier est vide.`);
    }

    // Détection du langage
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

    // Limites Discord
    const MAX_EMBED = 3900;

    // Si trop long → fichier attaché
    if (content.length > MAX_EMBED) {
      const buffer = Buffer.from(content, "utf-8");

      let ext = "txt";
      if (lang === "lua") ext = "lua";
      else if (lang === "javascript") ext = "js";
      else if (lang === "json") ext = "json";
      else if (lang === "python") ext = "py";

      const file = new AttachmentBuilder(buffer, { name: `fetched.${ext}` });

      const embed = new EmbedBuilder()
        .setTitle(`${EMOJI.yes} Contenu récupéré`)
        .setColor(0x22c55e)
        .setDescription(
          `📄 **${content.length} caractères** — trop long pour être affiché ici.\n` +
          `🔗 [Lien source](${url})`
        )
        .addFields(
          {
            name: "🔗 URL extraite",
            value: `\`${url.length > 200 ? url.slice(0, 197) + "..." : url}\``,
            inline: false,
          }
        )
        .setFooter({ text: "SiteObfusque — fetch" });

      const preview = content.slice(0, 500).replace(/```/g, "``\u200b`");
      embed.addFields({
        name: "👁️ Aperçu",
        value:
          "```" + (lang || "") + "\n" + preview +
          (content.length > 500 ? "\n..." : "") + "\n```",
        inline: false,
      });

      return processing.edit({ content: "", embeds: [embed], files: [file] });
    }

    // Sinon → embed direct
    const safeContent = content.replace(/```/g, "``\u200b`");

    const embed = new EmbedBuilder()
      .setTitle(`${EMOJI.yes} Contenu récupéré`)
      .setColor(0x22c55e)
      .setDescription("```" + (lang || "") + "\n" + safeContent + "\n```")
      .addFields(
        {
          name: "🔗 URL extraite",
          value: `\`${url.length > 200 ? url.slice(0, 197) + "..." : url}\``,
          inline: false,
        },
        { name: "📏 Taille", value: `${content.length} caractères`, inline: true },
        { name: "🌐 Status", value: `HTTP ${res.status}`, inline: true }
      )
      .setFooter({ text: "SiteObfusque — fetch" });

    await processing.edit({ content: "", embeds: [embed] });
  } catch (e) {
    console.error("[.fetch error]", e);
    await processing.edit(`${EMOJI.no} Erreur : ${e.message}`);
  }
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
// LOADER — .loader ["<key>"] + fichier
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
    if (keyMatch) {
      key = keyMatch[1];
    } else {
      key = raw;
    }
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
      "**Loader open-source avec key system intégré** ✅",
      "• Si `getgenv().SiteObfusque_Key` est déjà valide → **chargement direct**",
      "• Sinon → **interface de saisie de clé** s'affiche",
      "",
      "**Loadstring :**",
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
        name: "🔑 Clé générée automatiquement",
        value: "```\n" + key + "\n```\n⚠️ Note-la maintenant, elle ne sera **plus jamais** affichée.",
        inline: false,
      });
    } else {
      embed.addFields({
        name: "🔑 Clé",
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
// TEMPLATE DU LOADER (key system UI — version simplifiée)
// ============================================================
function buildLoaderTemplate({ keyHash, encodedUrl }) {
  return `--[[
    SiteObfusque Loader (open source)
    ──────────────────────────────────
    • La clé n'est PAS stockée en clair (seulement son hash djb2)
    • La source n'est PAS dans ce fichier (payload distant)
    • Si getgenv().SiteObfusque_Key est valide → chargement direct
    • Sinon → interface de saisie de clé
]]

-- ============ SECURITY CONSTANTS ============
local KEY_HASH = ${keyHash}
local ENC_URL  = "${encodedUrl}"

-- ============ BASE64 DECODE ============
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

-- ============ DJB2 HASH (must match bot) ============
local function djb2(s)
    local h = 5381
    for i = 1, #s do
        h = (h * 33 + s:byte(i)) % 4294967296
    end
    return h
end

-- ============ PAYLOAD LOADER ============
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

-- ============ AUTO-LOAD IF KEY ALREADY VALID ============
local storedKey = nil
if getgenv then storedKey = getgenv().SiteObfusque_Key end

if storedKey and storedKey ~= "" and djb2(storedKey) == KEY_HASH then
    LoadPayload()
    return
end

-- ================================================================
-- KEY SYSTEM GUI (simplified — only key input + verify button)
-- ================================================================

local Services = {
    Players = game:GetService("Players"),
    TweenService = game:GetService("TweenService"),
    UserInputService = game:GetService("UserInputService"),
    RunService = game:GetService("RunService")
}

local Player = Services.Players.LocalPlayer
local PlayerGui = Player:WaitForChild("PlayerGui")

local Config = {
    MaxKeyLength = 50,
    AnimationSpeed = 0.4,
    ParticleCount = 60,
    ParticleSpeed = 60
}

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
    IsLoading = false,
    Particles = {},
    Animations = {},
    IsDestroyed = false,
    MousePosition = {X = 0, Y = 0},
    FocusStates = {
        InputFocused = false,
        ButtonHovered = {},
        AnimationsActive = true
    }
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

    UI.Input = {
        Container = inputContainer,
        TextBox = textInput,
        Counter = charCounter,
        Stroke = stroke,
        Glow = {Frame = inputGlow, Stroke = glowStroke, Gradient = glowGradient}
    }

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

    UI.Buttons = {
        Submit = submitButton,
        Loading = {Container = loadingContainer, Spinner = spinner}
    }

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
    if not UI.ParticleContainer or not UI.ParticleContainer.Parent or State.IsDestroyed then
        return nil
    end

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
        Color3.fromRGB(200, 230, 255),
        Color3.fromRGB(180, 220, 255),
        Color3.fromRGB(220, 240, 255),
        Color3.fromRGB(190, 210, 240)
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
        frame = particle,
        vx = (math.random() - 0.5) * 0.004,
        vy = -math.random(20, 50) / 10000,
        created = tick(),
        rotation = 0,
        rotationSpeed = (math.random() - 0.5) * 2,
        pulsePhase = math.random() * math.pi * 2,
        driftPhase = math.random() * math.pi * 2,
        originalTransparency = particle.BackgroundTransparency,
        glow = glow,
        highlight = highlight,
        lifetime = math.random(30, 60),
        originalSize = size,
        wobblePhase = math.random() * math.pi * 2,
        repelForce = {x = 0, y = 0},
        mass = size / 10
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
                    (currentPos.X.Scale - mouseScreenX)^2 +
                    (currentPos.Y.Scale - mouseScreenY)^2
                )

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

                if newX <= -0.2 then newX = 1.2
                elseif newX >= 1.2 then newX = -0.2 end

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
                if distanceToMouse < 0.2 then
                    glowIntensity = 0.7 + (distanceToMouse / 0.2) * 0.2
                end
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
            if glowBorder and glowBorder.Parent then
                glowBorder.Visible = false
            end
        end)
    end)

    return {glowBorder, stroke, gradient}
end

local function ShowStatus(message, isError, isSuccess)
    if not UI.Status then return end

    UI.Status.Text = message
    if isSuccess then
        UI.Status.TextColor3 = Colors.Success
    elseif isError then
        UI.Status.TextColor3 = Colors.Error
    else
        UI.Status.TextColor3 = Colors.Warning
    end

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

    if currentLength >= Config.MaxKeyLength then
        UI.Input.Counter.TextColor3 = Colors.Error
    elseif currentLength >= Config.MaxKeyLength * 0.8 then
        UI.Input.Counter.TextColor3 = Colors.Warning
    else
        UI.Input.Counter.TextColor3 = Colors.TextSecondary
    end
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
            if UI.ScreenGui and UI.ScreenGui.Parent then
                UI.ScreenGui:Destroy()
            end

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
            if #State.Particles < Config.ParticleCount then
                CreateParticle()
            end
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
            if State.Animations.BorderTween then
                State.Animations.BorderTween:Cancel()
            end

            local startRotation = UI.AnimatedBorder.Gradient.Rotation
            local tween = Services.TweenService:Create(UI.AnimatedBorder.Gradient,
                TweenInfo.new(4, Enum.EasingStyle.Linear),
                {Rotation = startRotation + 360})

            State.Animations.BorderTween = tween
            tween:Play()

            local success = pcall(function()
                tween.Completed:Wait()
            end)

            if not success then
                task.wait(4)
            end

            if UI.AnimatedBorder and UI.AnimatedBorder.Gradient and UI.AnimatedBorder.Gradient.Parent then
                UI.AnimatedBorder.Gradient.Rotation = UI.AnimatedBorder.Gradient.Rotation % 360
            end

            task.wait(0.1)
        end
    end)

    task.spawn(function()
        while not State.IsDestroyed and UI.Header and UI.Header.IconGlow and UI.Header.IconGlow.Parent do
            if State.Animations.IconTween then
                State.Animations.IconTween:Cancel()
            end

            local startRotation = UI.Header.IconGlow.Rotation
            State.Animations.IconTween = Services.TweenService:Create(UI.Header.IconGlow,
                TweenInfo.new(3, Enum.EasingStyle.Linear),
                {Rotation = startRotation + 360})

            State.Animations.IconTween:Play()

            local success = pcall(function()
                State.Animations.IconTween.Completed:Wait()
            end)

            if not success then
                task.wait(3)
            end

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