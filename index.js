require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Events,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

// Emojis configurables via .env (unicode ou emoji serveur : EMOJI_*_NAME + EMOJI_*_ID)
const emojiFtFin = process.env.EMOJI_FT_FIN_ID && process.env.EMOJI_FT_FIN_NAME
  ? `<:${process.env.EMOJI_FT_FIN_NAME}:${process.env.EMOJI_FT_FIN_ID}>`
  : (process.env.EMOJI_FT_FIN || "🏁");
const emojiError = process.env.EMOJI_ERROR_ID && process.env.EMOJI_ERROR_NAME
  ? `<:${process.env.EMOJI_ERROR_NAME}:${process.env.EMOJI_ERROR_ID}>`
  : (process.env.EMOJI_ERROR || "❌");
const emojiLocked = process.env.EMOJI_LOCKED_ID && process.env.EMOJI_LOCKED_NAME
  ? `<:${process.env.EMOJI_LOCKED_NAME}:${process.env.EMOJI_LOCKED_ID}>`
  : (process.env.EMOJI_LOCKED || "🔒");
const emojiReady = process.env.EMOJI_READY_ID && process.env.EMOJI_READY_NAME
  ? `<:${process.env.EMOJI_READY_NAME}:${process.env.EMOJI_READY_ID}>`
  : (process.env.EMOJI_READY || "✅");

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  partials: [Partials.Channel],
});

// Stockage en mémoire (simple). Pour du long terme => JSON/DB.
const matches = new Map();

// Insultes qui tournent à chaque fin de match pour le perdant
const variabledesbouffons = [
  "pouilleux", "crasseux", "nullos", "bouseux", "tocard", "bouffon", "naze", "perdant", "loser", "fumier",
];
let indexInsulte = 0;

function getMessageShame(perdantMention) {
  const bahahah = variabledesbouffons[indexInsulte % variabledesbouffons.length];
  indexInsulte++;
  return `${perdantMention} est aujourd'hui un gros ${bahahah}. Shame`;
}

/** Construit le message affiché quand un FT est terminé (avant ou après confirmation des scores). */
function getContentMatchTermine(match, options = {}) {
  const { finiAvantFirstTo = false } = options;
  const winner = match.score1 > match.score2 ? `<@${match.p1Id}>` : `<@${match.p2Id}>`;
  const loser = match.score1 > match.score2 ? `<@${match.p2Id}>` : `<@${match.p1Id}>`;
  const loserScore = match.score1 > match.score2 ? match.score2 : match.score1;
  const msgPerdant = match.score1 !== match.score2
    ? (loserScore === 0 ? `${loser} s'est fait kirkifier` : getMessageShame(loser))
    : null;

  if (finiAvantFirstTo) {
    let content = `**FT terminé manuellement.** Score final : **${match.score1} - ${match.score2}**`;
    content += "\nLe ft s'est terminé plus tôt, c'est un peu la honte mais azy..";
    if (msgPerdant) content += `\n${msgPerdant}`;
    return content;
  }
  return `${emojiFtFin} **FT terminé !** Gagnant : ${winner} (**${match.score1} - ${match.score2}**)\n${msgPerdant || ""}`;
}

function computeVotes(votesMap) {
  let v1 = 0, v2 = 0;
  for (const pick of votesMap.values()) {
    if (pick === "p1") v1++;
    if (pick === "p2") v2++;
  }
  return { v1, v2 };
}

function buildEmbed(match) {
  const { v1, v2 } = computeVotes(match.votes);
  const p1 = `<@${match.p1Id}>`;
  const p2 = `<@${match.p2Id}>`;

  const embed = new EmbedBuilder()
    .setTitle(`FT${match.firstTo} • ${match.jeu}`)
    .setDescription(`**Match :** ${p1} vs ${p2}`)
    .addFields(
      { name: "Score", value: `**${match.score1}** - **${match.score2}**`, inline: true },
      { name: "Votes", value: `${p1}: **${v1}**\n${p2}: **${v2}**`, inline: true }
    )
    .setFooter({ text: match.closed ? "FT terminé" : "Vote + score en cours" });

  return embed;
}

function buildRows(match) {
  const voteRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`vote:${match.id}:p1`)
      .setLabel("Vote Joueur 1")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(match.closed),
    new ButtonBuilder()
      .setCustomId(`vote:${match.id}:p2`)
      .setLabel("Vote Joueur 2")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(match.closed),
  );

  const scoreRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`score:${match.id}:p1`)
      .setLabel("+1 J1")
      .setStyle(ButtonStyle.Success)
      .setDisabled(match.closed),
    new ButtonBuilder()
      .setCustomId(`score:${match.id}:p2`)
      .setLabel("+1 J2")
      .setStyle(ButtonStyle.Success)
      .setDisabled(match.closed),
    new ButtonBuilder()
      .setCustomId(`end:${match.id}`)
      .setLabel("Terminer")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(match.closed),
  );

  const rows = [voteRow, scoreRow];
  if (match.closed && !match.confirmed) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`confirmScore:${match.id}`)
          .setLabel("Valider le score")
          .setStyle(ButtonStyle.Primary)
      )
    );
  }
  return rows;
}

client.once(Events.ClientReady, () => {
  console.log(`${emojiReady} Connecté en tant que ${client.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // Slash command /ft start
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName !== "ft") return;
      if (interaction.options.getSubcommand() !== "start") return;

      const p1 = interaction.options.getUser("joueur1", true);
      const p2 = interaction.options.getUser("joueur2", true);
      const jeu = interaction.options.getString("jeu", true);
      const firstTo = interaction.options.getInteger("firstto", true);

      if (p1.id === p2.id) {
        return interaction.reply({ content: `${emojiError} Les deux joueurs ne peuvent pas être identiques.`, ephemeral: true });
      }

      const id = `${Date.now()}_${interaction.id}`;

      const match = {
        id,
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        messageId: null,
        p1Id: p1.id,
        p2Id: p2.id,
        jeu,
        firstTo,
        score1: 0,
        score2: 0,
        votes: new Map(),
        closed: false,
      };

      matches.set(id, match);

      const roleId = process.env.PING_ROLE_ID;
      const ping = roleId ? `<@&${roleId}>` : "";

      const embed = buildEmbed(match);
      const rows = buildRows(match);

      const msg = await interaction.reply({
        content: ping ? `${ping} **Nouveau FT !**` : "**Nouveau FT !**",
        embeds: [embed],
        components: rows,
        fetchReply: true,
      });

      match.messageId = msg.id;
      return;
    }

    // Buttons
    if (interaction.isButton()) {
      const [kind, matchId, arg] = interaction.customId.split(":");
      const match = matches.get(matchId);

      if (!match) {
        return interaction.reply({ content: `${emojiError} Ce FT n’existe plus (ou le bot a redémarré).`, ephemeral: true });
      }

      if (match.closed && (kind !== "confirmScore" || match.confirmed)) {
        return interaction.reply({ content: `${emojiLocked} FT déjà terminé.`, ephemeral: true });
      }

      // Vote
      if (kind === "vote") {
        // arg = p1 | p2
        match.votes.set(interaction.user.id, arg);
        const embed = buildEmbed(match);
        const rows = buildRows(match);

        await interaction.update({ embeds: [embed], components: rows });
        return;
      }

      // Score
      if (kind === "score") {
        // Optionnel: restreindre aux joueurs uniquement
        const isPlayer = interaction.user.id === match.p1Id || interaction.user.id === match.p2Id;
        if (!isPlayer) {
          return interaction.reply({ content: `${emojiError} Seuls les joueurs peuvent modifier le score.`, ephemeral: true });
        }

        if (arg === "p1") match.score1++;
        if (arg === "p2") match.score2++;

        // Check win condition
        if (match.score1 >= match.firstTo || match.score2 >= match.firstTo) {
          match.closed = true;
          match.confirmations = new Map();
          match.confirmed = false;
          match.contentFinal = getContentMatchTermine(match, { finiAvantFirstTo: false });
        }

        const embed = buildEmbed(match);
        const rows = buildRows(match);

        let content = match.closed ? match.contentFinal : undefined;
        await interaction.update({ content, embeds: [embed], components: rows });
        return;
      }

      // End
      if (kind === "end") {
        // Optionnel: restreindre aux joueurs
        const isPlayer = interaction.user.id === match.p1Id || interaction.user.id === match.p2Id;
        if (!isPlayer) {
          return interaction.reply({ content: `${emojiError} Seuls les joueurs peuvent terminer le FT.`, ephemeral: true });
        }

        match.closed = true;
        const finiAvantFirstTo = match.score1 < match.firstTo && match.score2 < match.firstTo;
        match.finiAvantFirstTo = finiAvantFirstTo;
        match.confirmations = new Map();
        match.confirmed = false;
        match.contentFinal = getContentMatchTermine(match, { finiAvantFirstTo });

        const embed = buildEmbed(match);
        const rows = buildRows(match);

        await interaction.update({
          content: match.contentFinal,
          embeds: [embed],
          components: rows,
        });
        return;
      }

      // Valider le score (confirmation par les deux joueurs)
      if (kind === "confirmScore") {
        const isPlayer = interaction.user.id === match.p1Id || interaction.user.id === match.p2Id;
        if (!isPlayer) {
          return interaction.reply({ content: `${emojiError} Seuls les joueurs du FT peuvent valider le score.`, ephemeral: true });
        }
        if (match.confirmed) {
          return interaction.reply({ content: `${emojiLocked} Les scores sont déjà confirmés.`, ephemeral: true });
        }

        const modal = new ModalBuilder()
          .setCustomId(`confirmScoreModal:${match.id}`)
          .setTitle("Confirmer le score");
        const row1 = new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("score1")
            .setLabel("Score Joueur 1")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(`${match.score1}`)
            .setValue(String(match.score1))
            .setMaxLength(3)
        );
        const row2 = new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("score2")
            .setLabel("Score Joueur 2")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(`${match.score2}`)
            .setValue(String(match.score2))
            .setMaxLength(3)
        );
        modal.addComponents(row1, row2);
        await interaction.showModal(modal);
        return;
      }
    }

    // Soumission du modal de confirmation de score
    if (interaction.isModalSubmit()) {
      const customId = interaction.customId;
      if (!customId.startsWith("confirmScoreModal:")) return;
      const matchId = customId.slice("confirmScoreModal:".length);
      const match = matches.get(matchId);
      if (!match || !match.closed || match.confirmed) return;

      const s1 = interaction.fields.getTextInputValue("score1").trim();
      const s2 = interaction.fields.getTextInputValue("score2").trim();
      const score1 = parseInt(s1, 10) || 0;
      const score2 = parseInt(s2, 10) || 0;

      match.confirmations.set(interaction.user.id, { score1, score2 });

      const p1Done = match.confirmations.has(match.p1Id);
      const p2Done = match.confirmations.has(match.p2Id);

      if (!p1Done || !p2Done) {
        await interaction.reply({
          content: `Tu as envoyé **${score1} - ${score2}**. En attente de la confirmation de l'autre joueur.`,
          ephemeral: true,
        });
        return;
      }

      const c1 = match.confirmations.get(match.p1Id);
      const c2 = match.confirmations.get(match.p2Id);
      const same = c1.score1 === c2.score1 && c1.score2 === c2.score2;

      const channel = await client.channels.fetch(match.channelId).catch(() => null);
      if (!channel) return;

      const msg = await channel.messages.fetch(match.messageId).catch(() => null);
      if (!msg) return;

      if (same) {
        match.score1 = c1.score1;
        match.score2 = c1.score2;
        match.contentFinal = getContentMatchTermine(match, { finiAvantFirstTo: match.finiAvantFirstTo ?? false });
        match.confirmed = true;
      }

      const embed = buildEmbed(match);
      let content = match.contentFinal;

      if (same) {
        content += "\n\n✅ **Scores confirmés par les deux joueurs.**";
      } else {
        match.confirmations.clear();
        content += "\n\nBon faut se mettre d'accord. Y'a un imposteur dans le FT là.";
      }

      const rows = buildRows(match);
      await msg.edit({ content, embeds: [embed], components: rows });

      await interaction.reply({
        content: same ? "Score confirmé." : "Les deux joueurs n'ont pas donné le même score. Recommencez.",
        ephemeral: true,
      });
      return;
    }
  } catch (err) {
    console.error(err);
    if (interaction.isRepliable()) {
      try {
        await interaction.reply({ content: `${emojiError} Une erreur est survenue.`, ephemeral: true });
      } catch {}
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
