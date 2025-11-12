export class PollerService {
  constructor(contractService, store, bot, pollIntervalMs) {
    this.contractService = contractService;
    this.store = store;
    this.bot = bot;
    this.pollIntervalMs = pollIntervalMs;
    this.intervalId = null;
    this.timeoutId = null;
    this.isPolling = false;
  }

  calculateDelayToNextAlignedTime() {
    const now = new Date();
    const currentMinute = now.getMinutes();
    const currentSecond = now.getSeconds();
    const currentMs = now.getMilliseconds();
    const nextAlignedMinute = Math.ceil(currentMinute / 15) * 15;
    const minutesUntilNext = (nextAlignedMinute - currentMinute) % 60;
    const delay = (minutesUntilNext * 60 * 1000) - (currentSecond * 1000) - currentMs;
    return delay;
  }

  getNextAlignedTimeString() {
    const delay = this.calculateDelayToNextAlignedTime();
    const nextTime = new Date(Date.now() + delay);
    const hours = String(nextTime.getHours()).padStart(2, '0');
    const minutes = String(nextTime.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  start() {
    if (this.intervalId || this.timeoutId) {
      console.log('⚠️  Poller already running');
      return;
    }

    const intervalMinutes = this.pollIntervalMs / 60000;
    console.log(`🚀 Starting poller (interval: ${intervalMinutes} minutes, aligned to :00/:15/:30/:45)`);

    const delay = this.calculateDelayToNextAlignedTime();
    const nextTime = this.getNextAlignedTimeString();
    console.log(`⏰ First poll scheduled at ${nextTime} (in ${Math.round(delay / 1000)}s)`);

    this.timeoutId = setTimeout(() => {
      this.timeoutId = null;
      this.poll();
      this.intervalId = setInterval(() => {
        this.poll();
      }, this.pollIntervalMs);
    }, delay);
  }

  stop() {
    const wasStopped = this.intervalId || this.timeoutId;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }

    if (wasStopped) {
      console.log('🛑 Poller stopped');
    }
  }

  async poll() {
    if (this.isPolling) {
      console.log('⏭️  Skipping poll - previous poll still running');
      return;
    }

    this.isPolling = true;

    try {
      const wallets = this.store.getAllMonitoredWallets();

      if (wallets.length === 0) {
        console.log('💤 No wallets to monitor');
        this.isPolling = false;
        return;
      }

      console.log(`🔍 Polling ${wallets.length} wallet(s)...`);

      for (const wallet of wallets) {
        await this.checkWallet(wallet);
      }

      console.log('✓ Poll cycle complete');
    } catch (error) {
      console.error('❌ Error during poll:', error);
    } finally {
      this.isPolling = false;
    }
  }

  async checkWallet(walletAddress) {
    try {
      const allRequestIds = await this.contractService.getRequestsByOwner(walletAddress);

      if (allRequestIds.length === 0) {
        console.log(`  ${walletAddress}: No requests found`);
        return;
      }

      const activeRequestIds = await this.contractService.filterActiveRequests(allRequestIds);

      if (activeRequestIds.length === 0) {
        console.log(`  ${walletAddress}: All requests claimed/expired`);
        await this.handleAllRequestsInactive(walletAddress);
        return;
      }

      const chatIds = this.store.getChatsForWallet(walletAddress);
      for (const chatId of chatIds) {
        this.store.shouldSendCompletion(chatId, activeRequestIds.length);
      }

      const claimableRequestIds = await this.getClaimableFromActive(activeRequestIds);

      if (claimableRequestIds.length > 0) {
        console.log(`  ${walletAddress}: ${claimableRequestIds.length} claimable request(s)`);
        await this.notifyChatsForWallet(walletAddress, claimableRequestIds, activeRequestIds);
      } else {
        console.log(`  ${walletAddress}: ${activeRequestIds.length} active, 0 claimable`);
      }
    } catch (error) {
      console.error(`  Error checking wallet ${walletAddress}:`, error.message);
    }
  }

  async getClaimableFromActive(activeRequestIds) {
    const claimableChecks = await Promise.all(
      activeRequestIds.map(async (id) => ({
        id,
        canClaim: await this.contractService.canClaimRequest(id)
      }))
    );

    return claimableChecks
      .filter(r => r.canClaim)
      .map(r => r.id);
  }

  async notifyChatsForWallet(walletAddress, claimableRequestIds, activeRequestIds) {
    const chatIds = this.store.getChatsForWallet(walletAddress);

    for (const chatId of chatIds) {
      this.store.cleanupInactiveRequests(chatId, activeRequestIds);

      const requestsToNotify = claimableRequestIds.filter(requestId =>
        this.store.shouldNotify(chatId, requestId)
      );

      if (requestsToNotify.length === 0) {
        continue;
      }

      await this.sendNotification(chatId, walletAddress, requestsToNotify);
      for (const requestId of requestsToNotify) {
        this.store.recordNotification(chatId, requestId);
      }
    }
  }

  async sendNotification(chatId, walletAddress, requestIds) {
    try {
      const shortAddress = `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;

      let message = `🎉 *Withdrawal Ready*\n\n`;
      message += `\`${shortAddress}\`\n\n`;

      for (const id of requestIds) {
        message += `• Request #${id}\n`;
      }

      message += `\nReady to claim on Avalanche C-Chain`;

      await this.bot.api.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🌐 Claim on hypha.sh/unstake', url: 'https://hypha.sh/unstake' }]
          ]
        }
      });

      console.log(`  ✉️  Notified chat ${chatId} about ${requestIds.length} request(s)`);
    } catch (error) {
      console.error(`  Failed to send notification to chat ${chatId}:`, error.message);
    }
  }

  async handleAllRequestsInactive(walletAddress) {
    const chatIds = this.store.getChatsForWallet(walletAddress);

    for (const chatId of chatIds) {
      this.store.cleanupInactiveRequests(chatId, []);

      if (this.store.shouldSendCompletion(chatId, 0)) {
        try {
          await this.bot.api.sendMessage(
            chatId,
            `✅ All withdrawal requests claimed or expired.`
          );

          this.store.markCompletionSent(chatId);
          console.log(`  ✉️  Sent completion message to chat ${chatId}`);
        } catch (error) {
          console.error(`  Failed to send completion message to chat ${chatId}:`, error.message);
        }
      }
    }
  }
}
