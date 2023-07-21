import {
  IOrderedRequestStore,
  PackedTransaction,
  Request,
} from "../src/ParallelSigner";
import { dbConnect } from "./db";

export class OrderedRequestStore implements IOrderedRequestStore {
  async setRequests(requests: Request[]) {
    const db = await dbConnect();

    const result: number[] = [];
    for (let v of requests) {
      const r = (await db.run(
        `
          INSERT INTO requests
            (function_data, tx_id, chain_id, log_id)
          VALUES
            ('${v.functionData}', '', ${v.chainId}, ${v.logId});
        `
      )) as any;
      result.push(r.lastID);
    }

    return result;
  }
  // Get requests where id >= minimalId order by asc??
  async getRequests(
    chainId: number,
    minimalId: number,
    limit: number
  ): Promise<Request[]> {
    const db = await dbConnect();
    const r = (await db.all(`
        select * from requests
        where chain_id = ${chainId}  and  id >=  ${minimalId} limit ${limit}
      `)) as Array<any>;
    return r.map((v) => {
      return buildRequest(v);
    });
  }

  async updateRequestBatch(ids: number[], txid: string) {
    const db = await dbConnect();

    const sql = `
    UPDATE requests
      SET tx_id = '${txid}' WHERE id in (${ids.join(",")})
  `;
    await db.run(sql);
  }

  // Insert packed transaction into the database
  async setPackedTransaction(tx: PackedTransaction) {
    const db = await dbConnect();

    const r = (await db.run(
      `
          INSERT INTO packed_transactions
            (nonce, tx_id, chain_id, gas_price, request_ids, confirmation)
          VALUES
            (${tx.nonce}, '${tx.transactionHash}' , ${tx.chainId}, '${tx.gasPrice}', '${tx.requestIds}', ${tx.confirmation});
        `
    )) as any;
    return r.lastID;
  }

  // Get the latest packed transaction inserted into the database, max(id)
  async getLatestPackedTransaction(
    chainId: number,
    nonce?: number
  ): Promise<PackedTransaction | null> {
    const db = await dbConnect();
    const sql = [
      `SELECT *,strftime('%s000', created_at) AS created_time FROM packed_transactions WHERE`,
    ];
    if (!chainId) {
      throw new Error("Missing chainId in getLatestPackedTransaction");
    }
    sql.push(`chain_id=${chainId}`);
    if (nonce !== undefined) {
      sql.push(`AND nonce=${nonce}`);
    }
    sql.push(`ORDER BY id DESC LIMIT 1;`);
    const latestPackedTx = await db.get(sql.join(" "));
    if (latestPackedTx === undefined) {
      return null;
    }
    return buildPackedTransaction(latestPackedTx);
  }

  // Get all packed transactions matching the given nonce and chainId
  async getPackedTransaction(
    nonce: number,
    chainId: number
  ): Promise<PackedTransaction[]> {
    const db = await dbConnect();
    const r = (await db.all(`
        select *,strftime('%s000', created_at) AS created_time from packed_transactions
        where chain_id = ${chainId}  and  nonce =  ${nonce}
      `)) as Array<any>;
    return r.map((v) => {
      return buildPackedTransaction(v);
    });
  }
  // Return the most recent data that is less than maxId
  async getMaxIDPackedTransaction(
    chainId: number,
    maxId: number
  ): Promise<PackedTransaction | null> {
    const db = await dbConnect();
    const r = await db.get(
      `SELECT *,strftime('%s000', created_at) AS created_time FROM packed_transactions WHERE id < ${maxId} AND chain_id=${chainId} ORDER BY ID DESC LIMIT 1`
    );
    if (r === undefined) {
      return null;
    }
    return buildPackedTransaction(r);
  }

  async setPackedTransactionConfirmation(id: number, confirmation: number) {
    const db = await dbConnect();

    const sql = `
    UPDATE packed_transactions
      SET confirmation = '${confirmation}' WHERE id = ${id}
  `;
    await db.run(sql);
  }

  //only for test
  async getAllPackedTransaction(chainId: number): Promise<PackedTransaction[]> {
    const db = await dbConnect();
    const r = (await db.all(`
        select *,strftime('%s000', created_at) AS created_time from packed_transactions
        where chain_id = ${chainId}
      `)) as Array<any>;
    return r.map((v) => {
      return buildPackedTransaction(v);
    });
  }
}

function buildRequest(obj: {
  id: number;
  function_data: string;
  tx_id: string;
  chain_id: number;
  log_id: number;
  created_at: string;
}): Request {
  return {
    id: obj.id,
    functionData: obj.function_data,
    txId: obj.tx_id,
    chainId: obj.chain_id,
    logId: obj.log_id,
    createdAt: new Date(obj.created_at).getTime(),
  } as Request;
}

function buildPackedTransaction(obj: {
  id: number;
  nonce: number;
  tx_id: string;
  chain_id: number;
  max_fee_per_gas: string;
  max_priority_fee_per_gas: string;
  gas_price: string;
  request_ids: string;
  confirmation: number;
  created_at: string;
  created_time: number;
}): PackedTransaction {
  return {
    id: obj.id,
    nonce: obj.nonce,
    transactionHash: obj.tx_id,
    chainId: obj.chain_id,
    maxFeePerGas: obj.max_fee_per_gas,
    maxPriorityFeePerGas: obj.max_priority_fee_per_gas,
    gasPrice: obj.gas_price,
    requestIds: obj.request_ids.split(",").map(Number),
    confirmation: obj.confirmation,
    createdAt: obj.created_time,
  } as PackedTransaction;
}
