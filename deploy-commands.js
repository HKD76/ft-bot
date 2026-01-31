require("dotenv").config();
const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const commands = [
  new SlashCommandBuilder()
    .setName("ft")
    .setDescription("Gestion des First To")
    .addSubcommand(sc =>
      sc
        .setName("start")
        .setDescription("Démarrer une FT")
        .addUserOption(o => o.setName("joueur1").setDescription("Joueur 1").setRequired(true))
        .addUserOption(o => o.setName("joueur2").setDescription("Joueur 2").setRequired(true))
        .addStringOption(o => o.setName("jeu").setDescription("Jeu (ex: SF6)").setRequired(true))
        .addIntegerOption(o =>
          o
            .setName("firstto")
            .setDescription("First to X (ex: 3, 5)")
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(20)
        )
    )
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: commands }
  );
  console.log("✅ Slash commands déployées");
})();
