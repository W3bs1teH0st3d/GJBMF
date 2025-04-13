require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonBuilder,
  ButtonStyle,
  TextInputBuilder,
  TextInputStyle,
  ModalBuilder,
  REST,
  Routes,
  ActivityType,
  EmbedBuilder,
} = require('discord.js');
const fs = require('fs-extra');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

const TOKEN = (process.env.BOT_TOKEN || '').replace(/^"(.*)"$/, '$1');
const CLIENT_ID = (process.env.CLIENT_ID || '').replace(/^"(.*)"$/, '$1');

// List of admins
const adminList = new Set(['979011152795283456']);

// Check environment variables
if (!TOKEN || !CLIENT_ID) {
  console.error('Error: BOT_TOKEN or CLIENT_ID not specified in .env!');
  process.exit(1);
}

// Settings storage
const floodSettingsFile = './floodSettings.json';
const adminSettingsFile = './adminSettings.json';
const logFile = './zeroLogs.json';

const loadSettings = async (file) => {
  try {
    return await fs.readJson(file);
  } catch (error) {
    return {};
  }
};

const saveSettings = async (file, data) => {
  try {
    await fs.writeJson(file, data);
  } catch (error) {
    console.error('Error saving settings:', error);
  }
};

const updateFloodSettings = async (userId, settings) => {
  client.floodSettings.set(userId, settings);
  await saveSettings(floodSettingsFile, Object.fromEntries(client.floodSettings));
};

const updateAdminSettings = async (userId, settings) => {
  client.adminSettings.set(userId, settings);
  await saveSettings(adminSettingsFile, Object.fromEntries(client.adminSettings));
};

// Логирование спама
const logSpam = async (userId, channelId, guildId) => {
  const log = {
    timestamp: new Date().toISOString(),
    from: userId,
    to: channelId,
    in: guildId || 'DMs',
  };
  const logs = await loadSettings(logFile);
  logs.logs = logs.logs || [];
  logs.logs.push(log);
  await saveSettings(logFile, logs);
};

// Форматирование настроек для эмбеда
const formatSettingsEmbed = (settings) => {
  const fields = [
    { name: 'Text', value: settings.text || 'Not selected', inline: true },
    { name: 'Delay', value: settings.delay ? `${settings.delay / 1000}s` : 'Not selected', inline: true },
    { name: 'Count', value: settings.count ? `${settings.count}` : 'Not selected', inline: true },
    { name: 'Where', value: settings.where || 'Not selected', inline: true },
  ];

  if (settings.where === 'dms') {
    fields.push({ name: 'User ID', value: settings.userId || 'Not selected', inline: true });
  }
  if (settings.embedTitle) {
    fields.push({ name: 'Embed Title', value: settings.embedTitle || 'Not set', inline: true });
  }
  if (settings.embedDescription) {
    fields.push({ name: 'Embed Description', value: settings.embedDescription || 'Not set', inline: true });
  }

  return new EmbedBuilder()
    .setColor(settings.color || 0x0099ff)
    .setTitle('📬 Spam Settings')
    .setDescription('Edit your settings here')
    .addFields(fields)
    .setFooter({ text: 'Zero.Lame | Settings menu' });
};

const formatAdminSettings = (settings) => {
  return `<:zerotiss:1360564817907421324> Admin Settings:\n       Status: ${settings.status || 'Not selected'}\n       Activity type: ${
    settings.activityType || 'Not selected'
  }\n       Activity text: ${settings.activityText || 'Not selected'}\n       Emoji: ${
    settings.emoji || 'Not selected'
  }`;
};

// Create DM channel for a user
const createDMChannel = async (rest, userId, client) => {
  try {
    console.log(`Attempting to create DM channel via REST API for user ${userId}`);
    const dmChannel = await rest.post(Routes.userChannels(), {
      body: { recipient_id: userId },
    });
    if (!dmChannel.id) throw new Error('Failed to retrieve DM channel ID');
    console.log(`DM channel created via REST API: ${dmChannel.id}`);
    return dmChannel.id;
  } catch (error) {
    console.error(`REST API DM creation failed for user ${userId}:`, error);
    console.error(`Error code: ${error.code}, message: ${error.message}`);
  }

  try {
    console.log(`Checking guilds for user ${userId}`);
    for (const guild of client.guilds.cache.values()) {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (member) {
        const dmChannel = await member.createDM();
        if (!dmChannel.id) throw new Error('Failed to create DM channel via server');
        console.log(`DM channel created via guild ${guild.id}: ${dmChannel.id}`);
        return dmChannel.id;
      }
    }
  } catch (error) {
    console.error(`Server DM creation failed for user ${userId}:`, error);
  }

  try {
    console.log(`Attempting to fetch user ${userId} directly`);
    const user = await client.users.fetch(userId);
    const dmChannel = await user.createDM();
    if (!dmChannel.id) throw new Error('Failed to create DM channel via user fetch');
    console.log(`DM channel created via user fetch: ${dmChannel.id}`);
    return dmChannel.id;
  } catch (error) {
    console.error(`User fetch DM creation failed for user ${userId}:`, error);
  }

  throw new Error('User not found or message cannot be delivered.');
};

// Optimized async message sending for chat
const sendMessage = async (rest, interactionToken, channelId, content, replyMessageId, embed) => {
  try {
    await rest.post(Routes.webhook(CLIENT_ID, interactionToken), {
      body: {
        content: embed ? undefined : content,
        embeds: embed ? [embed] : undefined,
        message_reference: replyMessageId
          ? { message_id: replyMessageId, channel_id: channelId, fail_if_not_exists: false }
          : undefined,
        flags: 0,
      },
    });
    return true;
  } catch (error) {
    if (error.code === 429) {
      const retryAfter = error.retry_after || 500;
      await new Promise((resolve) => setTimeout(resolve, retryAfter));
      return false;
    }
    throw error;
  }
};

// Message sending for DMs
const sendMessageDM = async (rest, channelId, content, embed) => {
  if (!channelId) throw new Error('Channel ID is undefined');
  try {
    await rest.post(Routes.channelMessages(channelId), {
      body: {
        content: embed ? undefined : content,
        embeds: embed ? [embed] : undefined,
      },
    });
    return true;
  } catch (error) {
    if (error.code === 429) {
      const retryAfter = error.retry_after || 500;
      await new Promise((resolve) => setTimeout(resolve, retryAfter));
      return false;
    }
    throw error;
  }
};

// Register slash commands
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  client.floodSettings = new Map(Object.entries(await loadSettings(floodSettingsFile)));
  client.adminSettings = new Map(Object.entries(await loadSettings(adminSettingsFile)));

  const floodCommand = new SlashCommandBuilder()
    .setName('lame')
    .setDescription('Configure spam settings')
    .setIntegrationTypes([1]) // User Install
    .addStringOption((option) =>
      option.setName('text').setDescription('Text for spam').setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('where')
        .setDescription('Where to send messages: chat or dms')
        .setRequired(true)
        .addChoices(
          { name: 'Chat', value: 'chat' },
          { name: 'DMs', value: 'dms' }
        )
    )
    .addStringOption((option) =>
      option.setName('embed_title').setDescription('Title for embed (optional)').setRequired(false)
    )
    .addStringOption((option) =>
      option.setName('embed_description').setDescription('Description for embed (optional)').setRequired(false)
    )
    .addStringOption((option) =>
      option.setName('embed_color').setDescription('Hex color for embed (e.g., #FF0000)').setRequired(false)
    );

  const adminCommand = new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Admin-only commands')
    .setIntegrationTypes([1]) // User Install
    .setDefaultMemberPermissions(0)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('add')
        .setDescription('Add a new admin')
        .addStringOption((option) =>
          option.setName('user_id').setDescription('User ID to add').setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('settings').setDescription('Change bot status')
    );

  const logsCommand = new SlashCommandBuilder()
    .setName('logs')
    .setDescription('View spam logs (admin only)')
    .setIntegrationTypes([1]) // User Install
    .setDefaultMemberPermissions(0);

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), {
      body: [floodCommand.toJSON(), adminCommand.toJSON(), logsCommand.toJSON()],
    });
    console.log('Slash commands registered successfully');
  } catch (error) {
    console.error('Error registering commands:', error.message);
    console.error('Check if BOT_TOKEN and CLIENT_ID are correct and if the bot has permission to register commands.');
    process.exit(1);
  }
});

// Show settings menu with embed
const showSettingsMenu = async (interaction, settings) => {
  const delayMenu = new StringSelectMenuBuilder()
    .setCustomId('select_delay')
    .setPlaceholder(settings.delay ? `${settings.delay / 1000}s` : 'Select delay')
    .addOptions(
      new StringSelectMenuOptionBuilder().setLabel('0.5s').setValue('500'),
      new StringSelectMenuOptionBuilder().setLabel('1s').setValue('1000'),
      new StringSelectMenuOptionBuilder().setLabel('1.5s').setValue('1500'),
      new StringSelectMenuOptionBuilder().setLabel('2s').setValue('2000'),
      new StringSelectMenuOptionBuilder().setLabel('3s').setValue('3000'),
      new StringSelectMenuOptionBuilder().setLabel('5s').setValue('5000')
    );

  const countMenu = new StringSelectMenuBuilder()
    .setCustomId('select_count')
    .setPlaceholder(settings.count ? `${settings.count}` : 'Select count')
    .addOptions(
      new StringSelectMenuOptionBuilder().setLabel('1').setValue('1'),
      new StringSelectMenuOptionBuilder().setLabel('2').setValue('2'),
      new StringSelectMenuOptionBuilder().setLabel('3').setValue('3'),
      new StringSelectMenuOptionBuilder().setLabel('4').setValue('4'),
      new StringSelectMenuOptionBuilder().setLabel('5').setValue('5')
    );

  const startButton = new ButtonBuilder()
    .setCustomId('start_flood')
    .setLabel('Start Flood')
    .setStyle(ButtonStyle.Primary);

  const row1 = new ActionRowBuilder().addComponents(delayMenu);
  const row2 = new ActionRowBuilder().addComponents(countMenu);
  const row3 = new ActionRowBuilder().addComponents(startButton);

  await interaction.reply({
    embeds: [formatSettingsEmbed(settings)],
    components: [row1, row2, row3],
    flags: 1 << 6, // Ephemeral
  });
};

// Handle interactions
client.on('interactionCreate', async (interaction) => {
  if (
    !interaction.isCommand() &&
    !interaction.isStringSelectMenu() &&
    !interaction.isButton() &&
    !interaction.isModalSubmit()
  )
    return;

  // Handle /lame command
  if (interaction.isCommand() && interaction.commandName === 'lame') {
    const text = interaction.options.getString('text');
    const where = interaction.options.getString('where');
    const embedTitle = interaction.options.getString('embed_title');
    const embedDescription = interaction.options.getString('embed_description');
    const embedColor = interaction.options.getString('embed_color');

    let settings = client.floodSettings.get(interaction.user.id) || {
      delay: null,
      count: null,
      userId: null,
      where: null,
      text: null,
      embedTitle: null,
      embedDescription: null,
      color: null,
    };

    settings = {
      ...settings,
      text,
      where,
      replyTo: where === 'chat' ? 'invisible' : null,
      channelId: where === 'chat' ? interaction.channelId : null,
      interactionToken: interaction.token,
      embedTitle,
      embedDescription,
      color: embedColor ? parseInt(embedColor.replace('#', ''), 16) : null,
      guildId: interaction.guildId, // Для логов
    };

    await updateFloodSettings(interaction.user.id, settings);

    if (where === 'dms') {
      const modal = new ModalBuilder()
        .setCustomId('user_id_modal')
        .setTitle('Enter User ID');

      const userIdInput = new TextInputBuilder()
        .setCustomId('user_id')
        .setLabel('User ID to send DMs to')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Enter a valid user ID (e.g., 123456789012345678)')
        .setRequired(true);

      const row = new ActionRowBuilder().addComponents(userIdInput);
      modal.addComponents(row);

      await interaction.showModal(modal);
    } else {
      await showSettingsMenu(interaction, settings);
    }
  }

  // Handle user_id modal for DMs
  if (interaction.isModalSubmit() && interaction.customId === 'user_id_modal') {
    const userId = interaction.fields.getTextInputValue('user_id');

    if (!/^\d{17,19}$/.test(userId)) {
      await interaction.reply({
        content: 'Error: Invalid User ID! Please enter a valid Discord User ID.',
        flags: 1 << 6, // Ephemeral
      });
      return;
    }

    let settings = client.floodSettings.get(interaction.user.id);
    if (!settings) {
      await interaction.reply({
        content: 'Error: Settings not found. Please restart the command.',
        flags: 1 << 6, // Ephemeral
      });
      return;
    }

    settings.userId = userId;
    await updateFloodSettings(interaction.user.id, settings);

    await showSettingsMenu(interaction, settings);
  }

  // Handle /admin command
  if (interaction.isCommand() && interaction.commandName === 'admin') {
    if (!adminList.has(interaction.user.id)) {
      await interaction.reply({
        content: 'Error: No access!',
        flags: 1 << 6, // Ephemeral
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'add') {
      const userId = interaction.options.getString('user_id');

      if (!/^\d{17,19}$/.test(userId)) {
        await interaction.reply({
          content: 'Error: Invalid user ID!',
          flags: 1 << 6, // Ephemeral
        });
        return;
      }

      if (adminList.has(userId)) {
        await interaction.reply({
          content: `User ID ${userId} is already an admin`,
          flags: 1 << 6, // Ephemeral
        });
        return;
      }

      adminList.add(userId);
      await interaction.reply({
        content: `Added user ID ${userId} as admin`,
        flags: 1 << 6, // Ephemeral
      });
      return;
    }

    if (subcommand === 'settings') {
      let settings = client.adminSettings.get(interaction.user.id) || {
        status: null,
        activityType: null,
        activityText: null,
        emoji: null,
      };

      await updateAdminSettings(interaction.user.id, settings);

      const statusMenu = new StringSelectMenuBuilder()
        .setCustomId('select_status')
        .setPlaceholder('Select status')
        .addOptions(
          new StringSelectMenuOptionBuilder().setLabel('Online').setValue('online'),
          new StringSelectMenuOptionBuilder().setLabel('Offline').setValue('offline'),
          new StringSelectMenuOptionBuilder().setLabel('Do Not Disturb').setValue('dnd'),
          new StringSelectMenuOptionBuilder().setLabel('Invisible').setValue('invisible')
        );

      const activityTypeMenu = new StringSelectMenuBuilder()
        .setCustomId('select_activity_type')
        .setPlaceholder('Select activity type')
        .addOptions(
          new StringSelectMenuOptionBuilder().setLabel('Playing').setValue('Playing'),
          new StringSelectMenuOptionBuilder().setLabel('Watching').setValue('Watching'),
          new StringSelectMenuOptionBuilder().setLabel('Listening').setValue('Listening'),
          new StringSelectMenuOptionBuilder().setLabel('Streaming').setValue('Streaming')
        );

      const emojiMenu = new StringSelectMenuBuilder()
        .setCustomId('select_emoji')
        .setPlaceholder('Select emoji')
        .addOptions(
          new StringSelectMenuOptionBuilder().setLabel('Green').setValue('🟢'),
          new StringSelectMenuOptionBuilder().setLabel('Red').setValue('🔴'),
          new StringSelectMenuOptionBuilder().setLabel('Yellow').setValue('🟡'),
          new StringSelectMenuOptionBuilder().setLabel('Black').setValue('⚫')
        );

      const applyButton = new ButtonBuilder()
        .setCustomId('apply_admin_settings')
        .setLabel('Apply')
        .setStyle(ButtonStyle.Primary);

      const row1 = new ActionRowBuilder().addComponents(statusMenu);
      const row2 = new ActionRowBuilder().addComponents(activityTypeMenu);
      const row3 = new ActionRowBuilder().addComponents(emojiMenu);
      const row4 = new ActionRowBuilder().addComponents(applyButton);

      await interaction.reply({
        content: formatAdminSettings(settings),
        components: [row1, row2, row3, row4],
        flags: 1 << 6, // Ephemeral
      });
    }
  }

  // Handle /logs command
  if (interaction.isCommand() && interaction.commandName === 'logs') {
    if (!adminList.has(interaction.user.id)) {
      await interaction.reply({
        content: 'Error: No access!',
        flags: 1 << 6, // Ephemeral
      });
      return;
    }

    const logs = await loadSettings(logFile);
    const logEntries = logs.logs || [];
    if (logEntries.length === 0) {
      await interaction.reply({
        content: 'No spam logs found.',
        flags: 1 << 6, // Ephemeral
      });
      return;
    }

    const logText = logEntries
      .slice(-10) // Показываем последние 10 логов
      .map(
        (log) =>
          `Zero.Logs\nStarted Spam from: ${log.from}\nSpam to: ${log.to}\nSpam in: ${log.in}\nTimestamp: ${log.timestamp}`
      )
      .join('\n\n');

    await interaction.reply({
      content: logText || 'No recent logs.',
      flags: 1 << 6, // Ephemeral
    });
  }

  // Handle activity text modal for /admin
  if (interaction.isModalSubmit() && interaction.customId === 'activity_text_modal') {
    if (!adminList.has(interaction.user.id)) return;
    const activityText = interaction.fields.getTextInputValue('activity_text');

    const settings = client.adminSettings.get(interaction.user.id);
    settings.activityText = activityText;
    await updateAdminSettings(interaction.user.id, settings);

    const statusMenu = new StringSelectMenuBuilder()
      .setCustomId('select_status')
      .setPlaceholder('Select status')
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel('Online').setValue('online'),
        new StringSelectMenuOptionBuilder().setLabel('Offline').setValue('offline'),
        new StringSelectMenuOptionBuilder().setLabel('Do Not Disturb').setValue('dnd'),
        new StringSelectMenuOptionBuilder().setLabel('Invisible').setValue('invisible')
      );

    const activityTypeMenu = new StringSelectMenuBuilder()
      .setCustomId('select_activity_type')
      .setPlaceholder('Select activity type')
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel('Playing').setValue('Playing'),
        new StringSelectMenuOptionBuilder().setLabel('Watching').setValue('Watching'),
        new StringSelectMenuOptionBuilder().setLabel('Listening').setValue('Listening'),
        new StringSelectMenuOptionBuilder().setLabel('Streaming').setValue('Streaming')
      );

    const emojiMenu = new StringSelectMenuBuilder()
      .setCustomId('select_emoji')
      .setPlaceholder('Select emoji')
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel('Green').setValue('🟢'),
        new StringSelectMenuOptionBuilder().setLabel('Red').setValue('🔴'),
        new StringSelectMenuOptionBuilder().setLabel('Yellow').setValue('🟡'),
        new StringSelectMenuOptionBuilder().setLabel('Black').setValue('⚫')
      );

    const applyButton = new ButtonBuilder()
      .setCustomId('apply_admin_settings')
      .setLabel('Apply')
      .setStyle(ButtonStyle.Primary);

    const row1 = new ActionRowBuilder().addComponents(statusMenu);
    const row2 = new ActionRowBuilder().addComponents(activityTypeMenu);
    const row3 = new ActionRowBuilder().addComponents(emojiMenu);
    const row4 = new ActionRowBuilder().addComponents(applyButton);

    await interaction.reply({
      content: formatAdminSettings(settings),
      components: [row1, row2, row3, row4],
      flags: 1 << 6, // Ephemeral
    });
  }

  // Handle delay selection for /lame
  if (interaction.isStringSelectMenu() && interaction.customId === 'select_delay') {
    const delay = parseInt(interaction.values[0]);
    const settings = client.floodSettings.get(interaction.user.id);
    if (!settings) {
      await interaction.reply({
        content: 'Error: Settings not found. Please restart the command.',
        flags: 1 << 6, // Ephemeral
      });
      return;
    }
    settings.delay = delay;
    await updateFloodSettings(interaction.user.id, settings);

    await interaction.update({
      embeds: [formatSettingsEmbed(settings)],
      components: interaction.message.components,
      flags: 1 << 6, // Ephemeral
    });
  }

  // Handle count selection for /lame
  if (interaction.isStringSelectMenu() && interaction.customId === 'select_count') {
    const count = parseInt(interaction.values[0]);
    const settings = client.floodSettings.get(interaction.user.id);
    if (!settings) {
      await interaction.reply({
        content: 'Error: Settings not found. Please restart the command.',
        flags: 1 << 6, // Ephemeral
      });
      return;
    }
    settings.count = count;
    await updateFloodSettings(interaction.user.id, settings);

    await interaction.update({
      embeds: [formatSettingsEmbed(settings)],
      components: interaction.message.components,
      flags: 1 << 6, // Ephemeral
    });
  }

  // Handle status selection for /admin
  if (interaction.isStringSelectMenu() && interaction.customId === 'select_status') {
    if (!adminList.has(interaction.user.id)) return;
    const status = interaction.values[0];
    const settings = client.adminSettings.get(interaction.user.id);
    settings.status = status;
    await updateAdminSettings(interaction.user.id, settings);

    await interaction.update({
      content: formatAdminSettings(settings),
      components: interaction.message.components,
      flags: 1 << 6, // Ephemeral
    });
  }

  // Handle activity type selection for /admin
  if (interaction.isStringSelectMenu() && interaction.customId === 'select_activity_type') {
    if (!adminList.has(interaction.user.id)) return;
    const activityType = interaction.values[0];
    const settings = client.adminSettings.get(interaction.user.id);
    settings.activityType = activityType;
    await updateAdminSettings(interaction.user.id, settings);

    const modal = new ModalBuilder()
      .setCustomId('activity_text_modal')
      .setTitle('Activity Text');

    const textInput = new TextInputBuilder()
      .setCustomId('activity_text')
      .setLabel('Activity text')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Enter activity text')
      .setRequired(true);

    const row = new ActionRowBuilder().addComponents(textInput);
    modal.addComponents(row);

    await interaction.showModal(modal);
  }

  // Handle emoji selection for /admin
  if (interaction.isStringSelectMenu() && interaction.customId === 'select_emoji') {
    if (!adminList.has(interaction.user.id)) return;
    const emoji = interaction.values[0];
    const settings = client.adminSettings.get(interaction.user.id);
    settings.emoji = emoji;
    await updateAdminSettings(interaction.user.id, settings);

    await interaction.update({
      content: formatAdminSettings(settings),
      components: interaction.message.components,
      flags: 1 << 6, // Ephemeral
    });
  }

  // Handle apply settings for /admin
  if (interaction.isButton() && interaction.customId === 'apply_admin_settings') {
    if (!adminList.has(interaction.user.id)) return;
    const settings = client.adminSettings.get(interaction.user.id);

    if (!settings.status || !settings.activityType || !settings.activityText || !settings.emoji) {
      await interaction.update({
        content: `${formatAdminSettings(settings)}\nError: Please select all settings!`,
        components: interaction.message.components,
        flags: 1 << 6, // Ephemeral
      });
      return;
    }

    try {
      const activityTypes = {
        Playing: ActivityType.Playing,
        Watching: ActivityType.Watching,
        Listening: ActivityType.Listening,
        Streaming: ActivityType.Streaming,
      };

      client.user.setPresence({
        status: settings.status,
        activities: [{ name: `${settings.emoji} ${settings.activityText}`, type: activityTypes[settings.activityType] }],
      });

      await interaction.update({
        content: `${formatAdminSettings(settings)}\nSettings applied successfully`,
        components: [],
        flags: 1 << 6, // Ephemeral
      });
    } catch (error) {
      await interaction.update({
        content: `${formatAdminSettings(settings)}\nError: ${error.message}`,
        components: interaction.message.components,
        flags: 1 << 6, // Ephemeral
      });
      return;
    }

    client.adminSettings.delete(interaction.user.id);
    await saveSettings(adminSettingsFile, Object.fromEntries(client.adminSettings));
  }

  // Handle flood start for /lame
  if (interaction.isButton() && interaction.customId === 'start_flood') {
    const settings = client.floodSettings.get(interaction.user.id);
    if (!settings) {
      await interaction.reply({
        content: 'Error: Settings not found. Please restart the command.',
        flags: 1 << 6, // Ephemeral
      });
      return;
    }

    if (!settings.delay || !settings.count) {
      await interaction.update({
        embeds: [formatSettingsEmbed(settings).setDescription('Error: Please select all settings!')],
        components: interaction.message.components,
        flags: 1 << 6, // Ephemeral
      });
      return;
    }

    if (settings.where === 'dms' && !settings.userId) {
      await interaction.update({
        embeds: [formatSettingsEmbed(settings).setDescription('Error: User ID is required for DMs!')],
        components: [],
        flags: 1 << 6, // Ephemeral
      });
      return;
    }

    const { text, delay, count, where, userId, channelId: initialChannelId, interactionToken, embedTitle, embedDescription, color, guildId } = settings;
    let channelId = initialChannelId;
    let replyMessageId = where === 'chat' ? interaction.message.id : null;

    const rest = new REST({ version: '10' }).setToken(TOKEN);

    // Создание эмбеда, если указаны параметры
    let embed = null;
    if (embedTitle || embedDescription) {
      embed = new EmbedBuilder()
        .setColor(color || 0x0099ff)
        .setTitle(embedTitle || null)
        .setDescription(embedDescription || text);
    }

    // For DMs, create or get DM channel
    if (where === 'dms') {
      try {
        channelId = await createDMChannel(rest, userId, client);
        settings.channelId = channelId;
        await updateFloodSettings(interaction.user.id, settings);
      } catch (error) {
        await interaction.update({
          embeds: [formatSettingsEmbed(settings).setDescription(`Error: ${error.message}`)],
          components: [],
          flags: 1 << 6, // Ephemeral
        });
        return;
      }
    }

    // Логирование начала спама
    await logSpam(interaction.user.id, channelId, guildId);

    await interaction.update({
      embeds: [formatSettingsEmbed(settings).setDescription('Spamming...')],
      components: [],
      flags: 1 << 6, // Ephemeral
    });

    let sentCount = 0;
    let followUpCount = 0;

    // Parallel message sending (ограничено 5 follow-ups)
    const sendBatch = async (batch) => {
      const promises = batch.map(() =>
        where === 'chat'
          ? sendMessage(rest, interactionToken, channelId, text, replyMessageId, embed)
          : sendMessageDM(rest, channelId, text, embed)
      );
      const results = await Promise.all(promises);
      return results.filter((success) => success).length;
    };

    // Ограничение до 5 сообщений
    const maxMessages = Math.min(count, 5);
    try {
      sentCount += await sendBatch(Array(maxMessages).fill(null));
      if (delay >= 500) {
        await new Promise((resolve) => setTimeout(resolve, delay * maxMessages));
      }
    } catch (error) {
      console.error('Error in batch:', error);
      if (followUpCount < 5) {
        await interaction.followUp({
          embeds: [formatSettingsEmbed(settings).setDescription(`Error: ${error.message}`)],
          flags: 1 << 6, // Ephemeral
        });
        followUpCount++;
      }
    }

    if (followUpCount < 5) {
      await interaction.followUp({
        embeds: [formatSettingsEmbed(settings).setDescription(`Spam completed: Sent ${sentCount} messages`)],
        flags: 1 << 6, // Ephemeral
      });
    } else {
      console.log('Follow-up limit reached, skipping completion message');
    }

    client.floodSettings.delete(interaction.user.id);
    await saveSettings(floodSettingsFile, Object.fromEntries(client.floodSettings));
  }
});

client.login(TOKEN);
