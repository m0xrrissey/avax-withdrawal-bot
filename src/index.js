import 'dotenv/config';
import { Bot } from 'grammy';
import { limit } from '@grammyjs/ratelimiter';
import { ethers } from 'ethers';
import { ContractService } from './services/contract.js';
import { JsonStore } from './services/json-store.js';
import { PollerService } from './services/poller.js';

// Configuration
const BOT_TOKEN = process.env.BOT_TOKEN;
const RPC_URL = process.env.RPC_URL;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '900000');
const DEFAULT_FREQ_SECONDS = parseInt(process.env.DEFAULT_FREQ_SECONDS || '86400');
const FALLBACK_RPC_URLS = process.env.FALLBACK_RPC_URLS
  ? process.env.FALLBACK_RPC_URLS.split(',').map(url => url.trim())
  : null;

if (!BOT_TOKEN || !RPC_URL || !CONTRACT_ADDRESS) {
  console.error('❌ Missing required environment variables');
  process.exit(1);
}
const FREQUENCY_OPTIONS = {
  '6h': 6 * 60 * 60,
  '12h': 12 * 60 * 60,
  '24h': 24 * 60 * 60
};

const bot = new Bot(BOT_TOKEN);
const contractService = new ContractService(RPC_URL, CONTRACT_ADDRESS, FALLBACK_RPC_URLS);
const store = new JsonStore();
const poller = new PollerService(contractService, store, bot, POLL_INTERVAL_MS);

bot.use(
  limit({
    timeFrame: 10000,
    limit: 5,
    onLimitExceeded: async (ctx) => {
      await ctx.reply('⏱️ Slow down! Too many requests. Please wait a moment.');
    },
    keyGenerator: (ctx) => ctx.from?.id.toString()
  })
);
bot.use(async (ctx, next) => {
  console.log(`📨 ${ctx.from?.id}: ${ctx.message?.text || ctx.callbackQuery?.data || 'other'}`);
  await next();
});
bot.command('start', async (ctx) => {
  const startPayload = ctx.match;

  if (startPayload && startPayload.startsWith('addr_')) {
    const walletAddress = startPayload.slice(5);

    if (!ethers.isAddress(walletAddress)) {
      await ctx.reply('❌ Invalid address. Try again from your dApp.');
      return;
    }
    await ctx.reply(
      `Wallet: \`${walletAddress}\`\n\nEnable withdrawal alerts?`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Yes', callback_data: `confirm_yes:${walletAddress}` },
              { text: '❌ No', callback_data: 'confirm_no' }
            ]
          ]
        }
      }
    );
  } else {
    await ctx.reply(
      '👋 *Avalanche Withdrawal Monitor*\n\n' +
      'Get notified when your withdrawals are ready to claim.\n\n' +
      '*Quick Start:*\n' +
      '• Visit [hypha.sh/unstake](https://hypha.sh/unstake)\n' +
      '• Or paste your wallet address here\n\n' +
      '*Commands:*\n' +
      '/status - View active requests\n' +
      '/frequency - Change notification frequency\n' +
      '/help - More info',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🌐 Visit hypha.sh/unstake', url: 'https://hypha.sh/unstake' }]
          ]
        }
      }
    );
  }
});

bot.callbackQuery(/^confirm_yes:(.+)$/, async (ctx) => {
  const walletAddress = ctx.match[1];
  const frequencySeconds = FREQUENCY_OPTIONS['24h'];
  store.subscribe(ctx.chat.id, walletAddress, frequencySeconds);
  const requestIds = await contractService.getRequestsByOwner(walletAddress);
  const activeRequestIds = await contractService.filterActiveRequests(requestIds);

  const shortAddress = `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;

  await ctx.editMessageText(
    `✅ *Alerts Enabled*\n\n` +
    `Wallet: \`${shortAddress}\`\n` +
    `Active requests: ${activeRequestIds.length}\n` +
    `Notification frequency: Every 24h\n\n` +
    `You'll be notified when withdrawals are ready to claim.\n\n` +
    `*Commands:*\n` +
    `/frequency - Change alert frequency\n` +
    `/unsubscribe - Stop monitoring\n` +
    `/status - Check your requests`,
    {
      parse_mode: 'Markdown'
    }
  );

  await ctx.answerCallbackQuery('Alerts enabled!');
});

bot.callbackQuery('confirm_no', async (ctx) => {
  await ctx.editMessageText('No problem! Use /start anytime to enable alerts.');
  await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^freq_(\w+)$/, async (ctx) => {
  const frequencyKey = ctx.match[1];
  const sub = store.getSubscription(ctx.chat.id);

  if (!sub) {
    await ctx.answerCallbackQuery('No active subscription.');
    return;
  }

  const frequencySeconds = FREQUENCY_OPTIONS[frequencyKey] || DEFAULT_FREQ_SECONDS;
  store.subscribe(ctx.chat.id, sub.walletAddress, frequencySeconds);

  await ctx.editMessageText(
    `✅ Frequency updated to every ${frequencyKey}`
  );

  await ctx.answerCallbackQuery(`Updated to ${frequencyKey}`);
});

bot.command('unsubscribe', async (ctx) => {
  const sub = store.getSubscription(ctx.chat.id);

  if (!sub) {
    await ctx.reply('📭 Not currently monitoring any wallet.');
    return;
  }

  const shortAddress = `${sub.walletAddress.slice(0, 6)}...${sub.walletAddress.slice(-4)}`;
  store.unsubscribe(ctx.chat.id);

  await ctx.reply(
    `✅ Alerts disabled for \`${shortAddress}\`\n\nUse /start to monitor again.`,
    { parse_mode: 'Markdown' }
  );
});

bot.command('status', async (ctx) => {
  const sub = store.getSubscription(ctx.chat.id);

  if (!sub) {
    await ctx.reply('📭 Not monitoring any wallet.\n\nPaste your wallet address to start.');
    return;
  }

  try {
    const shortAddress = `${sub.walletAddress.slice(0, 6)}...${sub.walletAddress.slice(-4)}`;
    const freqLabel = Object.entries(FREQUENCY_OPTIONS).find(
      ([_, secs]) => secs === sub.frequencySeconds
    )?.[0] || 'custom';

    const requestIds = await contractService.getRequestsByOwner(sub.walletAddress);
    const activeRequestIds = await contractService.filterActiveRequests(requestIds);
    const claimableRequestIds = await contractService.getClaimableRequests(sub.walletAddress);

    await ctx.reply(
      `📊 *Status*\n\n` +
      `Wallet: \`${shortAddress}\`\n` +
      `Frequency: Every ${freqLabel}\n` +
      `Active: ${activeRequestIds.length}\n` +
      `Claimable: ${claimableRequestIds.length}`,
      {
        parse_mode: 'Markdown'
      }
    );
  } catch (error) {
    console.error('Error in /status command:', error);
    await ctx.reply('❌ Error fetching status. Try again later.');
  }
});

bot.command('help', async (ctx) => {
  await ctx.reply(
    `🤖 *Avalanche Withdrawal Monitor*\n\n` +
    `Get notified when withdrawals are ready to claim.\n\n` +
    `*Commands:*\n` +
    `/start - Enable alerts\n` +
    `/status - View active requests\n` +
    `/frequency - Change alert frequency\n` +
    `/unsubscribe - Stop monitoring\n\n` +
    `*How to use:*\n` +
    `Visit [hypha.sh/unstake](https://hypha.sh/unstake) or paste your wallet address.`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🌐 Visit hypha.sh/unstake', url: 'https://hypha.sh/unstake' }]
        ]
      }
    }
  );
});

bot.command('frequency', async (ctx) => {
  const sub = store.getSubscription(ctx.chat.id);

  if (!sub) {
    await ctx.reply('📭 Not monitoring any wallet.\n\nPaste your wallet address to start.');
    return;
  }

  const currentFreq = Object.entries(FREQUENCY_OPTIONS).find(
    ([_, secs]) => secs === sub.frequencySeconds
  )?.[0] || '24h';

  await ctx.reply(
    `Current frequency: Every ${currentFreq}\n\nSelect new frequency:`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '⏰ Every 6h', callback_data: 'freq_6h' }],
          [{ text: '⏰ Every 12h', callback_data: 'freq_12h' }],
          [{ text: '⏰ Every 24h', callback_data: 'freq_24h' }]
        ]
      }
    }
  );
});

bot.on('message:text', async (ctx) => {
  const text = ctx.message.text.trim();

  if (text.startsWith('/')) {
    return;
  }

  if (!ethers.isAddress(text)) {
    await ctx.reply('❌ Invalid wallet address.\n\nPaste a valid Ethereum address (0x...)');
    return;
  }

  const walletAddress = ethers.getAddress(text);
  const existingSub = store.getSubscription(ctx.chat.id);

  if (existingSub && existingSub.walletAddress.toLowerCase() === walletAddress.toLowerCase()) {
    await ctx.reply('✅ Already monitoring this wallet.\n\nUse /status to check requests.');
    return;
  }

  if (existingSub) {
    const oldShort = `${existingSub.walletAddress.slice(0, 6)}...${existingSub.walletAddress.slice(-4)}`;
    await ctx.reply(
      `Currently monitoring \`${oldShort}\`\n\nSwitch to \`${walletAddress}\`?`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Yes', callback_data: `confirm_yes:${walletAddress}` },
              { text: '❌ No', callback_data: 'confirm_no' }
            ]
          ]
        }
      }
    );
    return;
  }

  await ctx.reply(
    `Wallet: \`${walletAddress}\`\n\nEnable withdrawal alerts?`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Yes', callback_data: `confirm_yes:${walletAddress}` },
            { text: '❌ No', callback_data: 'confirm_no' }
          ]
        ]
      }
    }
  );
});

bot.catch((err) => {
  console.error('❌ Bot error:', err);
});

async function start() {
  console.log('🚀 Starting Avalanche Withdrawal Monitor Bot...');
  console.log(`📍 Contract: ${CONTRACT_ADDRESS}`);
  console.log(`🔗 RPC: ${RPC_URL}`);
  console.log(`⏱️  Poll interval: ${POLL_INTERVAL_MS}ms`);
  console.log(`⏰ Default frequency: ${DEFAULT_FREQ_SECONDS}s\n`);

  try {
    await bot.api.setMyCommands([
      { command: 'start', description: 'Start monitoring withdrawals' },
      { command: 'status', description: 'View active requests' },
      { command: 'frequency', description: 'Change alert frequency' },
      { command: 'unsubscribe', description: 'Stop monitoring' },
      { command: 'help', description: 'Show help information' }
    ]);
    console.log('✅ Bot commands set');
  } catch (error) {
    console.error('⚠️  Failed to set bot commands:', error.message);
  }

  poller.start();
  await bot.start();

  console.log('✅ Bot is running!\n');
}

process.once('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  poller.stop();
  bot.stop();
  store.close();
  process.exit(0);
});

process.once('SIGTERM', () => {
  console.log('\n🛑 Shutting down...');
  poller.stop();
  bot.stop();
  store.close();
  process.exit(0);
});

start().catch((error) => {
  console.error('❌ Failed to start bot:', error);
  process.exit(1);
});
