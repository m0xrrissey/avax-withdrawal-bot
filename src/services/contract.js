import { ethers } from 'ethers';
import { WITHDRAW_QUEUE_ABI } from '../utils/abi.js';
import { ResilientProvider } from './provider.js';

export class ContractService {
  constructor(rpcUrl, contractAddress, fallbackRpcUrls = null) {
    this.resilientProvider = new ResilientProvider(
      fallbackRpcUrls || [rpcUrl],
      {
        maxRetries: 3,
        timeout: 30000,
        retryDelay: 1000,
        maxRetryDelay: 10000
      }
    );

    this.contractAddress = contractAddress;
    this.contract = this.resilientProvider.getContract(
      contractAddress,
      WITHDRAW_QUEUE_ABI
    );
  }

  async getRequestsByOwner(address) {
    try {
      const requestIds = await this.resilientProvider.callContractMethod(
        this.contract,
        'getRequestsByOwner',
        [address, 0, 0]
      );
      const result = requestIds.map(id => id.toString());
      console.log(`  Found ${result.length} total request(s) for ${address.slice(0, 6)}...${address.slice(-4)}`);
      return result;
    } catch (error) {
      console.error(`  ❌ Error fetching requests for ${address}:`, error.message);
      return [];
    }
  }

  async canClaimRequest(requestId) {
    try {
      return await this.resilientProvider.callContractMethod(
        this.contract,
        'canClaimRequest',
        [requestId]
      );
    } catch (error) {
      console.error(`Error checking claimability for request ${requestId}:`, error.message);
      return false;
    }
  }

  async getRequestInfo(requestId) {
    try {
      const [requester, shares, expectedAssets, requestTime, claimableTime, expirationTime, allocatedFunds] =
        await this.resilientProvider.callContractMethod(
          this.contract,
          'getRequestInfo',
          [requestId]
        );

      const result = {
        requester,
        shares: shares.toString(),
        expectedAssets: expectedAssets.toString(),
        requestTime: Number(requestTime),
        claimableTime: Number(claimableTime),
        expirationTime: Number(expirationTime),
        allocatedFunds: allocatedFunds.toString()
      };

      console.log(`    getRequestInfo(${requestId}):`, {
        requester,
        shares: shares.toString(),
        expectedAssets: expectedAssets.toString(),
        requestTime: `${new Date(Number(requestTime) * 1000).toLocaleString()}`,
        claimableTime: `${new Date(Number(claimableTime) * 1000).toLocaleString()}`,
        expirationTime: `${new Date(Number(expirationTime) * 1000).toLocaleString()}`,
        allocatedFunds: allocatedFunds.toString()
      });

      return result;
    } catch (error) {
      console.error(`Error fetching info for request ${requestId}:`, error.message);
      return null;
    }
  }

  async isRequestInactive(requestId) {
    const info = await this.getRequestInfo(requestId);
    if (!info) {
      console.log(`    Request #${requestId}: Failed to get info, assuming inactive`);
      return true;
    }

    const isClaimed = info.requester === ethers.ZeroAddress;
    console.log(`    Request #${requestId}: ${isClaimed ? 'CLAIMED (inactive)' : 'ACTIVE'} (requester: ${info.requester})`);
    return isClaimed;
  }

  async filterActiveRequests(requestIds) {
    const results = await Promise.all(
      requestIds.map(async (id) => ({
        id,
        isActive: !(await this.isRequestInactive(id))
      }))
    );

    return results
      .filter(r => r.isActive)
      .map(r => r.id);
  }

  async getClaimableRequests(address) {
    const allRequestIds = await this.getRequestsByOwner(address);
    const activeRequestIds = await this.filterActiveRequests(allRequestIds);

    const claimableChecks = await Promise.all(
      activeRequestIds.map(async (id) => ({
        id,
        canClaim: await this.canClaimRequest(id)
      }))
    );

    return claimableChecks
      .filter(r => r.canClaim)
      .map(r => r.id);
  }
}
