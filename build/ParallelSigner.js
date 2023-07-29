"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ParallelSigner = exports.IOrderedRequestStore = void 0;
const abstract_provider_1 = require("@ethersproject/abstract-provider");
const keccak256_1 = require("@ethersproject/keccak256");
const properties_1 = require("@ethersproject/properties");
const ethers_1 = require("ethers");
const timer_1 = require("./timer");
class IOrderedRequestStore {
}
exports.IOrderedRequestStore = IOrderedRequestStore;
//requestCountLimit: maximum number of requests in a PackedTx
//delayedSecond: maximum delay for a request to be packed, to wait for more transactions to be included in a PackedTx and avoid frequent rePacking that may result in high gas price.
// If delayedSecond = 0, make sure not to call sendTransactions frequently, otherwise frequent rePacking will occur.
class ParallelSigner extends ethers_1.Wallet {
    constructor(privateKey, provider, requestStore, populateFun, options = {}) {
        var _a, _b, _c, _d, _e;
        super(privateKey, provider);
        this.requestStore = requestStore;
        this.populateFun = populateFun;
        this.mockProvider = {}; //TODO only for test,
        //TODO should refactor. At least support two types of log output: info and debug
        this.logger = console.log;
        this.timeHandler = [];
        // Each repacked transaction should be an independent process, discovering the current state on the chain, checking the progress in the database, and finding the correct starting position for the request
        this.repacking = false;
        this.options = Object.assign({ requestCountLimit: 10, delayedSecond: 0, checkPackedTransactionIntervalSecond: 15, confirmations: 64 }, options);
        if (provider && !abstract_provider_1.Provider.isProvider(provider)) {
            throw Error("invalid provider");
        }
        if (requestStore === undefined) {
            throw Error("request store is undefined");
        }
        (0, properties_1.defineReadOnly)(this, "chainId", (_c = (_b = (_a = this.provider) === null || _a === void 0 ? void 0 : _a._network) === null || _b === void 0 ? void 0 : _b.chainId) !== null && _c !== void 0 ? _c : (_e = (_d = this.provider) === null || _d === void 0 ? void 0 : _d.network) === null || _e === void 0 ? void 0 : _e.chainId);
    }
    //TODO only for test
    sendRawTransaction(transaction, rawTx, packedTx) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.mockProvider["sendTransaction"]) {
                const mockRes = this.mockProvider["sendTransaction"](transaction, rawTx, packedTx);
                if (mockRes !== true) {
                    return mockRes;
                }
            }
            return this.provider.sendTransaction(rawTx);
        });
    }
    //TODO only for test
    mockProviderMethod(methodName, defaultMethod, ...args) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.mockProvider[methodName]) {
                const mockRes = this.mockProvider[methodName](...args);
                if (mockRes !== true) {
                    return mockRes;
                }
            }
            return yield defaultMethod.call(this, ...args); //TODO why?
        });
    }
    getTransactionCount(tag) {
        const _super = Object.create(null, {
            getTransactionCount: { get: () => super.getTransactionCount }
        });
        return __awaiter(this, void 0, void 0, function* () {
            return this.mockProviderMethod("getTransactionCount", _super.getTransactionCount, tag);
        });
    }
    getTransactionReceipt(tx) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.mockProvider["getTransactionReceipt"]) {
                return this.mockProvider["getTransactionReceipt"](tx);
            }
            return this.provider.getTransactionReceipt(tx);
        });
    }
    setLogger(_logger) {
        return __awaiter(this, void 0, void 0, function* () {
            this.logger = _logger;
        });
    }
    init() {
        return __awaiter(this, void 0, void 0, function* () {
            this.timeHandler[0] = setInterval(() => __awaiter(this, void 0, void 0, function* () {
                yield this.checkPackedTransaction();
            }), this.options.checkPackedTransactionIntervalSecond * 1000);
            const intervalTime = this.options.delayedSecond === 0
                ? (0, timer_1.getTimeout)(this.chainId) / 2000 // If there is no delay configuration, the default check time is half of the expiration time
                : this.options.delayedSecond;
            this.timeHandler[1] = setInterval(() => __awaiter(this, void 0, void 0, function* () {
                yield this.rePackedTransaction();
            }), intervalTime * 1000);
        });
    }
    clearTimeHandler() {
        return __awaiter(this, void 0, void 0, function* () {
            this.timeHandler.forEach((v) => {
                clearInterval(v);
            });
        });
    }
    __rePack() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.rePackedTransaction();
        });
    }
    __checkPackedTx() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.checkPackedTransaction();
        });
    }
    __setTimeout(chainId, timeout) {
        return __awaiter(this, void 0, void 0, function* () {
            (0, timer_1.__setTimeoutConfig)(chainId, timeout);
        });
    }
    sendTransactions(txs) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!txs || txs.length == 0) {
                return;
            }
            const requests = txs.map((v) => {
                return {
                    functionData: v.functionData,
                    chainId: this.chainId,
                    logId: v.logId,
                };
            });
            // Only ensure successful write to the database
            const res = yield this.requestStore.setRequests(requests);
            // When there is no delay, only process transactions within the limit of the requestCountLimit for this batch. Others will be stored in the database and processed by the scheduled task.
            // The requests may exceed the limit, but the rePackedTransaction method will handle the limit
            if (this.options.delayedSecond == 0) {
                yield this.rePackedTransaction();
            }
            return res;
        });
    }
    rePackedTransaction() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.repacking)
                return null;
            this.repacking = true;
            const currentNonce = yield this.getTransactionCount("latest");
            const requests = yield this.getRepackRequests();
            yield this.sendPackedTransaction(requests, currentNonce);
            this.repacking = false;
            return true;
        });
    }
    getRepackRequests() {
        var _a, _b, _c;
        return __awaiter(this, void 0, void 0, function* () {
            let latestPackedTx = yield this.requestStore.getLatestPackedTransaction(this.chainId);
            const currentNonce = yield this.getTransactionCount("latest");
            let minimalId = 0; // Start searching for requests from this id
            // If latestPackedTx exists, find minimalId to search for requests
            if (latestPackedTx !== null) {
                if (currentNonce == latestPackedTx.nonce) {
                    // If there are no new requests, wait. If there are new requests, repack.
                    // If the current nonce has not been successfully confirmed on the chain, repacking should not continue. It should wait for the checkPackedTransaction timer to execute.
                    let maxid = Math.max(...latestPackedTx.requestIds);
                    let rqx = yield this.requestStore.getRequests(this.chainId, maxid + 1, this.options.requestCountLimit);
                    if (latestPackedTx.requestIds.length < this.options.requestCountLimit &&
                        rqx.length > 0) {
                        this.logger("NEW DATA REPACK");
                        // If the limit is not reached and new data comes in, and this function has been called externally, it means that the repack action can be performed
                        minimalId = Math.min(...latestPackedTx.requestIds) - 1;
                    }
                    else {
                        // If there is no new data or the limit has been reached, check if it has timed out
                        let gapTime = new Date().getTime() - ((_a = latestPackedTx.createdAt) !== null && _a !== void 0 ? _a : 0);
                        this.logger(`gapTime: ${gapTime}  timeout: ${(0, timer_1.getTimeout)(this.chainId)} createdAt: ${latestPackedTx.createdAt}`);
                        if (gapTime > (0, timer_1.getTimeout)(this.chainId)) {
                            // Timeout
                            this.logger("TIMEOUT REPACK");
                            minimalId = Math.min(...latestPackedTx.requestIds) - 1;
                        }
                        else {
                            // Neither new data nor timeout
                            return [];
                        }
                    }
                }
                else {
                    /**
                     * Next, execute the logic to search for the deadline, find the deadline, and then repack
                     * 1. Find packedTx with nonce less than currentNonce
                     * 2. The txid of packedTx is successfully confirmed on the chain
                     * 3. Find the ids
                     * 4. Find the requests
                     * END
                     */
                    // Only currentNonce - latestPackedTx.nonce = 1 is a normal situation
                    let lastCheckedId = latestPackedTx.id
                        ? latestPackedTx.id + 1
                        : 0;
                    while (true) {
                        let packedTx = yield this.requestStore.getMaxIDPackedTransaction(this.chainId, lastCheckedId);
                        if (packedTx == null) {
                            // Reached the lowest point
                            break;
                        }
                        // All are exceptional cases
                        if (packedTx.nonce >= currentNonce) {
                            lastCheckedId = (_b = packedTx.id) !== null && _b !== void 0 ? _b : 0;
                            continue;
                        }
                        let latestCheckedPackedTxs = yield this.requestStore.getPackedTransaction(packedTx.nonce, this.chainId);
                        for (let k in latestCheckedPackedTxs) {
                            packedTx = latestCheckedPackedTxs[k];
                            lastCheckedId = Math.min((_c = packedTx.id) !== null && _c !== void 0 ? _c : 0, lastCheckedId);
                            let recpt = yield this.getTransactionReceipt(packedTx.transactionHash);
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
            let storedRequest = yield this.requestStore.getRequests(this.chainId, minimalId + 1, this.options.requestCountLimit);
            return storedRequest;
        });
    }
    /**
     * Sends a packed transaction to the blockchain.
     *
     * @param requests An array of requests to be included in the packed transaction.
     * @param nonce The nonce of the packed transaction.
     */
    sendPackedTransaction(requests, nonce) {
        return __awaiter(this, void 0, void 0, function* () {
            if (requests.length == 0) {
                return;
            }
            let txParam = yield this.populateFun(requests);
            let { maxPriorityFeePerGas, maxFeePerGas, gasPrice } = txParam;
            let rtx = yield this.buildTransactionRequest(txParam, nonce);
            // Populate and sign the transaction
            rtx = yield this.populateTransaction(rtx);
            const signedTx = yield this.signTransaction(rtx);
            let txid = (0, keccak256_1.keccak256)(signedTx);
            let requestsIds = requests.map((v) => {
                if (v.id === 0 || v.id === undefined) {
                    throw new Error("request id has not been assigned");
                }
                return v.id;
            });
            // Create a new packed transaction
            let packedTx = {
                gasPrice: (gasPrice !== null && gasPrice !== void 0 ? gasPrice : "").toString(),
                maxFeePerGas: maxFeePerGas !== null && maxFeePerGas !== void 0 ? maxFeePerGas : "",
                maxPriorityFeePerGas: maxPriorityFeePerGas !== null && maxPriorityFeePerGas !== void 0 ? maxPriorityFeePerGas : "",
                nonce: nonce,
                confirmation: 0,
                transactionHash: txid,
                chainId: this.chainId,
                requestIds: requestsIds,
            };
            yield this.requestStore.setPackedTransaction(packedTx);
            this.logger("PackedTransaction: " +
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
                maxPriorityFeePerGas);
            this.sendRawTransaction(rtx, signedTx, packedTx);
        });
    }
    buildTransactionRequest(txParam, nonce) {
        return __awaiter(this, void 0, void 0, function* () {
            let { to, data, gasLimit, maxPriorityFeePerGas, maxFeePerGas, gasPrice, value, } = txParam;
            // Create a new transaction request
            let rtx = {
                to: to,
                data: data,
                gasLimit: gasLimit,
                nonce: nonce,
                value: value,
                chainId: this.chainId,
            };
            // Get the latest packed transaction for the given nonce and chainId
            let latestPackedTx = yield this.requestStore.getLatestPackedTransaction(this.chainId, nonce);
            if (latestPackedTx === null) {
                //first tx
                if (maxFeePerGas != null && maxPriorityFeePerGas != null) {
                    rtx.maxFeePerGas = maxFeePerGas;
                    rtx.maxPriorityFeePerGas = maxPriorityFeePerGas;
                }
                else if (gasPrice != null) {
                    rtx.gasPrice = gasPrice;
                }
                else {
                    throw new Error("gas price error");
                }
                return rtx;
            }
            // Set gas price based on the latest packed transaction
            if (maxFeePerGas != null && maxPriorityFeePerGas != null) {
                const nextMaxFeePerGas = ethers_1.BigNumber.from(latestPackedTx.maxFeePerGas)
                    .mul(110)
                    .div(100);
                const finalMaxFeePerGas = nextMaxFeePerGas.gt(maxFeePerGas)
                    ? nextMaxFeePerGas
                    : maxFeePerGas;
                rtx.maxFeePerGas = finalMaxFeePerGas;
                const nextMaxPriorityFeePerGas = ethers_1.BigNumber.from(latestPackedTx.maxPriorityFeePerGas)
                    .mul(110)
                    .div(100);
                const finalMaxPriorityFeePerGas = nextMaxPriorityFeePerGas.gt(maxPriorityFeePerGas)
                    ? nextMaxPriorityFeePerGas
                    : maxPriorityFeePerGas;
                rtx.maxPriorityFeePerGas = finalMaxPriorityFeePerGas;
            }
            else if (gasPrice != null) {
                const nextGasPrice = ethers_1.BigNumber.from(latestPackedTx.gasPrice)
                    .mul(110)
                    .div(100);
                const finalGasPrice = nextGasPrice.gt(gasPrice) ? nextGasPrice : gasPrice;
                rtx.gasPrice = finalGasPrice;
            }
            else {
                throw new Error("gas price error");
            }
            return rtx;
        });
    }
    checkConfirmations(nonce) {
        var _a;
        return __awaiter(this, void 0, void 0, function* () {
            let packedTxs = yield this.requestStore.getPackedTransaction(nonce, this.chainId);
            if (packedTxs.length == 0) {
                // This should not happen normally
                return 0;
            }
            let result = Math.min(...packedTxs.map((v) => { var _a; return (_a = v.id) !== null && _a !== void 0 ? _a : 0; })); // Find the minimum id
            for (let k in packedTxs) {
                let v = packedTxs[k];
                if (v.confirmation < this.options.confirmations) {
                    let txRcpt = yield this.getTransactionReceipt(v.transactionHash);
                    if (txRcpt != null) {
                        if (txRcpt.confirmations >= this.options.confirmations) {
                            // Set request txid by v.txhash
                            yield this.requestStore.updateRequestBatch(v.requestIds, v.transactionHash);
                            // If data satisfying the confirmation requirement is found, return 0 to stop further searching
                            result = 0;
                        }
                        // Update confirmation to db
                        yield this.requestStore.setPackedTransactionConfirmation((_a = v.id) !== null && _a !== void 0 ? _a : 0, txRcpt.confirmations);
                        // There can be at most one packedTx with data on the chain
                        break;
                    }
                }
                else {
                    result = 0; // Already found data satisfying the confirmation requirement, immediately exit the loop
                    break;
                }
            }
            return result;
        });
    }
    /**
     * Scheduled task with two purposes
     * 1. Check the on-chain status of PackedTransaction
     * 2. Update confirmation, if confirmation is sufficient, set txid to the request table
     *
     * The interval time should be set to around 15 seconds, too frequent has little significance
     **/
    checkPackedTransaction() {
        var _a;
        return __awaiter(this, void 0, void 0, function* () {
            this.logger(`Interval checkPackedTransaction`);
            let currentNonce = yield this.getTransactionCount("latest");
            if (currentNonce == 0) {
                return;
            }
            let lastestTx = yield this.requestStore.getLatestPackedTransaction(this.chainId, currentNonce - 1);
            if (lastestTx == null) {
                // This will cause an exit. If the data of currentNonce - 1 cannot be found, it will cause an exit
                lastestTx = yield this.requestStore.getLatestPackedTransaction(this.chainId);
                if (lastestTx == null) {
                    return;
                }
            }
            let lastCheckedId = (_a = lastestTx.id) !== null && _a !== void 0 ? _a : 0;
            lastCheckedId += 1; // Ensure that this batch is within the check of the while loop
            while (lastCheckedId > 0) {
                // Find the next one
                let nextTx = yield this.requestStore.getMaxIDPackedTransaction(this.chainId, lastCheckedId);
                if (nextTx == null) {
                    // Reached the lowest point
                    break;
                }
                if (nextTx.nonce >= currentNonce) {
                    lastCheckedId = nextTx.id;
                    continue;
                }
                // Use return 0 to interrupt the while loop
                lastCheckedId = yield this.checkConfirmations(nextTx.nonce);
            }
        });
    }
}
exports.ParallelSigner = ParallelSigner;
