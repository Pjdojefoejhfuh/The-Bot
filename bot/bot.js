require("dotenv").config();
const {
  Client, GatewayIntentBits, AttachmentBuilder, EmbedBuilder,
} = require("discord.js");
const fetch = require("node-fetch");
const path = require("path");
const { pathToFileURL } = require("url");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
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
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  if (command === "obf" || command === "obfuscate") return handleObf(message);
  if (command === "upload") return handleUpload(message);
  if (command === "help" || command === "aide") return handleHelp(message);
});

// ============================================================
// COMMANDES
// ============================================================
async function handleHelp(message) {
  const embed = new EmbedBuilder()
    .setTitle(`${EMOJI.yes} SiteObfusque Bot — Commands`)
    .setColor(0x7c3aed)
    .addFields(
      { name: "`.obf`", value: "Obfuscate a `.lua` / `.luau` file (local, VM-based)" },
      { name: "`.upload`", value: "Upload a file to GitHub Gist + loadstring" },
      { name: "`.help`", value: "Show this message" }
    )
    .setFooter({ text: "SiteObfusque" });
  await message.reply({ embeds: [embed] });
}

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
// DÉMARRAGE
// ============================================================
(async () => {
  await loadClyde();
  client.login(process.env.DISCORD_TOKEN);
})();