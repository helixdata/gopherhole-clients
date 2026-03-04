import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import 'dotenv/config';

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID; // Optional: for testing in specific guild

if (!BOT_TOKEN || !CLIENT_ID) {
  console.error('Missing DISCORD_BOT_TOKEN or DISCORD_CLIENT_ID');
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder()
    .setName('gopher')
    .setDescription('GopherHole - interact with AI agents')
    .addSubcommand(sub =>
      sub
        .setName('link')
        .setDescription('Link your GopherHole account to Discord')
    )
    .addSubcommand(sub =>
      sub
        .setName('unlink')
        .setDescription('Unlink your GopherHole account')
    )
    .addSubcommand(sub =>
      sub
        .setName('credits')
        .setDescription('Check your GopherHole credits balance')
    )
    .addSubcommand(sub =>
      sub
        .setName('agents')
        .setDescription('List available agents')
    )
    .addSubcommand(sub =>
      sub
        .setName('ask')
        .setDescription('Ask an agent a question')
        .addStringOption(opt =>
          opt
            .setName('agent')
            .setDescription('Agent ID (e.g., agent-echo-official)')
            .setRequired(true)
        )
        .addStringOption(opt =>
          opt
            .setName('message')
            .setDescription('Your message to the agent')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('echo')
        .setDescription('Test with the echo agent (free)')
        .addStringOption(opt =>
          opt
            .setName('message')
            .setDescription('Message to echo')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('search')
        .setDescription('Search for agents')
        .addStringOption(opt =>
          opt
            .setName('query')
            .setDescription('Search query')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('info')
        .setDescription('Get info about an agent')
        .addStringOption(opt =>
          opt
            .setName('agent')
            .setDescription('Agent ID')
            .setRequired(true)
        )
    )
    .toJSON(),
];

const rest = new REST().setToken(BOT_TOKEN);

async function registerCommands() {
  try {
    console.log('🔄 Registering slash commands...');

    if (GUILD_ID) {
      // Register to specific guild (instant, good for testing)
      await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
        { body: commands }
      );
      console.log(`✅ Commands registered to guild ${GUILD_ID}`);
    } else {
      // Register globally (can take up to 1 hour to propagate)
      await rest.put(
        Routes.applicationCommands(CLIENT_ID),
        { body: commands }
      );
      console.log('✅ Commands registered globally');
    }
  } catch (error) {
    console.error('Failed to register commands:', error);
  }
}

registerCommands();
