import { BigNumberish, Wallet, providers, BigNumber } from "ethers";
import { Provider, TransactionRequest } from "@ethersproject/abstract-provider";
import { SigningKey } from "@ethersproject/signing-key";
import { defineReadOnly } from "@ethersproject/properties";
import { ExternallyOwnedAccount } from "@ethersproject/abstract-signer";
import { BytesLike } from "@ethersproject/bytes";
import { keccak256 } from "@ethersproject/keccak256";
import {
  getConfirmation,
  getTimeout,
  __setTimeoutConfig,
} from "./confirmation";

// Description of the Request table in the database
export interface Request {
  id?: number; // Auto-increment primary key
  functionData: string;
  txId?: string; // layer1 txId set through event watcher with confirmation, higher certainty
  chainId: number; // Mainchain chainId
  logId?: number; // Used by external programs
  createdAt?: number;
}

// Description of the PackedTransaction table in the database
export interface PackedTransaction {
  id?: number; // Auto-increment primary key
  nonce: number;
  transactionHash: string;
  chainId: number;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  gasPrice: string;
  requestIds: number[];
  confirmation: number;
  createdAt?: number;
}

export abstract class IOrderedRequestStore {
  // Insert requests into the database and return the primary key ids of the inserted data
  abstract setRequests(requests: Request[]): Promise<number[]>;

  // Get requests where id >= minimalId
  abstract getRequests(
    chainId: number,
    minimalId: number,
    limit: number
  ): Promise<Request[]>;

  // Batch update txid
  abstract updateRequestBatch(ids: number[], txid: string);

  // Insert packed transaction into the database
  abstract setPackedTransaction(tx: PackedTransaction);

  // Get the latest packed transaction inserted into the database, max(id)
  abstract getLatestPackedTransaction(
    chainId: number,
    nonce?: number
  ): Promise<PackedTransaction | null>;

  // Get all packed transactions matching the given nonce and chainId
  abstract getPackedTransaction(
    nonce: number,
    chainId: number
  ): Promise<PackedTransaction[]>;

  // Return the most recent data that is less than maxid
  // SELECT * FROM <TABLE_PACKED_TRANSACTION> ORDER BY ID DESC WHERE ID < `maxId` LIMIT 1;
  abstract getMaxIDPackedTransaction(
    chainId: number,
    maxId: number
  ): Promise<PackedTransaction | null>;

  abstract setPackedTransactionConfirmation(id: number, confirmation: number);
}

//requestCountLimit: maximum number of requests in a PackedTx
//delayedSecond: maximum delay for a request to be packed, to wait for more transactions to be included in a PackedTx and avoid frequent rePacking that may result in high gas price.
// If delayedSecond = 0, make sure not to call sendTransactions frequently, otherwise frequent rePacking will occur.
export class ParallelSigner extends Wallet {
  readonly chainId: number;
  constructor(
    privateKey: BytesLike | ExternallyOwnedAccount | SigningKey,
    provider: providers.JsonRpcProvider,
    readonly requestStore: IOrderedRequestStore,
    readonly requestCountLimit: number,
    private populateFun: (requests: Request[]) => Promise<{
      to: string;
      data: string;
      value?: BigNumberish;
      gasLimit: BigNumberish;
      maxFeePerGas?: string;
      maxPriorityFeePerGas?: string;
      gasPrice?: string;
    }>,
    readonly delayedSecond: number = 0,
    readonly checkPackedTransactionIntervalSecond: number = 15
  ) {
    super(privateKey, provider);

    if (provider && !Provider.isProvider(provider)) {
      throw Error("invalid provider");
    }
    if (requestStore === undefined) {
      throw Error("request store is undefined");
    }

    defineReadOnly(
      this,
      "chainId",
      (this.provider as any)?._network?.chainId ??
        (this.provider as any)?.network?.chainId
    );
  }
  public mockProvider = {}; //TODO only for test,
  //TODO only for test
  async sendRawTransaction(
    transaction: TransactionRequest,
    rawTx: string,
    packedTx: PackedTransaction
  ): Promise<providers.TransactionResponse> {
    if (this.mockProvider["sendTransaction"]) {
      const mockRes = this.mockProvider["sendTransaction"](
        transaction,
        rawTx,
        packedTx
      );
      if (mockRes !== true) {
        return mockRes;
      }
    }
    return this.provider.sendTransaction(rawTx);
  }

  //TODO only for test
  async mockProviderMethod(
    methodName: string,
    defaultMethod: Function,
    ...args: any[]
  ) {
    if (this.mockProvider[methodName]) {
      const mockRes = this.mockProvider[methodName](...args);
      if (mockRes !== true) {
        return mockRes;
      }
    }
    return await defaultMethod.call(this, ...args); //TODO why?
  }

  async getTransactionCount(tag: string): Promise<number> {
    return this.mockProviderMethod(
      "getTransactionCount",
      super.getTransactionCount,
      tag
    );
  }

  async getTransactionReceipt(
    tx: string
  ): Promise<providers.TransactionReceipt> {
    return await this.mockProviderMethod(
      "getTransactionReceipt",
      this.provider.getTransactionReceipt,
      tx
    );
  }
  
  //TODO should refactor. At least support two types of log output: info and debug
  private logger = console.log;
  async setLogger(_logger: (...data: any[]) => any) {
    this.logger = _logger;
  }
  async init() {
    this.timeHandler[0] = setInterval(async () => {
      await this.checkPackedTransaction();
    }, this.checkPackedTransactionIntervalSecond * 1000);

    const intervalTime =
      this.delayedSecond === 0
        ? getTimeout(this.chainId) / 2000 // If there is no delay configuration, the default check time is half of the expiration time
        : this.delayedSecond;
    this.timeHandler[1] = setInterval(async () => {
      const requests = await this.rePackedTransaction();
      const currentNonce: number = await this.getTransactionCount("latest");
      await this.sendPackedTransaction(requests, currentNonce);
    }, intervalTime * 1000);
  }

  private timeHandler = [];
  async clearTimeHandler() {
    this.timeHandler.forEach((v) => {
      clearInterval(v);
    });
  }

  async __rePack() {
    const requests = await this.rePackedTransaction();
    const currentNonce: number = await this.getTransactionCount("latest");
    await this.sendPackedTransaction(requests, currentNonce);
  }

  async __checkPackedTx() {
    await this.checkPackedTransaction();
  }

  async __setTimeout(chainId: number, timeout: number) {
    __setTimeoutConfig(chainId, timeout);
  }
  async sendTransactions(
    txs: {
      functionData: string;
      logId: number;
    }[]
  ): Promise<number[]> {
    const currentNonce: number = await this.getTransactionCount("latest");

    if (!txs || txs.length == 0) {
      return;
    }
    const requests: Request[] = txs.map((v) => {
      return {
        functionData: v.functionData,
        chainId: this.chainId,
        logId: v.logId,
      };
    });
    // Only ensure successful write to the database
    const res = await this.requestStore.setRequests(requests);

    // When there is no delay, only process transactions within the limit of the requestCountLimit for this batch. Others will be stored in the database and processed by the scheduled task.
    // The requests may exceed the limit, but the rePackedTransaction method will handle the limit
    if (this.delayedSecond == 0) {
      const rePackedRequests = await this.rePackedTransaction();
      await this.sendPackedTransaction(rePackedRequests, currentNonce);
    }
    return res;
  }
  // Each repacked transaction should be an independent process, discovering the current state on the chain, checking the progress in the database, and finding the correct starting position for the request

  private async rePackedTransaction(): Promise<Request[]> {
    let latestPackedTx = await this.requestStore.getLatestPackedTransaction(
      this.chainId
    );
    const currentNonce: number = await this.getTransactionCount("latest");
    let minimalId = 0; // Start searching for requests from this id

    // If latestPackedTx exists, find minimalId to search for requests
    if (latestPackedTx !== null) {
      if (currentNonce == latestPackedTx.nonce) {
        // If there are no new requests, wait. If there are new requests, repack.
        // If the current nonce has not been successfully confirmed on the chain, repacking should not continue. It should wait for the checkPackedTransaction timer to execute.
        let maxid = Math.max(...latestPackedTx.requestIds);

        let rqx = await this.requestStore.getRequests(
          this.chainId,
          maxid + 1,
          this.requestCountLimit
        );
        if (
          latestPackedTx.requestIds.length < this.requestCountLimit &&
          rqx.length > 0
        ) {
          this.logger("NEW DATA REPACK");
          // If the limit is not reached and new data comes in, and this function has been called externally, it means that the repack action can be performed
          minimalId = Math.min(...latestPackedTx.requestIds) - 1;
        } else {
          // If there is no new data or the limit has been reached, check if it has timed out

          let gapTime = new Date().getTime() - (latestPackedTx.createdAt ?? 0);
          this.logger(
            `gapTime: ${gapTime}  timeout: ${getTimeout(
              this.chainId
            )} createdAt: ${latestPackedTx.createdAt}`
          );
          if (gapTime > getTimeout(this.chainId)) {
            // Timeout
            this.logger("TIMEOUT REPACK");
            minimalId = Math.min(...latestPackedTx.requestIds) - 1;
          } else {
            // Neither new data nor timeout
            return [];
          }
        }
      } else {
        /**
         * Next, execute the logic to search for the deadline, find the deadline, and then repack
         * 1. Find packedTx with nonce less than currentNonce
         * 2. The txid of packedTx is successfully confirmed on the chain
         * 3. Find the ids
         * 4. Find the requests
         * END
         */

        // Only currentNonce - latestPackedTx.nonce = 1 is a normal situation
        let lastCheckedId: number = latestPackedTx.id
          ? latestPackedTx.id + 1
          : 0;
        while (true) {
          let packedTx = await this.requestStore.getMaxIDPackedTransaction(
            this.chainId,
            lastCheckedId
          );
          if (packedTx == null) {
            // Reached the lowest point
            break;
          }
          // All are exceptional cases
          if (packedTx.nonce >= currentNonce) {
            lastCheckedId = packedTx.id ?? 0;
            continue;
          }

          let latestCheckedPackedTxs =
            await this.requestStore.getPackedTransaction(
              packedTx.nonce,
              this.chainId
            );

          for (let k in latestCheckedPackedTxs) {
            packedTx = latestCheckedPackedTxs[k];
            lastCheckedId = Math.min(packedTx.id ?? 0, lastCheckedId);
            let recpt = await this.getTransactionReceipt(
              packedTx.transactionHash
            );
            if (recpt != null) {
              // Transaction confirmed on the chain
              // Find the position of the largest request in ids
              // Start from minimalId + 1 for the next repack
              minimalId = Math.max(...packedTx.requestIds);
              break;
            }
          }
          if (minimalId > 0) {
            break;
          }
        }
      }
    }

    let storedRequest = await this.requestStore.getRequests(
      this.chainId,
      minimalId + 1,
      this.requestCountLimit
    );
    return storedRequest;
  }

  /**
   * Sends a packed transaction to the blockchain.
   *
   * @param requests An array of requests to be included in the packed transaction.
   * @param nonce The nonce of the packed transaction.
   */
  private async sendPackedTransaction(requests: Request[], nonce: number) {
    if (requests.length == 0) {
      return;
    }
    let txParam = await this.populateFun(requests);
    let { maxPriorityFeePerGas, maxFeePerGas, gasPrice } = txParam;

    let rtx = await this.buildTransactionRequest(txParam, nonce);
    // Populate and sign the transaction
    rtx = await this.populateTransaction(rtx);
    const signedTx = await this.signTransaction(rtx);
    let txid = keccak256(signedTx);
    let requestsIds: number[] = requests.map((v) => {
      if (v.id === 0 || v.id === undefined) {
        throw new Error("request id has not been assigned");
      }
      return v.id;
    });

    // Create a new packed transaction
    let packedTx: PackedTransaction = {
      gasPrice: (gasPrice ?? "").toString(),
      maxFeePerGas: maxFeePerGas ?? "",
      maxPriorityFeePerGas: maxPriorityFeePerGas ?? "",
      nonce: nonce,
      confirmation: 0,
      transactionHash: txid,
      chainId: this.chainId,
      requestIds: requestsIds,
    };
    await this.requestStore.setPackedTransaction(packedTx);
    this.logger(
      "PackedTransaction: " +
        txid +
        "  nonce: " +
        nonce +
        "  requestsCount: " +
        requests.length +
        "  chainId: " +
        this.chainId +
        "  gasPrice:maxFeePerGas:maxPriorityFeePerGas: " +
        gasPrice +
        ":" +
        maxFeePerGas +
        ":" +
        maxPriorityFeePerGas
    );
    this.sendRawTransaction(rtx, signedTx, packedTx);
  }

  private async buildTransactionRequest(
    txParam,
    nonce: number
  ): Promise<TransactionRequest> {
    let {
      to,
      data,
      gasLimit,
      maxPriorityFeePerGas,
      maxFeePerGas,
      gasPrice,
      value,
    } = txParam;

    // Create a new transaction request
    let rtx: TransactionRequest = {
      to: to,
      data: data,
      gasLimit: gasLimit,
      nonce: nonce,
      value: value,
      chainId: this.chainId,
    };

    // Get the latest packed transaction for the given nonce and chainId
    let latestPackedTx = await this.requestStore.getLatestPackedTransaction(
      this.chainId,
      nonce
    );
    if (latestPackedTx === null) {
      //first tx
      if (maxFeePerGas != null && maxPriorityFeePerGas != null) {
        rtx.maxFeePerGas = maxFeePerGas;
        rtx.maxPriorityFeePerGas = maxPriorityFeePerGas;
      } else if (gasPrice != null) {
        rtx.gasPrice = gasPrice;
      } else {
        throw new Error("gas price error");
      }
      return rtx;
    }

    // Set gas price based on the latest packed transaction
    if (maxFeePerGas != null && maxPriorityFeePerGas != null) {
      const nextMaxFeePerGas = BigNumber.from(latestPackedTx.maxFeePerGas)
        .mul(110)
        .div(100);
      const finalMaxFeePerGas = nextMaxFeePerGas.gt(maxFeePerGas)
        ? nextMaxFeePerGas
        : maxFeePerGas;
      rtx.maxFeePerGas = finalMaxFeePerGas;

      const nextMaxPriorityFeePerGas = BigNumber.from(
        latestPackedTx.maxPriorityFeePerGas
      )
        .mul(110)
        .div(100);
      const finalMaxPriorityFeePerGas = nextMaxPriorityFeePerGas.gt(
        maxPriorityFeePerGas
      )
        ? nextMaxPriorityFeePerGas
        : maxPriorityFeePerGas;

      rtx.maxPriorityFeePerGas = finalMaxPriorityFeePerGas;
    } else if (gasPrice != null) {
      const nextGasPrice = BigNumber.from(latestPackedTx.gasPrice)
        .mul(110)
        .div(100);
      const finalGasPrice = nextGasPrice.gt(gasPrice) ? nextGasPrice : gasPrice;
      rtx.gasPrice = finalGasPrice;
    } else {
      throw new Error("gas price error");
    }

    return rtx;
  }
  private async checkConfirmations(nonce: number): Promise<number> {
    let packedTxs = await this.requestStore.getPackedTransaction(
      nonce,
      this.chainId
    );
    if (packedTxs.length == 0) {
      // This should not happen normally
      return 0;
    }
    let result = Math.min(...packedTxs.map((v) => v.id ?? 0)); // Find the minimum id
    for (let k in packedTxs) {
      let v = packedTxs[k];
      if (v.confirmation < getConfirmation(this.chainId)) {
        let txRcpt = await this.getTransactionReceipt(v.transactionHash);

        if (txRcpt != null) {
          if (txRcpt.confirmations >= getConfirmation(this.chainId)) {
            // Set request txid by v.txhash
            await this.requestStore.updateRequestBatch(
              v.requestIds,
              v.transactionHash
            );
            // If data satisfying the confirmation requirement is found, return 0 to stop further searching
            result = 0;
          }
          // Update confirmation to db
          await this.requestStore.setPackedTransactionConfirmation(
            v.id ?? 0,
            txRcpt.confirmations
          );
          // There can be at most one packedTx with data on the chain
          break;
        }
      } else {
        result = 0; // Already found data satisfying the confirmation requirement, immediately exit the loop
        break;
      }
    }

    return result;
  }
  /**
   * Scheduled task with two purposes
   * 1. Check the on-chain status of PackedTransaction
   * 2. Update confirmation, if confirmation is sufficient, set txid to the request table
   *
   * The interval time should be set to around 15 seconds, too frequent has little significance
   **/
  private async checkPackedTransaction() {
    this.logger(`Interval checkPackedTransaction`);
    let currentNonce = await this.getTransactionCount("latest");
    if (currentNonce == 0) {
      return;
    }
    let lastestTx = await this.requestStore.getLatestPackedTransaction(
      this.chainId,
      currentNonce - 1
    );
    if (lastestTx == null) {
      // This will cause an exit. If the data of currentNonce - 1 cannot be found, it will cause an exit
      lastestTx = await this.requestStore.getLatestPackedTransaction(
        this.chainId
      );
      if (lastestTx == null) {
        return;
      }
    }

    let lastCheckedId = lastestTx.id ?? 0;
    lastCheckedId += 1; // Ensure that this batch is within the check of the while loop
    while (lastCheckedId > 0) {
      // Find the next one
      let nextTx = await this.requestStore.getMaxIDPackedTransaction(
        this.chainId,
        lastCheckedId
      );
      if (nextTx == null) {
        // Reached the lowest point
        break;
      }
      if (nextTx.nonce >= currentNonce) {
        lastCheckedId = nextTx.id;
        continue;
      }
      // Use return 0 to interrupt the while loop
      lastCheckedId = await this.checkConfirmations(nextTx.nonce);
    }
  }
}
