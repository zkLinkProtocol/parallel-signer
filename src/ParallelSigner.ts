import {
  BigNumberish,
  Wallet,
  JsonRpcProvider,
  SigningKey,
  TransactionResponse,
  TransactionReceipt,
  keccak256,
  TransactionRequest,
} from "ethers";
import { __setTimeoutConfig, getTimeout } from "./timer";

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

  /**
   * 
   * WITH NonceWithAllZero AS (
      SELECT 
        nonce
      FROM 
        packed_transactions
      WHERE 
        nonce < ${nonce} and chain_id= ${chain_id}
      GROUP BY 
        nonce
      HAVING 
        SUM(confirmation) = 0 AND COUNT(*) >= 1
    )

    SELECT 
      p.*
    FROM 
      packed_transactions p
    JOIN 
      NonceWithAllZero nz ON p.nonce = nz.nonce
    WHERE 
      chain_id = ${chain_id}  and p.confirmation = 0;

   */
  abstract getUnconfirmedTransactionsWithSameNonce(
    chainId: number,
    nonce: number
  ): Promise<PackedTransaction[]>;
}

export interface ParallelSignerOptions {
  readonly requestCountLimit: number; // default: 10
  readonly delayedSecond: number; // default: 0
  readonly checkPackedTransactionIntervalSecond: number; // default: 15
  readonly confirmations: number; // default: 64
  readonly checkConfirmation?: (recpt: TransactionReceipt) => Promise<void>;
  readonly layer1ChainId: number;
}

export interface PopulateReturnType {
  to: string;
  data: string;
  value?: BigNumberish;
  gasLimit: BigNumberish;
  maxFeePerGas?: null | BigNumberish;
  maxPriorityFeePerGas?: null | BigNumberish;
  gasPrice?: null | BigNumberish;
}

//requestCountLimit: maximum number of requests in a PackedTx
//delayedSecond: maximum delay for a request to be packed, to wait for more transactions to be included in a PackedTx and avoid frequent rePacking that may result in high gas price.
// If delayedSecond = 0, make sure not to call sendTransactions frequently, otherwise frequent rePacking will occur.
export class ParallelSigner extends Wallet {
  options: ParallelSignerOptions;
  constructor(
    privateKey: string | SigningKey,
    provider: JsonRpcProvider,
    readonly requestStore: IOrderedRequestStore,
    private populateFun: (requests: Request[]) => Promise<PopulateReturnType>,
    options: Partial<ParallelSignerOptions> = {}
  ) {
    super(privateKey, provider);

    if (!options.layer1ChainId) {
      throw new Error("layer1ChainId required");
    }

    this.options = {
      requestCountLimit: 10,
      delayedSecond: 0,
      checkPackedTransactionIntervalSecond: 60,
      confirmations: 64,
      layer1ChainId: 0,
      ...options,
    };

    if (requestStore === undefined) {
      throw Error("request store is undefined");
    }
  }
  getChainId(): number {
    return Number(this.options.layer1ChainId);
  }
  public mockProvider = {}; //TODO only for test,
  //TODO only for test
  async sendRawTransaction(
    transaction: TransactionRequest,
    rawTx: string,
    packedTx: PackedTransaction
  ): Promise<TransactionResponse> {
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
    return this.provider.broadcastTransaction(rawTx);
  }
  //TODO only for test
  async getTransactionCount(tag: string): Promise<number> {
    if (this.mockProvider["getTransactionCount"]) {
      const mockRes = this.mockProvider["getTransactionCount"](tag);
      if (mockRes !== true) {
        return mockRes;
      }
    }
    return this.provider.getTransactionCount(this.address, tag);
  }
  //TODO only for test
  async getTransactionReceipt(tx: string): Promise<TransactionReceipt> {
    if (this.mockProvider["getTransactionReceipt"]) {
      const mockRes = this.mockProvider["getTransactionReceipt"](tx);
      if (mockRes !== true) {
        return mockRes;
      }
    }
    return this.provider.getTransactionReceipt(tx);
  }

  //TODO should refactor. At least support two types of log output: info and debug
  private logger = console.log;
  private loggerError = console.error;
  async setLogger(_logger: (...data: any[]) => any) {
    this.logger = _logger;
  }
  async setLoggerError(_logger: (...data: any[]) => any) {
    this.loggerError = _logger;
  }

  private async printLayer1ChainId() {
    this.loggerError(`ERROR LAYER2 CHAIN_ID : ${this.getChainId()}`);
  }
  async init() {
    this.timeHandler[0] = setInterval(async () => {
      try {
        await this.checkPackedTransaction();
      } catch (err) {
        this.loggerError("ERROR checkPackedTransactionInterval");
        this.printLayer1ChainId();
        this.loggerError(err);
      }
    }, this.options.checkPackedTransactionIntervalSecond * 1000);

    const intervalTime =
      this.options.delayedSecond === 0
        ? getTimeout(this.getChainId()) / 2000 // If there is no delay configuration, the default check time is half of the expiration time
        : this.options.delayedSecond;
    this.timeHandler[1] = setInterval(async () => {
      try {
        await this.rePackedTransaction();
      } catch (err) {
        this.loggerError("ERROR rePackedTransactionInterval");
        this.printLayer1ChainId();
        this.loggerError(err);
      }
    }, intervalTime * 1000);
  }

  private timeHandler = [];
  async clearTimeHandler() {
    this.timeHandler.forEach((v) => {
      clearInterval(v);
    });
  }

  async __rePack() {
    await this.rePackedTransaction();
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
    if (!txs || txs.length == 0) {
      return;
    }
    const requests: Request[] = [];
    for (let index = 0; index < txs.length; index++) {
      const v = txs[index];
      requests.push({
        functionData: v.functionData,
        chainId: this.getChainId(),
        logId: v.logId,
      });
    }

    // Only ensure successful write to the database
    const res = await this.requestStore.setRequests(requests);

    // When there is no delay, only process transactions within the limit of the requestCountLimit for this batch. Others will be stored in the database and processed by the scheduled task.
    // The requests may exceed the limit, but the rePackedTransaction method will handle the limit
    if (this.options.delayedSecond == 0) {
      try {
        await this.rePackedTransaction();
      } catch (err) {
        this.loggerError("ERROR sendTransactions rePackedTransaction");
        this.printLayer1ChainId();
        this.loggerError(err);
      }
    }
    return res;
  }

  // Each repacked transaction should be an independent process, discovering the current state on the chain, checking the progress in the database, and finding the correct starting position for the request
  private repacking = false;
  private async rePackedTransaction() {
    if (this.repacking) return null;
    this.repacking = true;
    try {
      const currentNonce: number = await this.getTransactionCount("latest");
      const requests = await this.getRepackRequests(currentNonce);
      await this.sendPackedTransaction(requests, currentNonce);
    } catch (err) {
      this.loggerError(`ERROR rePackedTransaction`);
      this.printLayer1ChainId();
      this.loggerError(err);
      throw err;
    } finally {
      this.repacking = false;
    }
  }
  private async getRepackRequests(currentNonce: number): Promise<Request[]> {
    let latestPackedTx = await this.requestStore.getLatestPackedTransaction(
      this.getChainId()
    );
    let minimalId = 0; // Start searching for requests from this id

    // If latestPackedTx exists, find minimalId to search for requests
    if (latestPackedTx !== null) {
      if (currentNonce == latestPackedTx.nonce) {
        // If there are no new requests, wait. If there are new requests, repack.
        // If the current nonce has not been successfully confirmed on the chain, repacking should not continue. It should wait for the checkPackedTransaction timer to execute.
        let maxid = Math.max(...latestPackedTx.requestIds);

        let rqx = await this.requestStore.getRequests(
          this.getChainId(),
          maxid + 1,
          this.options.requestCountLimit
        );
        if (
          latestPackedTx.requestIds.length < this.options.requestCountLimit &&
          rqx.length > 0
        ) {
          this.logger("NEW DATA REPACK");
          // If the limit is not reached and new data comes in, and this function has been called externally, it means that the repack action can be performed
          minimalId = Math.min(...latestPackedTx.requestIds) - 1;
        } else {
          // If there is no new data or the limit has been reached, check if it has timed out

          let gapTime = new Date().getTime() - (latestPackedTx.createdAt ?? 0);
          // this.logger(
          //   `gapTime: ${gapTime}  timeout: ${getTimeout(
          //     this.getChainId()
          //   )} createdAt: ${latestPackedTx.createdAt}`
          // );
          if (gapTime > getTimeout(this.getChainId())) {
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
            this.getChainId(),
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
              this.getChainId()
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
      this.getChainId(),
      minimalId + 1,
      this.options.requestCountLimit
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
    rtx = await this.populateTransaction(rtx).catch((err) => {
      this.loggerError("ERROR populateTransaction ");
      this.printLayer1ChainId();
      throw err;
    });

    rtx.gasLimit = (BigInt(rtx.gasLimit) * BigInt(15)) / BigInt(10);

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
      gasPrice: notNil(rtx.gasPrice) ? rtx.gasPrice.toString() : "",
      maxFeePerGas: notNil(rtx.maxFeePerGas) ? rtx.maxFeePerGas.toString() : "",
      maxPriorityFeePerGas: notNil(rtx.maxPriorityFeePerGas)
        ? rtx.maxPriorityFeePerGas.toString()
        : "",
      nonce: nonce,
      confirmation: 0,
      transactionHash: txid,
      chainId: this.getChainId(),
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
        this.getChainId() +
        "  gasPrice:maxFeePerGas:maxPriorityFeePerGas: " +
        gasPrice +
        ":" +
        maxFeePerGas +
        ":" +
        maxPriorityFeePerGas
    );
    this.sendRawTransaction(rtx, signedTx, packedTx).catch((err) => {
      this.loggerError("ERROR: sendRawTransaction");
      this.printLayer1ChainId();
      this.loggerError(err);
    });
  }

  private async buildTransactionRequest(
    txParam: PopulateReturnType,
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
      chainId: this.getChainId(),
    };

    // Get the latest packed transaction for the given nonce and chainId
    let latestPackedTx = await this.requestStore.getLatestPackedTransaction(
      this.getChainId(),
      nonce
    );
    if (latestPackedTx === null) {
      //first tx

      if (notNil(maxFeePerGas) && notNil(maxPriorityFeePerGas)) {
        rtx.maxFeePerGas = maxFeePerGas;
        rtx.maxPriorityFeePerGas = maxPriorityFeePerGas;
      } else if (notNil(gasPrice) != null) {
        rtx.gasPrice = gasPrice;
      } else {
        throw new Error("gas price error");
      }
      return rtx;
    }

    // Set gas price based on the latest packed transaction
    if (notNil(maxFeePerGas) && notNil(maxPriorityFeePerGas)) {
      const nextMaxFeePerGas: BigNumberish =
        (BigInt(latestPackedTx.maxFeePerGas) * BigInt(110)) / BigInt(100);

      rtx.maxFeePerGas = this.getFinalPrice(
        BigInt(maxFeePerGas),
        nextMaxFeePerGas
      );

      const nextMaxPriorityFeePerGas =
        (BigInt(latestPackedTx.maxPriorityFeePerGas) * BigInt(110)) /
        BigInt(100);

      rtx.maxPriorityFeePerGas = this.getFinalPrice(
        BigInt(maxPriorityFeePerGas),
        nextMaxPriorityFeePerGas
      );
    } else if (notNil(gasPrice)) {
      const nextGasPrice =
        (BigInt(latestPackedTx.gasPrice) * BigInt(110)) / BigInt(100);

      rtx.gasPrice = this.getFinalPrice(BigInt(gasPrice), nextGasPrice);
    } else {
      throw new Error("gas price error");
    }

    return rtx;
  }
  private getFinalPrice(currentPrice: bigint, nextPrice: bigint): bigint {
    if (nextPrice > currentPrice) {
      const doubleCurrentPrice = currentPrice * BigInt(4);
      if (doubleCurrentPrice > nextPrice) {
        return nextPrice;
      } else {
        return doubleCurrentPrice;
      }
    } else {
      return currentPrice;
    }
  }
  private async checkRecipt(
    v: PackedTransaction,
    result: number
  ): Promise<[boolean, number]> {
    let txRcpt = await this.getTransactionReceipt(v.transactionHash);
    if (txRcpt != null) {
      if (
        this.options.checkConfirmation &&
        typeof this.options.checkConfirmation === "function"
      ) {
        this.options.checkConfirmation(txRcpt).catch((err) => {
          this.loggerError("this.options.checkConfirmation");
          this.printLayer1ChainId();
          this.loggerError(err);
        });
      }

      if ((await txRcpt.confirmations()) >= this.options.confirmations) {
        // Set request txid by v.txhash
        await this.requestStore.updateRequestBatch(
          v.requestIds,
          v.transactionHash
        );
        // If data satisfying the confirmation requirement is found, return 0 to stop further searching
        result = 0;
        // Update confirmation to db
        await this.requestStore.setPackedTransactionConfirmation(
          v.id ?? 0,
          await txRcpt.confirmations()
        );
      }
      // There can be at most one packedTx with data on the chain
      return [true, result];
    }
    return [false, result];
  }
  async checkConfirmations(nonce: number): Promise<number> {
    let packedTxs = await this.requestStore.getPackedTransaction(
      nonce,
      this.getChainId()
    );
    if (packedTxs.length == 0) {
      // This should not happen normally
      return 0;
    }
    let result = Math.min(...packedTxs.map((v) => v.id ?? 0)); // Find the minimum id
    for (let k in packedTxs) {
      let v = packedTxs[k];
      if (v.confirmation < this.options.confirmations) {
        let [isBreak, _result] = await this.checkRecipt(v, result);
        result = _result;
        if (isBreak) break;
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
    let currentNonce = await this.getTransactionCount("latest");
    if (currentNonce == 0) {
      return;
    }
    let lastestTx = await this.requestStore.getLatestPackedTransaction(
      this.getChainId(),
      currentNonce - 1
    );
    if (lastestTx == null) {
      // This will cause an exit. If the data of currentNonce - 1 cannot be found, it will cause an exit
      lastestTx = await this.requestStore.getLatestPackedTransaction(
        this.getChainId()
      );
      if (lastestTx == null) {
        return;
      }
    }

    let lastCheckedId = lastestTx.id ?? 0;
    lastCheckedId += 1; // Ensure that this batch is within the check of the while loop
    let lastCheckedNonce = lastestTx.nonce;
    while (lastCheckedId > 0) {
      // Find the next one
      let nextTx = await this.requestStore.getMaxIDPackedTransaction(
        this.getChainId(),
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
      lastCheckedNonce = nextTx.nonce;
    }

    let packedTxs: PackedTransaction[] =
      await this.requestStore.getUnconfirmedTransactionsWithSameNonce(
        this.getChainId(),
        lastCheckedNonce
      );
    let isHaveSuccess = false;
    for (let ptx of packedTxs) {
      let [isBreak, _] = await this.checkRecipt(ptx, 0);
      if (isBreak) {
        this.logger(
          `## RECHECK BY getUnconfirmedTransactionsWithSameNonce hash: ${ptx.transactionHash} ${ptx.requestIds}`
        );
      }
      //TODO  Some request IDs were skipped, a low-probability event occurred.
      isHaveSuccess = isBreak || isHaveSuccess;
    }
    //TODO
    if (!isHaveSuccess && packedTxs.length > 0) {
      this.logger(
        `################isHaveSuccess===false chainID: ${this.getChainId()} ###############`
      );
      const ids = packedTxs.map((ptx) => ptx.id).join(",");
      const requestIds = packedTxs.map((ptx) => ptx.requestIds).join(",");

      this.logger(`packedTxs-ids: ${ids}`);
      this.logger(`packedTxs-requestIds: ${requestIds}`);
    }
  }
}

function notNil(arg): boolean {
  if (arg === null || arg === undefined) {
    return false;
  }
  return true;
}
