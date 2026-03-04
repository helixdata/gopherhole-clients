import { Client, GatewayIntentBits, Events, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import 'dotenv/config';

const GOPHERHOLE_API = process.env.GOPHERHOLE_API || 'https://gopherhole.ai/api';
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GOPHERHOLE_BOT_SECRET = process.env.GOPHERHOLE_BOT_SECRET;

if (!BOT_TOKEN) {
  console.error('Missing DISCORD_BOT_TOKEN');
  process.exit(1);
}

if (!GOPHERHOLE_BOT_SECRET) {
  console.error('Missing GOPHERHOLE_BOT_SECRET');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// API helper
async function gopherholeApi(endpoint: string, options: RequestInit = {}) {
  const res = await fetch(`${GOPHERHOLE_API}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Discord-Bot-Token': GOPHERHOLE_BOT_SECRET!,
      ...options.headers,
    },
  });
  return res.json();
}

// Command handlers
async function handleLink(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  
  try {
    const result = await gopherholeApi('/discord/link/initiate', {
      method: 'POST',
      body: JSON.stringify({
        discord_id: interaction.user.id,
        discord_username: interaction.user.tag,
        guild_id: interaction.guildId,
        channel_id: interaction.channelId,
      }),
    });

    if (result.error === 'already_linked') {
      await interaction.editReply({
        content: '✅ Your Discord account is already linked to GopherHole! Use `/gopher ask` to query agents.',
      });
      return;
    }

    if (result.error) {
      await interaction.editReply({
        content: `❌ Error: ${result.message || result.error}`,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle('🔗 Link Your GopherHole Account')
      .setDescription('Click the link below to connect your Discord account to GopherHole.')
      .addFields(
        { name: 'Link', value: result.link_url },
        { name: '⏰ Expires', value: 'This link expires in 10 minutes', inline: true }
      )
      .setFooter({ text: 'GopherHole • The Universal Agent Hub' });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('Link error:', error);
    await interaction.editReply({
      content: '❌ Something went wrong. Please try again later.',
    });
  }
}

async function handleUnlink(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  
  // Note: Unlink needs user auth, so we direct them to the dashboard
  await interaction.editReply({
    content: '🔗 To unlink your Discord account, visit your GopherHole dashboard:\nhttps://gopherhole.ai/settings',
  });
}

async function handleCredits(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  
  // Credits check would need user auth - direct to dashboard
  await interaction.editReply({
    content: '💳 Check your credits balance at:\nhttps://gopherhole.ai/credits',
  });
}

async function handleAgents(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();
  
  try {
    const result = await gopherholeApi('/discord/agents');
    
    const freeList = result.free?.map((a: any) => `• **${a.name}** — ${a.description || 'No description'}`).join('\n') || 'None';
    const popularList = result.popular?.slice(0, 5).map((a: any) => 
      `• **${a.name}** ${a.free ? '(Free)' : `(${a.price})`} — ${a.description || 'No description'}`
    ).join('\n') || 'None';

    const embed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle('🐿️ Available Agents')
      .addFields(
        { name: '🆓 Free Agents (no account needed)', value: freeList },
        { name: '🔥 Popular Agents', value: popularList }
      )
      .setFooter({ text: 'Use /gopher ask <agent> <message> to query an agent' });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('Agents error:', error);
    await interaction.editReply({
      content: '❌ Failed to fetch agents. Please try again later.',
    });
  }
}

async function handleAsk(interaction: ChatInputCommandInteraction) {
  const agent = interaction.options.getString('agent', true);
  const message = interaction.options.getString('message', true);
  
  await interaction.deferReply();
  
  try {
    const result = await gopherholeApi('/discord/proxy', {
      method: 'POST',
      body: JSON.stringify({
        discord_id: interaction.user.id,
        agent_id: agent,
        message: { parts: [{ kind: 'text', text: message }] },
      }),
    });

    if (result.error === 'account_not_linked' || result.link_required) {
      const embed = new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle('🔗 Account Link Required')
        .setDescription(result.message || 'This agent requires a linked GopherHole account.')
        .addFields(
          { name: 'How to link', value: 'Use `/gopher link` to connect your GopherHole account' }
        );
      
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (result.error) {
      await interaction.editReply({
        content: `❌ Error: ${result.message || result.error}`,
      });
      return;
    }

    // Success!
    const responseText = result.response || result.artifacts?.[0]?.parts?.[0]?.text || 'No response';
    
    const embed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle(`🐿️ ${agent}`)
      .setDescription(responseText.slice(0, 4000)) // Discord limit
      .setFooter({ text: `Task: ${result.task_id} • Status: ${result.status}` });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('Ask error:', error);
    await interaction.editReply({
      content: '❌ Something went wrong. Please try again later.',
    });
  }
}

async function handleEcho(interaction: ChatInputCommandInteraction) {
  const message = interaction.options.getString('message', true);
  
  await interaction.deferReply();
  
  try {
    const result = await gopherholeApi('/discord/proxy', {
      method: 'POST',
      body: JSON.stringify({
        discord_id: interaction.user.id,
        agent_id: 'agent-echo-official',
        message: { parts: [{ kind: 'text', text: message }] },
      }),
    });

    if (result.error) {
      await interaction.editReply({ content: `❌ Error: ${result.message || result.error}` });
      return;
    }

    const responseText = result.response || result.artifacts?.[0]?.parts?.[0]?.text || message;
    await interaction.editReply({ content: `🔊 ${responseText}` });
  } catch (error) {
    console.error('Echo error:', error);
    await interaction.editReply({ content: '❌ Echo failed.' });
  }
}

async function handleSearch(interaction: ChatInputCommandInteraction) {
  const query = interaction.options.getString('query', true);
  
  await interaction.deferReply();
  
  try {
    const res = await fetch(`${GOPHERHOLE_API.replace('/api', '')}/api/discover?q=${encodeURIComponent(query)}&limit=5`);
    const result = await res.json();

    if (!result.agents?.length) {
      await interaction.editReply({ content: `🔍 No agents found for "${query}"` });
      return;
    }

    const list = result.agents.map((a: any) => {
      const card = a.agent_card ? JSON.parse(a.agent_card) : {};
      const price = a.price_amount ? `$${a.price_amount}` : 'Free';
      return `• **${card.name || a.id}** (${price}) — ${card.description?.slice(0, 80) || 'No description'}`;
    }).join('\n');

    const embed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle(`🔍 Search: "${query}"`)
      .setDescription(list)
      .setFooter({ text: 'Use /gopher ask <agent-id> <message> to query' });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('Search error:', error);
    await interaction.editReply({ content: '❌ Search failed.' });
  }
}

async function handleInfo(interaction: ChatInputCommandInteraction) {
  const agentId = interaction.options.getString('agent', true);
  
  await interaction.deferReply();
  
  try {
    const res = await fetch(`${GOPHERHOLE_API.replace('/api', '')}/api/discover/${agentId}`);
    const result = await res.json();

    if (result.error || !result.agent) {
      await interaction.editReply({ content: `❌ Agent "${agentId}" not found` });
      return;
    }

    const a = result.agent;
    const card = a.agent_card ? JSON.parse(a.agent_card) : {};
    const price = a.price_amount ? `$${a.price_amount}/request` : 'Free';

    const embed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle(`🐿️ ${card.name || a.id}`)
      .setDescription(card.description || 'No description')
      .addFields(
        { name: 'ID', value: `\`${a.id}\``, inline: true },
        { name: 'Price', value: price, inline: true },
        { name: 'Messages', value: String(a.message_count || 0), inline: true }
      );

    if (card.skills?.length) {
      embed.addFields({
        name: 'Skills',
        value: card.skills.map((s: any) => s.name).join(', '),
      });
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('Info error:', error);
    await interaction.editReply({ content: '❌ Failed to fetch agent info.' });
  }
}

// Event handlers
client.once(Events.ClientReady, (c) => {
  console.log(`✅ GopherBot ready as ${c.user.tag}`);
  console.log(`📡 Connected to ${c.guilds.cache.size} guilds`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  // Handle /gopher subcommands
  if (commandName === 'gopher') {
    const subcommand = interaction.options.getSubcommand();
    
    switch (subcommand) {
      case 'link':
        await handleLink(interaction);
        break;
      case 'unlink':
        await handleUnlink(interaction);
        break;
      case 'credits':
        await handleCredits(interaction);
        break;
      case 'agents':
        await handleAgents(interaction);
        break;
      case 'ask':
        await handleAsk(interaction);
        break;
      case 'echo':
        await handleEcho(interaction);
        break;
      case 'search':
        await handleSearch(interaction);
        break;
      case 'info':
        await handleInfo(interaction);
        break;
      default:
        await interaction.reply({ content: 'Unknown command', ephemeral: true });
    }
  }
});

// Start bot
client.login(BOT_TOKEN);
