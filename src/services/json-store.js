import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * JSON-based persistent storage (no native dependencies)
 * Simple, reliable, and works on all platforms
 */
export class JsonStore {
  constructor(dbPath = null) {
    // Default to data/bot-data.json relative to project root
    const defaultPath = path.join(__dirname, '../../data/bot-data.json');
    this.dbPath = dbPath || defaultPath;

    // Ensure data directory exists
    const dataDir = path.dirname(this.dbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Load data
    this.data = this.loadData();
    console.log('✅ JSON store initialized');
  }

  /**
   * Load data from file
   */
  loadData() {
    if (fs.existsSync(this.dbPath)) {
      try {
        const json = fs.readFileSync(this.dbPath, 'utf8');
        return JSON.parse(json);
      } catch (error) {
        console.error('⚠️  Failed to load data, starting fresh:', error.message);
      }
    }

    return {
      subscriptions: {},
      notificationHistory: {},
      completionStatus: {}
    };
  }

  /**
   * Save data to file
   */
  saveData() {
    try {
      fs.writeFileSync(this.dbPath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (error) {
      console.error('❌ Failed to save data:', error.message);
    }
  }

  /**
   * Subscribe a chat to notifications for a wallet
   */
  subscribe(chatId, walletAddress, frequencySeconds) {
    this.data.subscriptions[chatId] = {
      walletAddress: walletAddress.toLowerCase(),
      frequencySeconds,
      active: true,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    // Reset completion status
    delete this.data.completionStatus[chatId];

    this.saveData();
    console.log(`✓ Subscribed chat ${chatId} to wallet ${walletAddress} (freq: ${frequencySeconds}s)`);
  }

  /**
   * Unsubscribe a chat from notifications
   */
  unsubscribe(chatId) {
    if (this.data.subscriptions[chatId]) {
      delete this.data.subscriptions[chatId];

      // Clean up related data
      Object.keys(this.data.notificationHistory).forEach(key => {
        if (key.startsWith(`${chatId}:`)) {
          delete this.data.notificationHistory[key];
        }
      });
      delete this.data.completionStatus[chatId];

      this.saveData();
      console.log(`✓ Unsubscribed chat ${chatId}`);
      return true;
    }
    return false;
  }

  /**
   * Get subscription info for a chat
   */
  getSubscription(chatId) {
    const sub = this.data.subscriptions[chatId];
    if (!sub) return null;

    return {
      walletAddress: sub.walletAddress,
      frequencySeconds: sub.frequencySeconds,
      active: sub.active
    };
  }

  /**
   * Get all unique wallet addresses being monitored
   */
  getAllMonitoredWallets() {
    const wallets = new Set();
    Object.values(this.data.subscriptions).forEach(sub => {
      if (sub.active) {
        wallets.add(sub.walletAddress);
      }
    });
    return Array.from(wallets);
  }

  /**
   * Get all chat IDs subscribed to a wallet
   */
  getChatsForWallet(walletAddress) {
    const chats = [];
    const normalizedAddress = walletAddress.toLowerCase();

    Object.entries(this.data.subscriptions).forEach(([chatId, sub]) => {
      if (sub.active && sub.walletAddress === normalizedAddress) {
        chats.push(parseInt(chatId));
      }
    });

    return chats;
  }

  /**
   * Check if a notification should be sent based on frequency
   */
  shouldNotify(chatId, requestId) {
    const sub = this.data.subscriptions[chatId];
    if (!sub) return false;

    const key = `${chatId}:${requestId}`;
    const history = this.data.notificationHistory[key];

    // First notification - always send
    if (!history) {
      return true;
    }

    // Check if enough time has passed based on frequency
    const now = Date.now();
    const timeSinceLastNotification = now - history.lastNotifiedAt;
    const frequencyMs = sub.frequencySeconds * 1000;

    return timeSinceLastNotification >= frequencyMs;
  }

  /**
   * Record that a notification was sent
   */
  recordNotification(chatId, requestId) {
    const key = `${chatId}:${requestId}`;
    const now = Date.now();
    const existing = this.data.notificationHistory[key];

    if (existing) {
      existing.lastNotifiedAt = now;
    } else {
      this.data.notificationHistory[key] = {
        firstNotifiedAt: now,
        lastNotifiedAt: now
      };
    }

    this.saveData();
  }

  /**
   * Clean up notification history for inactive requests
   */
  cleanupInactiveRequests(chatId, activeRequestIds) {
    const prefix = `${chatId}:`;
    const activeSet = new Set(activeRequestIds);

    Object.keys(this.data.notificationHistory).forEach(key => {
      if (key.startsWith(prefix)) {
        const requestId = key.slice(prefix.length);
        if (!activeSet.has(requestId)) {
          delete this.data.notificationHistory[key];
        }
      }
    });

    this.saveData();
  }

  /**
   * Check if we should send the completion notification
   */
  shouldSendCompletion(chatId, requestCount) {
    const status = this.data.completionStatus[chatId];

    // If no status or request count changed from 0 to something else, reset
    if (!status || (status.lastRequestCount === 0 && requestCount > 0)) {
      this.data.completionStatus[chatId] = {
        completionSent: false,
        lastRequestCount: requestCount,
        updatedAt: Date.now()
      };
      this.saveData();
      return requestCount === 0;
    }

    // If request count is 0 and we haven't sent completion yet
    if (requestCount === 0 && !status.completionSent) {
      return true;
    }

    // Update request count for tracking
    if (status.lastRequestCount !== requestCount) {
      status.lastRequestCount = requestCount;
      status.updatedAt = Date.now();
      // If we now have requests again, reset completion flag
      if (requestCount > 0) {
        status.completionSent = false;
      }
      this.saveData();
    }

    return false;
  }

  /**
   * Mark that completion notification was sent
   */
  markCompletionSent(chatId) {
    if (!this.data.completionStatus[chatId]) {
      this.data.completionStatus[chatId] = { lastRequestCount: 0 };
    }
    this.data.completionStatus[chatId].completionSent = true;
    this.data.completionStatus[chatId].updatedAt = Date.now();
    this.saveData();
  }

  /**
   * Reset completion status
   */
  resetCompletionStatus(chatId) {
    delete this.data.completionStatus[chatId];
    this.saveData();
  }

  /**
   * Get stats for monitoring
   */
  getStats() {
    const activeSubscriptions = Object.values(this.data.subscriptions).filter(s => s.active).length;
    const uniqueWallets = this.getAllMonitoredWallets().length;
    const notificationHistory = Object.keys(this.data.notificationHistory).length;

    return {
      totalSubscriptions: activeSubscriptions,
      totalWallets: uniqueWallets,
      totalNotificationHistory: notificationHistory
    };
  }

  /**
   * Close (save final state)
   */
  close() {
    this.saveData();
    console.log('✅ JSON store closed');
  }
}
