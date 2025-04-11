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

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

console.log("🔍 BOT_TOKEN:", process.env.BOT_TOKEN);
console.log("🔍 CLIENT_ID:", process.env.CLIENT_ID);
const TOKEN = (process.env.BOT_TOKEN || '').replace(/^"(.*)"$/, '$1');
const CLIENT_ID = (process.env.CLIENT_ID || '').replace(/^"(.*)"$/, '$1');

// Список админов (начальный админ)
const adminList = new Set(['979011152795283456']);

// Проверка переменных окружения
if (!TOKEN || !CLIENT_ID) {
  console.error('Ошибка: BOT_TOKEN или CLIENT_ID не указаны в .env!');
  process.exit(1);
}

// Helper function to format settings display for /lame
const formatSettings = (settings) => {
  return `Settings:\nText: ${settings.text || 'Not selected'}\nDelay: ${
    settings.delay ? settings.delay / 1000 : 'Not selected'
  } s\nCount: ${settings.count || 'Not selected'}\nAnswer to: ${
    settings.replyTo === 'invisible'
      ? 'Hide name'
      : settings.replyTo === 'custom' && settings.customMessageId
      ? settings.customMessageId
      : 'Not selected'
  }`;
};

// Helper function to format admin settings display
const formatAdminSettings = (settings) => {
  return `Настройки админа:\nСтатус: ${settings.status || 'Не выбрано'}\nТип активности: ${
    settings.activityType || 'Не выбрано'
  }\nТекст активности: ${settings.activityText || 'Не выбрано'}\nЭмодзи: ${settings.emoji || 'Не выбрано'}`;
};

// Регистрация глобальных слеш-команд
client.once('ready', async () => {
  console.log(`Залогинился как ${client.user.tag}`);

  const floodCommand = new SlashCommandBuilder()
    .setName('lame')
    .setDescription('Settings spam')
    .addStringOption((option) =>
      option
        .setName('text')
        .setDescription('Spam text')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('reply_to')
        .setDescription('Message ID responde')
        .setRequired(true)
        .addChoices(
          { name: 'Hide name', value: 'invisible' },
          { name: 'Custom ID', value: 'custom' }
        )
    );

  const adminCommand = new SlashCommandBuilder()
    .setName('admin')
    .setDescription('ONLY ADMIN')
    .setDefaultMemberPermissions(0) // Ограничиваем доступ
    .addSubcommand((subcommand) =>
      subcommand
        .setName('add')
        .setDescription('Add admin')
        .addStringOption((option) =>
          option
            .setName('user_id')
            .setDescription('Add admin')
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('settings').setDescription('Change status')
    );

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), {
      body: [floodCommand.toJSON(), adminCommand.toJSON()],
    });
    console.log('command registered');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
});

// Обработка взаимодействий
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
    const replyTo = interaction.options.getString('reply_to');

    if (replyTo === 'custom') {
      const modal = new ModalBuilder()
        .setCustomId('custom_message_id')
        .setTitle('Message ID');

      const messageIdInput = new TextInputBuilder()
        .setCustomId('message_id')
        .setLabel('Message ID to responde')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('123456789012345678')
        .setRequired(true);

      const row = new ActionRowBuilder().addComponents(messageIdInput);
      modal.addComponents(row);

      await interaction.showModal(modal);
      return;
    }

    interaction.client.floodSettings = interaction.client.floodSettings || new Map();
    interaction.client.floodSettings.set(interaction.user.id, {
      text,
      replyTo,
      delay: null,
      count: null,
      customMessageId: null,
      channelId: interaction.channelId,
      interactionToken: interaction.token,
    });

    const delayMenu = new StringSelectMenuBuilder()
      .setCustomId('select_delay')
      .setPlaceholder('select delay')
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel('1s').setValue('1000'),
        new StringSelectMenuOptionBuilder().setLabel('2s').setValue('2000'),
        new StringSelectMenuOptionBuilder().setLabel('5s').setValue('5000')
      );

    const countMenu = new StringSelectMenuBuilder()
      .setCustomId('select_count')
      .setPlaceholder('select count')
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel('1').setValue('1'),
        new StringSelectMenuOptionBuilder().setLabel('3').setValue('3'),
        new StringSelectMenuOptionBuilder().setLabel('5').setValue('5')
      );

    const startButton = new ButtonBuilder()
      .setCustomId('start_flood')
      .setLabel('Fl00d')
      .setStyle(ButtonStyle.Primary);

    const row1 = new ActionRowBuilder().addComponents(delayMenu);
    const row2 = new ActionRowBuilder().addComponents(countMenu);
    const row3 = new ActionRowBuilder().addComponents(startButton);

    await interaction.reply({
      content: formatSettings(interaction.client.floodSettings.get(interaction.user.id)),
      components: [row1, row2, row3],
      flags: 64,
    });
  }

  // Handle /admin command
  if (interaction.isCommand() && interaction.commandName === 'admin') {
    if (!adminList.has(interaction.user.id)) {
      await interaction.reply({
        content: 'Error: No access!',
        flags: 64,
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'add') {
      const userId = interaction.options.getString('user_id');

      if (!/^\d{17,19}$/.test(userId)) {
        await interaction.reply({
          content: 'Error: incorrect ID',
          flags: 64,
        });
        return;
      }

      if (adminList.has(userId)) {
        await interaction.reply({
          content: `=ID ${userId} already admin`,
          flags: 64,
        });
        return;
      }

      adminList.add(userId);
      await interaction.reply({
        content: `Added ${userId} admin`,
        flags: 64,
      });
      return;
    }

    if (subcommand === 'settings') {
      interaction.client.adminSettings = interaction.client.adminSettings || new Map();
      interaction.client.adminSettings.set(interaction.user.id, {
        status: null,
        activityType: null,
        activityText: null,
        emoji: null,
      });

      const statusMenu = new StringSelectMenuBuilder()
        .setCustomId('select_status')
        .setPlaceholder('select status')
        .addOptions(
          new StringSelectMenuOptionBuilder().setLabel('Онлайн').setValue('online'),
          new StringSelectMenuOptionBuilder().setLabel('Оффлайн').setValue('offline'),
          new StringSelectMenuOptionBuilder().setLabel('Не беспокоить').setValue('dnd'),
          new StringSelectMenuOptionBuilder().setLabel('Невидимый').setValue('invisible')
        );

      const activityTypeMenu = new StringSelectMenuBuilder()
        .setCustomId('select_activity_type')
        .setPlaceholder('select activity type')
        .addOptions(
          new StringSelectMenuOptionBuilder().setLabel('Играет').setValue('Playing'),
          new StringSelectMenuOptionBuilder().setLabel('Смотрит').setValue('Watching'),
          new StringSelectMenuOptionBuilder().setLabel('Слушает').setValue('Listening'),
          new StringSelectMenuOptionBuilder().setLabel('Стримит').setValue('Streaming')
        );

      const emojiMenu = new StringSelectMenuBuilder()
        .setCustomId('select_emoji')
        .setPlaceholder('select emoji')
        .addOptions(
          new StringSelectMenuOptionBuilder().setLabel('🟢').setValue('🟢'),
          new StringSelectMenuOptionBuilder().setLabel('🔴').setValue('🔴'),
          new StringSelectMenuOptionBuilder().setLabel('🟡').setValue('🟡'),
          new StringSelectMenuOptionBuilder().setLabel('⚫').setValue('⚫')
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
        content: formatAdminSettings(interaction.client.adminSettings.get(interaction.user.id)),
        components: [row1, row2, row3, row4],
        flags: 64,
      });
    }
  }

  // Handle custom message ID modal for /lame
  if (interaction.isModalSubmit() && interaction.customId === 'custom_message_id') {
    const messageId = interaction.fields.getTextInputValue('message_id');

    if (!/^\d{17,19}$/.test(messageId)) {
      await interaction.reply({
        content: 'Error: incorrect ID!',
        flags: 64,
      });
      return;
    }

    interaction.client.floodSettings = interaction.client.floodSettings || new Map();
    interaction.client.floodSettings.set(interaction.user.id, {
      text: interaction.message?.interaction?.options?.getString('text') || 'Неизвестно',
      replyTo: 'custom',
      customMessageId: messageId,
      delay: null,
      count: null,
      channelId: interaction.channelId,
      interactionToken: interaction.token,
    });

    const delayMenu = new StringSelectMenuBuilder()
      .setCustomId('select_delay')
      .setPlaceholder('Select delay')
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel('1s').setValue('1000'),
        new StringSelectMenuOptionBuilder().setLabel('2s').setValue('2000'),
        new StringSelectMenuOptionBuilder().setLabel('5s').setValue('5000')
      );

    const countMenu = new StringSelectMenuBuilder()
      .setCustomId('select_count')
      .setPlaceholder('Select count')
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel('1').setValue('1'),
        new StringSelectMenuOptionBuilder().setLabel('3').setValue('3'),
        new StringSelectMenuOptionBuilder().setLabel('5').setValue('5')
      );

    const startButton = new ButtonBuilder()
      .setCustomId('start_flood')
      .setLabel('Start Fl00d')
      .setStyle(ButtonStyle.Primary);

    const row1 = new ActionRowBuilder().addComponents(delayMenu);
    const row2 = new ActionRowBuilder().addComponents(countMenu);
    const row3 = new ActionRowBuilder().addComponents(startButton);

    await interaction.reply({
      content: formatSettings(interaction.client.floodSettings.get(interaction.user.id)),
      components: [row1, row2, row3],
      flags: 64,
    });
  }

  // Handle activity text modal for /admin
  if (interaction.isModalSubmit() && interaction.customId === 'activity_text_modal') {
    if (!adminList.has(interaction.user.id)) return;
    const activityText = interaction.fields.getTextInputValue('activity_text');

    const settings = interaction.client.adminSettings.get(interaction.user.id);
    settings.activityText = activityText;

    const statusMenu = new StringSelectMenuBuilder()
      .setCustomId('select_status')
      .setPlaceholder('Status')
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel('online').setValue('online'),
        new StringSelectMenuOptionBuilder().setLabel('offline').setValue('offline'),
        new StringSelectMenuOptionBuilder().setLabel('dnd').setValue('dnd'),
        new StringSelectMenuOptionBuilder().setLabel('invisible').setValue('invisible')
      );

    const activityTypeMenu = new StringSelectMenuBuilder()
      .setCustomId('select_activity_type')
      .setPlaceholder('Activity select')
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
        new StringSelectMenuOptionBuilder().setLabel('🟢').setValue('🟢'),
        new StringSelectMenuOptionBuilder().setLabel('🔴').setValue('🔴'),
        new StringSelectMenuOptionBuilder().setLabel('🟡').setValue('🟡'),
        new StringSelectMenuOptionBuilder().setLabel('⚫').setValue('⚫')
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
      flags: 64,
    });
  }

  // Handle delay selection for /lame
  if (interaction.isStringSelectMenu() && interaction.customId === 'select_delay') {
    const delay = parseInt(interaction.values[0]);
    const settings = interaction.client.floodSettings.get(interaction.user.id);
    settings.delay = delay;

    await interaction.update({
      content: formatSettings(settings),
      components: interaction.message.components,
      flags: 64,
    });
  }

  // Handle count selection for /lame
  if (interaction.isStringSelectMenu() && interaction.customId === 'select_count') {
    const count = parseInt(interaction.values[0]);
    const settings = interaction.client.floodSettings.get(interaction.user.id);
    settings.count = count;

    await interaction.update({
      content: formatSettings(settings),
      components: interaction.message.components,
      flags: 64,
    });
  }

  // Handle status selection for /admin
  if (interaction.isStringSelectMenu() && interaction.customId === 'select_status') {
    if (!adminList.has(interaction.user.id)) return;
    const status = interaction.values[0];
    const settings = interaction.client.adminSettings.get(interaction.user.id);
    settings.status = status;

    await interaction.update({
      content: formatAdminSettings(settings),
      components: interaction.message.components,
      flags: 64,
    });
  }

  // Handle activity type selection for /admin
  if (interaction.isStringSelectMenu() && interaction.customId === 'select_activity_type') {
    if (!adminList.has(interaction.user.id)) return;
    const activityType = interaction.values[0];
    const settings = interaction.client.adminSettings.get(interaction.user.id);
    settings.activityType = activityType;

    const modal = new ModalBuilder()
      .setCustomId('activity_text_modal')
      .setTitle('Text');

    const textInput = new TextInputBuilder()
      .setCustomId('activity_text')
      .setLabel('Text')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Activity text')
      .setRequired(true);

    const row = new ActionRowBuilder().addComponents(textInput);
    modal.addComponents(row);

    await interaction.showModal(modal);
  }

  // Handle emoji selection for /admin
  if (interaction.isStringSelectMenu() && interaction.customId === 'select_emoji') {
    if (!adminList.has(interaction.user.id)) return;
    const emoji = interaction.values[0];
    const settings = interaction.client.adminSettings.get(interaction.user.id);
    settings.emoji = emoji;

    await interaction.update({
      content: formatAdminSettings(settings),
      components: interaction.message.components,
      flags: 64,
    });
  }

  // Handle apply settings for /admin
  if (interaction.isButton() && interaction.customId === 'apply_admin_settings') {
    if (!adminList.has(interaction.user.id)) return;
    const settings = interaction.client.adminSettings.get(interaction.user.id);

    if (!settings.status || !settings.activityType || !settings.activityText || !settings.emoji) {
      await interaction.update({
        content: `${formatAdminSettings(settings)}\nError: edit all settings!`,
        components: interaction.message.components,
        flags: 64,
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
        activities: [
          {
            name: `${settings.emoji} ${settings.activityText}`,
            type: activityTypes[settings.activityType],
          },
        ],
      });

      await interaction.update({
        content: `${formatAdminSettings(settings)}\nSettings applied`,
        components: [],
        flags: 64,
      });
    } catch (error) {
      await interaction.update({
        content: `${formatAdminSettings(settings)}\nError: ${error.message}`,
        components: interaction.message.components,
        flags: 64,
      });
    }

    interaction.client.adminSettings.delete(interaction.user.id);
  }

  // Handle flood start for /lame
  if (interaction.isButton() && interaction.customId === 'start_flood') {
    const settings = interaction.client.floodSettings.get(interaction.user.id);

    if (!settings.delay || !settings.count) {
      await interaction.update({
        content: `${formatSettings(settings)}\nError, choose settings!`,
        components: interaction.message.components,
        flags: 64,
      });
      return;
    }

    const { text, delay, count, replyTo, customMessageId, channelId, interactionToken } = settings;

    await interaction.update({
      content: `${formatSettings(settings)}\nSpamming...`,
      components: [],
      flags: 64,
    });

    let replyMessageId = replyTo === 'invisible' ? interaction.message.id : customMessageId;

    let sentCount = 0;
    const rest = new REST({ version: '10' }).setToken(TOKEN);

    for (let i = 0; i < count; i++) {
      try {
        await rest.post(Routes.webhook(CLIENT_ID, interactionToken), {
          body: {
            content: text,
            message_reference: replyMessageId
              ? {
                  message_id: replyMessageId,
                  channel_id: channelId,
                  fail_if_not_exists: false,
                }
              : undefined,
            flags: 0,
          },
        });
        sentCount++;
        await new Promise((resolve) => setTimeout(resolve, delay));
      } catch (error) {
        console.error('Error:', error);
        if (error.code === 429) {
          const retryAfter = error.retry_after || 1000;
          await new Promise((resolve) => setTimeout(resolve, retryAfter));
          i--;
          continue;
        }
        await interaction.followUp({
          content: `${formatSettings(settings)}\nError: ${error.message}`,
          flags: 64,
        });
        break;
      }
    }

    await interaction.followUp({
      content: `${formatSettings(settings)}\nSpam end: sended ${sentCount} messages`,
      flags: 64,
    });

    interaction.client.floodSettings.delete(interaction.user.id);
  }
});

client.login(TOKEN);
