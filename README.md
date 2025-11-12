# Avalanche Withdrawal Monitor Bot

Production-ready Telegram bot that monitors Avalanche C-Chain withdrawal requests and notifies users when withdrawals are ready to claim.

## Features

- **Deep Link Integration** - Direct integration from dApps
- **Smart Polling** - Every 15 minutes at aligned times (:00/:15/:30/:45)
- **Instant Alerts** - Immediate notifications when withdrawals become claimable
- **Configurable Frequency** - 6h, 12h, or 24h notification intervals
- **Production Hardened** - RPC failover, rate limiting, persistent storage
- **Zero Native Dependencies** - JSON-based storage works everywhere

## Quick Start

### Prerequisites

- Node.js 18+
- Telegram bot token from [@BotFather](https://t.me/BotFather)

### Installation

```bash
npm install
cp .env.example .env
# Edit .env with your configuration
npm start
```

### Configuration

Edit `.env`:

```env
BOT_TOKEN=your_bot_token_here
BOT_USERNAME=your_bot_username
CONTRACT_ADDRESS=0x61f908D4992a790A2792D3C36850B4b9eB5849A3
RPC_URL=https://api.avax.network/ext/bc/C/rpc
POLL_INTERVAL_MS=900000
DEFAULT_FREQ_SECONDS=86400
```

Optional fallback RPCs:

```env
FALLBACK_RPC_URLS=https://avalanche-c-chain.publicnode.com,https://rpc.ankr.com/avalanche
```

## dApp Integration

```javascript
const BOT_USERNAME = 'your_bot_username';

function generateTelegramLink(walletAddress) {
  return `https://t.me/${BOT_USERNAME}?start=addr_${walletAddress}`;
}

// Use with "Enable Notifications" button
window.open(generateTelegramLink(address), '_blank');
```

See `frontend-integration.html` for complete example.

## Bot Commands

- `/start` - Start monitoring or paste wallet address
- `/status` - View active and claimable requests
- `/frequency` - Change notification frequency (6h/12h/24h)
- `/unsubscribe` - Stop monitoring
- `/help` - Show help

## Architecture

```
┌─────────────┐
│   Telegram  │
│     Bot     │
└──────┬──────┘
       │
   ┌───┴───┬────────────┬────────────┐
   │       │            │            │
┌──▼──┐ ┌──▼──────┐ ┌──▼────┐ ┌─────▼──────┐
│Store│ │Contract│ │Poller│ │ Resilient  │
│     │ │Service │ │      │ │  Provider  │
└─────┘ └─────────┘ └──────┘ └────────────┘
                                    │
                        ┌───────────┼──────────┐
                        │           │          │
                   RPC #1      RPC #2     RPC #3
```

## Production Features

### Persistent Storage

JSON file at `data/bot-data.json` stores:
- Subscriptions
- Notification history
- Completion status

Automatically saved on every change. Backup by copying `data/` directory.

### RPC Resilience

- 4 fallback Avalanche RPC endpoints
- Exponential backoff retry (3 attempts per endpoint)
- 30-second timeout per request
- Automatic failover on failure

### Rate Limiting

- 5 requests per 10 seconds per user
- Prevents spam and abuse
- User-friendly error messages

### Error Handling

- Graceful RPC failures
- Automatic recovery
- Detailed logging

## Deployment

### Using PM2

```bash
npm install -g pm2
pm2 start src/index.js --name avax-bot
pm2 save
pm2 startup
```

### Monitoring

```bash
pm2 status
pm2 logs avax-bot
pm2 monit
```

## Project Structure

```
avax-withdrawal-bot/
├── src/
│   ├── index.js              # Bot entry point
│   ├── services/
│   │   ├── contract.js       # Contract interaction
│   │   ├── json-store.js     # Persistent storage
│   │   ├── poller.js         # Polling & notifications
│   │   └── provider.js       # Resilient RPC provider
│   └── utils/
│       └── abi.js            # Contract ABI
├── data/
│   └── bot-data.json         # Persistent data
├── frontend-integration.html # Integration example
├── .env                      # Configuration
└── package.json
```

## Performance

- **RPC Calls**: 4 per hour (93% reduction vs 1-minute polling)
- **Storage**: ~500 bytes per subscription
- **Latency**: 100-500ms normal, 1-5s with retry
- **Success Rate**: >99.9% with failover

## Troubleshooting

**Bot not responding?**
- Verify `BOT_TOKEN` in `.env`
- Check bot process is running: `pm2 status`

**No notifications?**
- Verify subscriptions: `/status` command
- Check logs for errors: `pm2 logs avax-bot`
- Test RPC connectivity

**Wrong data?**
- Verify `CONTRACT_ADDRESS` is correct
- Check RPC endpoint is responding

## License

MIT
