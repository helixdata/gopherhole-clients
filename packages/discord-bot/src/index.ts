import { Client, GatewayIntentBits, Events, ChatInputCommandInteraction, AutocompleteInteraction, EmbedBuilder } from 'discord.js';
import 'dotenv/config';

// Brief cache for autocomplete results (10 second TTL)
const autocompleteCache = new Map<string, { results: any[]; timestamp: number }>();
const AUTOCOMPLETE_CACHE_TTL = 10 * 1000;
const MIN_SEARCH_LENGTH = 2;

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
async function gopherholeApi(endpoint: string, options: RequestInit = {}): Promise<any> {
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
    console.log('Link request for:', interaction.user.id, interaction.user.tag);
    const result = await gopherholeApi('/discord/link/initiate', {
      method: 'POST',
      body: JSON.stringify({
        discord_id: interaction.user.id,
        discord_username: interaction.user.tag,
        guild_id: interaction.guildId,
        channel_id: interaction.channelId,
      }),
    });
    console.log('Link result:', result);

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
    content: '🔗 To unlink your Discord account, visit your GopherHole dashboard:\nhttps://gopherhole.ai/dashboard/settings',
  });
}

async function handleCredits(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  
  // Credits check would need user auth - direct to dashboard
  await interaction.editReply({
    content: '💳 Check your credits balance at:\nhttps://gopherhole.ai/dashboard/credits',
  });
}

async function handleAgents(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();
  
  try {
    const result = await gopherholeApi('/discord/agents');
    
    const freeList = result.free?.map((a: any) => 
      `• **${a.name}** \`${a.handle}\` — ${a.description || 'No description'}`
    ).join('\n') || 'None';
    
    const popularList = result.popular?.slice(0, 5).map((a: any) => 
      `• **${a.name}** \`${a.handle}\` ${a.free ? '(Free)' : `(${a.price})`} — ${a.description || 'No description'}`
    ).join('\n') || 'None';

    const embed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle('🐿️ Featured Agents')
      .addFields(
        { name: '🆓 Free Agents (no account needed)', value: freeList },
        { name: '🔥 Popular Agents', value: popularList },
        { name: '💡 Find More', value: 'Use `/gopher search <query>` to discover more agents' }
      )
      .setFooter({ text: 'Use /gopher ask <handle> <message>' });

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
  const skill = interaction.options.getString('skill', false);
  
  await interaction.deferReply();
  
  try {
    const result = await gopherholeApi('/discord/proxy', {
      method: 'POST',
      body: JSON.stringify({
        discord_id: interaction.user.id,
        agent_id: agent,
        skill_id: skill || undefined,
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
  const owner = interaction.options.getString('owner', false);
  const verified = interaction.options.getBoolean('verified', false);
  
  await interaction.deferReply();
  
  try {
    const params = new URLSearchParams({ q: query, limit: '5' });
    if (owner) params.set('owner', owner);
    if (verified) params.set('verified', 'true');
    
    const res = await fetch(`${GOPHERHOLE_API}/discover/agents?${params}`);
    const result: any = await res.json();

    if (!result.agents?.length) {
      await interaction.editReply({ content: `🔍 No agents found for "${query}"` });
      return;
    }

    const list = result.agents.map((a: any) => {
      const price = a.priceAmount ? `$${a.priceAmount}` : 'Free';
      const slug = (a.name || a.id).toLowerCase().replace(/\s+/g, '-');
      const handle = a.tenantSlug ? `${a.tenantSlug}/${slug}` : a.id;
      return `• **${a.name || a.id}** \`${handle}\` (${price})\n  ${a.description?.slice(0, 60) || 'No description'}`;
    }).join('\n\n');

    const embed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle(`🔍 Search: "${query}"`)
      .setDescription(list)
      .setFooter({ text: 'Use /gopher ask <agent name> <message>' });

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
    const res = await fetch(`${GOPHERHOLE_API}/discover/agents/${encodeURIComponent(agentId)}`);
    const result: any = await res.json();

    if (result.error || !result.agent) {
      await interaction.editReply({ content: `❌ Agent "${agentId}" not found` });
      return;
    }

    const a = result.agent;
    const card = a.agentCard || {};
    const price = a.priceAmount ? `$${a.priceAmount}/request` : 'Free';
    const stats = a.stats || {};

    // Build handle from tenant slug + agent name
    const agentSlug = (a.name || a.id).toLowerCase().replace(/\s+/g, '-');
    const handle = a.tenantSlug ? `${a.tenantSlug}/${agentSlug}` : a.id;

    const embed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle(`🐿️ ${a.name || a.id}`)
      .setDescription(a.description || 'No description')
      .addFields(
        { name: 'Handle', value: `\`${handle}\``, inline: true },
        { name: 'Price', value: price, inline: true },
        { name: 'Rating', value: stats.ratingCount ? `${stats.avgRating}⭐ (${stats.ratingCount})` : 'No ratings', inline: true }
      );

    if (card.skills?.length) {
      const skillPricing = a.skillPricing || {};
      embed.addFields({
        name: 'Skills',
        value: card.skills.slice(0, 5).map((s: any) => {
          const sp = skillPricing[s.id];
          const priceTag = sp ? ` ($${sp.amount})` : '';
          return `**${s.name}**${priceTag} — ${s.description || ''}`;
        }).join('\n'),
      });
    }
    
    if (a.tenantName) {
      embed.setFooter({ text: `By ${a.tenantName}` });
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('Info error:', error);
    await interaction.editReply({ content: '❌ Failed to fetch agent info.' });
  }
}

async function handleNearby(interaction: ChatInputCommandInteraction) {
  const lat = interaction.options.getNumber('lat', true);
  const lng = interaction.options.getNumber('lng', true);
  const radius = interaction.options.getNumber('radius') || 10;
  const tag = interaction.options.getString('tag');
  
  await interaction.deferReply();
  
  try {
    const params = new URLSearchParams();
    params.set('lat', String(lat));
    params.set('lng', String(lng));
    params.set('radius', String(radius));
    if (tag) params.set('tag', tag);
    params.set('limit', '10');
    
    const res = await fetch(`${GOPHERHOLE_API}/discover/agents/nearby?${params}`);
    const result: any = await res.json();

    if (!result.agents?.length) {
      await interaction.editReply({ content: `📍 No agents found within ${radius}km of (${lat}, ${lng})` });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle(`📍 Agents near (${lat.toFixed(2)}, ${lng.toFixed(2)})`)
      .setDescription(`Found ${result.count} agents within ${radius}km`);

    const agentList = result.agents.slice(0, 10).map((a: any) => 
      `**${a.name}** — ${a.distance}km\n📍 ${a.location?.name || 'Unknown location'}`
    ).join('\n\n');
    
    embed.addFields({ name: 'Nearby Agents', value: agentList || 'None' });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('Nearby error:', error);
    await interaction.editReply({ content: '❌ Failed to search nearby agents.' });
  }
}

// Event handlers
client.once(Events.ClientReady, (c) => {
  console.log(`✅ GopherBot ready as ${c.user.tag}`);
  console.log(`📡 Connected to ${c.guilds.cache.size} guilds:`);
  c.guilds.cache.forEach(g => console.log(`   - ${g.name} (${g.id})`));
});

// Autocomplete handler for agent and skill selection
async function handleAutocomplete(interaction: AutocompleteInteraction) {
  const focusedOption = interaction.options.getFocused(true);
  
  // Handle skill autocomplete
  if (focusedOption.name === 'skill') {
    const agentHandle = interaction.options.getString('agent');
    if (!agentHandle) {
      await interaction.respond([{ name: 'Select an agent first', value: '' }]);
      return;
    }
    
    try {
      const res = await fetch(`${GOPHERHOLE_API}/discover/agents/${encodeURIComponent(agentHandle)}`);
      const result: any = await res.json();
      
      if (!result.agent?.agentCard?.skills?.length) {
        await interaction.respond([{ name: 'No skills found', value: '' }]);
        return;
      }
      
      const query = focusedOption.value.toLowerCase();
      const skills = result.agent.agentCard.skills
        .filter((s: any) => !query || s.name.toLowerCase().includes(query) || s.id.toLowerCase().includes(query))
        .slice(0, 25);
      
      await interaction.respond(
        skills.map((s: any) => ({
          name: `${s.name} — ${(s.description || '').slice(0, 50)}`,
          value: s.id,
        }))
      );
    } catch (error) {
      console.error('Skill autocomplete error:', error);
      await interaction.respond([]);
    }
    return;
  }
  
  if (focusedOption.name !== 'agent') return;
  
  try {
    const query = focusedOption.value.trim().toLowerCase();
    
    // Check cache first
    const cached = autocompleteCache.get(query);
    if (cached && Date.now() - cached.timestamp < AUTOCOMPLETE_CACHE_TTL) {
      await interaction.respond(cached.results);
      return;
    }
    
    let results: any[];
    
    // If short/empty query, show featured agents
    if (query.length < MIN_SEARCH_LENGTH) {
      const result = await gopherholeApi('/discord/agents');
      const agents = [...(result.free || []), ...(result.popular || [])].slice(0, 25);
      results = agents.map(a => ({
        name: `${a.name} [${a.handle}] ${a.free ? '(Free)' : `(${a.price})`}`.slice(0, 100),
        value: a.handle || a.id,
      }));
    } else {
      // Live search via discover API
      const res = await fetch(`${GOPHERHOLE_API}/discover/agents?q=${encodeURIComponent(query)}&limit=50`);
      const result: any = await res.json();
      
      if (!result.agents?.length) {
        results = [];
      } else {
        // Filter to agents that support text input
        const textCompatible = result.agents.filter((a: any) => {
          if (!a.skills?.length) return false;
          // Check if any skill accepts text/plain or text/*
          return a.skills.some((s: any) => 
            s.inputModes?.some((mode: string) => 
              mode === 'text/plain' || mode === 'text/*' || mode.startsWith('text/')
            )
          );
        });
        
        results = textCompatible.slice(0, 25).map((a: any) => {
          const slug = (a.name || a.id).toLowerCase().replace(/\s+/g, '-');
          const handle = a.tenantSlug ? `${a.tenantSlug}/${slug}` : a.id;
          const price = a.priceAmount ? `$${a.priceAmount}` : 'Free';
          return {
            name: `${a.name} [${handle}] (${price})`.slice(0, 100),
            value: handle,
          };
        });
      }
    }
    
    // Cache results
    autocompleteCache.set(query, { results, timestamp: Date.now() });
    
    // Clean old cache entries periodically
    if (autocompleteCache.size > 100) {
      const now = Date.now();
      for (const [key, val] of autocompleteCache) {
        if (now - val.timestamp > AUTOCOMPLETE_CACHE_TTL) {
          autocompleteCache.delete(key);
        }
      }
    }
    
    await interaction.respond(results);
  } catch (error) {
    console.error('Autocomplete error:', error);
    await interaction.respond([]);
  }
}

client.on(Events.InteractionCreate, async (interaction) => {
  console.log('Interaction received:', interaction.type, interaction.isCommand() ? (interaction as any).commandName : 'N/A');
  
  // Handle autocomplete
  if (interaction.isAutocomplete()) {
    await handleAutocomplete(interaction);
    return;
  }
  
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;
  console.log('Command:', commandName, 'Subcommand:', interaction.options.getSubcommand());

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
      case 'nearby':
        await handleNearby(interaction);
        break;
      default:
        await interaction.reply({ content: 'Unknown command', ephemeral: true });
    }
  }
});

// Start bot
client.login(BOT_TOKEN);
