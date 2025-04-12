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
} = require('discord.js');
const fs = require('fs-extra');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
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

// Format settings with custom emoji
const formatSettings = (settings) => {
  return `⚙️ Settings:\n       Text: ${settings.text || 'Not selected'}\n       Delay: ${
    settings.delay ? settings.delay / 1000 : 'Not selected'
  } s\n       Count: ${settings.count || 'Not selected'}`;
};

const formatAdminSettings = (settings) => {
  return `⚙️ Admin Settings:\n       Status: ${settings.status || 'Not selected'}\n       Activity type: ${
    settings.activityType || 'Not selected'
  }\n       Activity text: ${settings.activityText || 'Not selected'}\n       Emoji: ${
    settings.emoji || 'Not selected'
  }`;
};

// Optimized async message sending
const sendMessage = async (rest, interactionToken, channelId, content, replyMessageId) => {
  try {
    await rest.post(Routes.webhook(CLIENT_ID, interactionToken), {
      body: {
        content,
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

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), {
      body: [floodCommand.toJSON(), adminCommand.toJSON()],
    });
    console.log('Slash commands registered successfully');
  } catch (error) {
    console.error('Error registering commands:', error.message);
    console.error('Check if BOT_TOKEN and CLIENT_ID are correct and if the bot has permission to register commands.');
    process.exit(1);
  }
});

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

    let settings = client.floodSettings.get(interaction.user.id) || {
      delay: null,
      count: null,
    };

    settings = {
      ...settings,
      text,
      replyTo: 'invisible', // Static setting
      channelId: interaction.channelId,
      interactionToken: interaction.token,
    };

    await updateFloodSettings(interaction.user.id, settings);

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
        new StringSelectMenuOptionBuilder().setLabel('5').setValue('5'),
      );

    const startButton = new ButtonBuilder()
      .setCustomId('start_flood')
      .setLabel('Start Flood')
      .setStyle(ButtonStyle.Primary);

    const row1 = new ActionRowBuilder().addComponents(delayMenu);
    const row2 = new ActionRowBuilder().addComponents(countMenu);
    const row3 = new ActionRowBuilder().addComponents(startButton);

    await interaction.reply({
      content: formatSettings(settings),
      components: [row1, row2, row3],
      ephemeral: true,
    });
  }

  // Handle /admin command
  if (interaction.isCommand() && interaction.commandName === 'admin') {
    if (!adminList.has(interaction.user.id)) {
      await interaction.reply({
        content: 'Error: No access!',
        ephemeral: true,
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'add') {
      const userId = interaction.options.getString('user_id');

      if (!/^\d{17,19}$/.test(userId)) {
        await interaction.reply({
          content: 'Error: Invalid user ID!',
          ephemeral: true,
        });
        return;
      }

      if (adminList.has(userId)) {
        await interaction.reply({
          content: `User ID ${userId} is already an admin`,
          ephemeral: true,
        });
        return;
      }

      adminList.add(userId);
      await interaction.reply({
        content: `Added user ID ${userId} as admin`,
        ephemeral: true,
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
        ephemeral: true,
      });
    }
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
      ephemeral: true,
    });
  }

  // Handle delay selection for /lame
  if (interaction.isStringSelectMenu() && interaction.customId === 'select_delay') {
    const delay = parseInt(interaction.values[0]);
    const settings = client.floodSettings.get(interaction.user.id);
    settings.delay = delay;
    await updateFloodSettings(interaction.user.id, settings);

    await interaction.update({
      content: formatSettings(settings),
      components: interaction.message.components,
      ephemeral: true,
    });
  }

  // Handle count selection for /lame
  if (interaction.isStringSelectMenu() && interaction.customId === 'select_count') {
    const count = parseInt(interaction.values[0]);
    const settings = client.floodSettings.get(interaction.user.id);
    settings.count = count;
    await updateFloodSettings(interaction.user.id, settings);

    await interaction.update({
      content: formatSettings(settings),
      components: interaction.message.components,
      ephemeral: true,
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
      ephemeral: true,
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
      ephemeral: true,
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
        ephemeral: true,
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
        ephemeral: true,
      });
    } catch (error) {
      await interaction.update({
        content: `${formatAdminSettings(settings)}\nError: ${error.message}`,
        components: interaction.message.components,
        ephemeral: true,
      });
      return;
    }

    client.adminSettings.delete(interaction.user.id);
    await saveSettings(adminSettingsFile, Object.fromEntries(client.adminSettings));
  }

  // Handle flood start for /lame
  if (interaction.isButton() && interaction.customId === 'start_flood') {
    const settings = client.floodSettings.get(interaction.user.id);

    if (!settings.delay || !settings.count) {
      await interaction.update({
        content: `${formatSettings(settings)}\nError: Please select all settings!`,
        components: interaction.message.components,
        ephemeral: true,
      });
      return;
    }

    const { text, delay, count, replyTo, channelId, interactionToken } = settings;

    await interaction.update({
      content: `${formatSettings(settings)}\nSpamming...`,
      components: [],
      ephemeral: true,
    });

    const rest = new REST({ version: '10' }).setToken(TOKEN);
    let sentCount = 0;
    let followUpCount = 0;
    const replyMessageId = interaction.message.id; // Always invisible

    // Parallel message sending
    const sendBatch = async (batch) => {
      const promises = batch.map(() => sendMessage(rest, interactionToken, channelId, text, replyMessageId));
      const results = await Promise.all(promises);
      return results.filter((success) => success).length;
    };

    // Split into batches to avoid overwhelming API
    const batchSize = 5;
    for (let i = 0; i < count; i += batchSize) {
      const batchCount = Math.min(batchSize, count - i);
      const batch = Array(batchCount).fill(null);
      try {
        sentCount += await sendBatch(batch);
        if (delay >= 500) {
          await new Promise((resolve) => setTimeout(resolve, delay * batchCount));
        }
      } catch (error) {
        console.error('Error in batch:', error);
        if (followUpCount < 5) {
          await interaction.followUp({
            content: `${formatSettings(settings)}\nError: ${error.message}`,
            ephemeral: true,
          });
          followUpCount++;
        }
        break;
      }
    }

    if (followUpCount < 5) {
      await interaction.followUp({
        content: `${formatSettings(settings)}\nSpam completed: Sent ${sentCount} messages`,
        ephemeral: true,
      });
    } else {
      console.log('Follow-up limit reached, skipping completion message');
    }

    client.floodSettings.delete(interaction.user.id);
    await saveSettings(floodSettingsFile, Object.fromEntries(client.floodSettings));
  }
});

client.login(TOKEN);
