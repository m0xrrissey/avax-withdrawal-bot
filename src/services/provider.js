import { ethers } from 'ethers';

/**
 * Resilient RPC provider with fallback support and retry logic
 * Automatically switches between multiple RPC endpoints on failure
 */
export class ResilientProvider {
  constructor(rpcUrls = null, options = {}) {
    // Default Avalanche C-Chain RPC endpoints
    this.rpcUrls = rpcUrls || [
      'https://api.avax.network/ext/bc/C/rpc',           // Official Avalanche RPC
      'https://avalanche-c-chain.publicnode.com',         // PublicNode
      'https://rpc.ankr.com/avalanche',                   // Ankr
      'https://1rpc.io/avax/c'                            // 1RPC
    ];

    // Configuration
    this.maxRetries = options.maxRetries || 3;
    this.timeout = options.timeout || 30000; // 30 seconds
    this.retryDelay = options.retryDelay || 1000; // Start with 1 second
    this.maxRetryDelay = options.maxRetryDelay || 10000; // Max 10 seconds

    // Current provider index
    this.currentProviderIndex = 0;

    // Initialize providers
    this.providers = this.rpcUrls.map(url => this.createProvider(url));

    console.log(`✅ Initialized ResilientProvider with ${this.providers.length} RPC endpoints`);
  }

  /**
   * Create a provider with timeout configuration
   * @param {string} url - RPC URL
   * @returns {ethers.JsonRpcProvider}
   */
  createProvider(url) {
    const provider = new ethers.JsonRpcProvider(url, undefined, {
      staticNetwork: true,
      batchMaxCount: 1 // Disable batching for better error handling
    });

    // Set timeout on the connection
    if (provider._getConnection) {
      const connection = provider._getConnection();
      connection.timeout = this.timeout;
    }

    return provider;
  }

  /**
   * Get the current active provider
   * @returns {ethers.JsonRpcProvider}
   */
  getProvider() {
    return this.providers[this.currentProviderIndex];
  }

  /**
   * Switch to the next provider in the list
   */
  switchToNextProvider() {
    this.currentProviderIndex = (this.currentProviderIndex + 1) % this.providers.length;
    console.log(`🔄 Switched to RPC endpoint: ${this.rpcUrls[this.currentProviderIndex]}`);
  }

  /**
   * Execute a provider call with retry logic and fallback support
   * @param {Function} fn - Async function that uses the provider
   * @param {string} operationName - Name of the operation (for logging)
   * @returns {Promise<any>} Result of the operation
   */
  async executeWithRetry(fn, operationName = 'RPC call') {
    let lastError = null;
    let attempt = 0;
    let delay = this.retryDelay;

    // Try each provider
    for (let providerAttempt = 0; providerAttempt < this.providers.length; providerAttempt++) {
      const provider = this.getProvider();

      // Retry on current provider
      for (attempt = 0; attempt < this.maxRetries; attempt++) {
        try {
          // Add timeout wrapper
          const result = await this.withTimeout(
            fn(provider),
            this.timeout,
            `${operationName} timeout after ${this.timeout}ms`
          );

          // Success - reset to primary provider if we had switched
          if (this.currentProviderIndex !== 0) {
            console.log(`✅ ${operationName} succeeded, resetting to primary RPC`);
            this.currentProviderIndex = 0;
          }

          return result;
        } catch (error) {
          lastError = error;

          // Log the error
          console.error(
            `⚠️  ${operationName} failed (provider ${this.currentProviderIndex + 1}/${this.providers.length}, ` +
            `attempt ${attempt + 1}/${this.maxRetries}):`,
            error.message
          );

          // If it's a non-retryable error, break immediately
          if (this.isNonRetryableError(error)) {
            console.log(`❌ Non-retryable error, skipping further retries`);
            break;
          }

          // Wait before retrying (exponential backoff)
          if (attempt < this.maxRetries - 1) {
            await this.sleep(delay);
            delay = Math.min(delay * 2, this.maxRetryDelay);
          }
        }
      }

      // If we exhausted retries on this provider, try the next one
      if (providerAttempt < this.providers.length - 1) {
        this.switchToNextProvider();
        delay = this.retryDelay; // Reset delay for new provider
      }
    }

    // All providers and retries failed
    throw new Error(
      `${operationName} failed after trying all ${this.providers.length} providers: ${lastError?.message || 'Unknown error'}`
    );
  }

  /**
   * Check if an error is non-retryable (e.g., invalid parameters)
   * @param {Error} error - Error to check
   * @returns {boolean}
   */
  isNonRetryableError(error) {
    const message = error.message?.toLowerCase() || '';

    // Non-retryable error patterns
    const nonRetryablePatterns = [
      'invalid address',
      'invalid argument',
      'missing argument',
      'invalid parameters',
      'execution reverted',
      'call exception'
    ];

    return nonRetryablePatterns.some(pattern => message.includes(pattern));
  }

  /**
   * Wrap a promise with a timeout
   * @param {Promise} promise - Promise to wrap
   * @param {number} timeoutMs - Timeout in milliseconds
   * @param {string} errorMessage - Error message on timeout
   * @returns {Promise}
   */
  async withTimeout(promise, timeoutMs, errorMessage) {
    let timeoutId;

    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(errorMessage));
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([promise, timeoutPromise]);
      clearTimeout(timeoutId);
      return result;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * Sleep for a specified duration
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get network information
   * @returns {Promise<ethers.Network>}
   */
  async getNetwork() {
    return this.executeWithRetry(
      async (provider) => provider.getNetwork(),
      'getNetwork'
    );
  }

  /**
   * Get block number
   * @returns {Promise<number>}
   */
  async getBlockNumber() {
    return this.executeWithRetry(
      async (provider) => provider.getBlockNumber(),
      'getBlockNumber'
    );
  }

  /**
   * Call a contract method
   * @param {Object} transaction - Transaction object
   * @returns {Promise<string>}
   */
  async call(transaction) {
    return this.executeWithRetry(
      async (provider) => provider.call(transaction),
      'call'
    );
  }

  /**
   * Get contract instance with resilient provider
   * @param {string} address - Contract address
   * @param {Array} abi - Contract ABI
   * @returns {ethers.Contract}
   */
  getContract(address, abi) {
    // Return contract with current provider
    // Note: Contract calls will automatically use the provider
    return new ethers.Contract(address, abi, this.getProvider());
  }

  /**
   * Wrap contract method calls with retry logic
   * @param {ethers.Contract} contract - Contract instance
   * @param {string} methodName - Method name to call
   * @param {Array} args - Method arguments
   * @returns {Promise<any>}
   */
  async callContractMethod(contract, methodName, args = []) {
    return this.executeWithRetry(
      async (provider) => {
        // Create new contract instance with current provider
        const contractWithProvider = new ethers.Contract(
          contract.target,
          contract.interface,
          provider
        );
        return contractWithProvider[methodName](...args);
      },
      `${methodName}(${args.join(', ')})`
    );
  }
}
