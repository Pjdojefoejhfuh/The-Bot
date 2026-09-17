const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

// Chemin vers le dossier où tu vas mettre cli.js de ClydeDeobf
// Assure-toi d'avoir cloné le repo dans bot/ClydeDeobf/
const DEOBF_PATH = path.join(__dirname, 'ClydeDeobf', 'cli.js');

async function deobfuscateSource(inputCode) {
  return new Promise((resolve, reject) => {
    const tempInput = path.join(__dirname, 'temp_input.lua');
    const tempOutput = path.join(__dirname, 'temp_output.lua');

    // Écrit le code obfusqué dans un fichier temporaire
    fs.writeFileSync(tempInput, inputCode, 'utf-8');

    // Lance le déobfuscateur en ligne de commande [citation:1]
    exec(`node "${DEOBF_PATH}" "${tempInput}" -o "${tempOutput}"`, (error, stdout, stderr) => {
      // Nettoie le fichier d'entrée
      if (fs.existsSync(tempInput)) fs.unlinkSync(tempInput);

      if (error) {
        if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput);
        return reject(new Error(stderr || error.message));
      }

      // Lit le résultat
      if (!fs.existsSync(tempOutput)) {
        return reject(new Error("Le déobfuscateur n'a pas produit de fichier de sortie."));
      }

      const result = fs.readFileSync(tempOutput, 'utf-8');
      
      // Nettoie le fichier de sortie
      fs.unlinkSync(tempOutput);
      
      resolve(result);
    });
  });
}

module.exports = { deobfuscateSource };