import { TransactionRequest } from "@ethersproject/abstract-provider";
import { ExternallyOwnedAccount } from "@ethersproject/abstract-signer";
import { BytesLike } from "@ethersproject/bytes";
import { SigningKey } from "@ethersproject/signing-key";
import { BigNumberish, Wallet, providers } from "ethers";
export interface Request {
    id?: number;
    functionData: string;
    txId?: string;
    chainId: number;
    logId?: number;
    createdAt?: number;
}
export interface PackedTransaction {
    id?: number;
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
export declare abstract class IOrderedRequestStore {
    abstract setRequests(requests: Request[]): Promise<number[]>;
    abstract getRequests(chainId: number, minimalId: number, limit: number): Promise<Request[]>;
    abstract updateRequestBatch(ids: number[], txid: string): any;
    abstract setPackedTransaction(tx: PackedTransaction): any;
    abstract getLatestPackedTransaction(chainId: number, nonce?: number): Promise<PackedTransaction | null>;
    abstract getPackedTransaction(nonce: number, chainId: number): Promise<PackedTransaction[]>;
    abstract getMaxIDPackedTransaction(chainId: number, maxId: number): Promise<PackedTransaction | null>;
    abstract setPackedTransactionConfirmation(id: number, confirmation: number): any;
}
export interface ParallelSignerOptions {
    readonly requestCountLimit: number;
    readonly delayedSecond: number;
    readonly checkPackedTransactionIntervalSecond: number;
    readonly confirmations: number;
}
export declare class ParallelSigner extends Wallet {
    readonly requestStore: IOrderedRequestStore;
    private populateFun;
    readonly chainId: number;
    options: ParallelSignerOptions;
    constructor(privateKey: BytesLike | ExternallyOwnedAccount | SigningKey, provider: providers.JsonRpcProvider, requestStore: IOrderedRequestStore, populateFun: (requests: Request[]) => Promise<{
        to: string;
        data: string;
        value?: BigNumberish;
        gasLimit: BigNumberish;
        maxFeePerGas?: string;
        maxPriorityFeePerGas?: string;
        gasPrice?: string;
    }>, options?: Partial<ParallelSignerOptions>);
    mockProvider: {};
    sendRawTransaction(transaction: TransactionRequest, rawTx: string, packedTx: PackedTransaction): Promise<providers.TransactionResponse>;
    mockProviderMethod(methodName: string, defaultMethod: Function, ...args: any[]): Promise<any>;
    getTransactionCount(tag: string): Promise<number>;
    getTransactionReceipt(tx: string): Promise<providers.TransactionReceipt>;
    private logger;
    setLogger(_logger: (...data: any[]) => any): Promise<void>;
    init(): Promise<void>;
    private timeHandler;
    clearTimeHandler(): Promise<void>;
    __rePack(): Promise<void>;
    __checkPackedTx(): Promise<void>;
    __setTimeout(chainId: number, timeout: number): Promise<void>;
    sendTransactions(txs: {
        functionData: string;
        logId: number;
    }[]): Promise<number[]>;
    private repacking;
    private rePackedTransaction;
    private getRepackRequests;
    /**
     * Sends a packed transaction to the blockchain.
     *
     * @param requests An array of requests to be included in the packed transaction.
     * @param nonce The nonce of the packed transaction.
     */
    private sendPackedTransaction;
    private buildTransactionRequest;
    private checkConfirmations;
    /**
     * Scheduled task with two purposes
     * 1. Check the on-chain status of PackedTransaction
     * 2. Update confirmation, if confirmation is sufficient, set txid to the request table
     *
     * The interval time should be set to around 15 seconds, too frequent has little significance
     **/
    private checkPackedTransaction;
}
