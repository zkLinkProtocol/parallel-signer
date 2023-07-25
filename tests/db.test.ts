import { PackedTransaction, Request } from "../src/ParallelSigner";
import { OrderedRequestStore } from "./OrderedRequestStore";
import { buildFunctionData1 } from "./polulate";

import { dbConnect, initialDatabaseTables } from "./db";
import { parseUnits } from "ethers/lib/utils";
const requestStore = new OrderedRequestStore();

const chainId = 80001;

beforeEach(async () => {
  await initialDatabaseTables();
});
afterEach(async () => {
  const db = await dbConnect();
  db.exec("DELETE FROM requests;");
  db.exec("DELETE FROM packed_transactions;");
});

describe("OrderedRequestStore", () => {
  it("set and get request should be success", async () => {
    const reqs = mockRequests();
    reqs.push(...mockRequests());
    reqs.push(...mockRequests());
    reqs.push(...mockRequests());
    reqs.push(...mockRequests());
    reqs.push(...mockRequests());
    reqs.push(...mockRequests());
    let setResult = await requestStore.setRequests(reqs);
    expect(setResult.length).toBe(reqs.length);
    const limit = 10;

    let res = await requestStore.getRequests(chainId, 0, limit);
    expect(res.length).toBe(limit);

    res.forEach((v, k) => {
      expect(reqs[k].logId).toBe(v.logId);
      expect(reqs[k].chainId).toBe(v.chainId);
      expect(reqs[k].functionData).toBe(v.functionData);
    });
  });
  it("set and updateRequestBatch should be success", async () => {
    const reqs = mockRequests();
    let setResult = await requestStore.setRequests(reqs);
    expect(setResult.length).toBe(reqs.length);
    const txid = "0x12345";
    await requestStore.updateRequestBatch(setResult, txid);
    let res = await requestStore.getRequests(chainId, 0, 10);
    res.forEach((v) => {
      expect(v.txId).toBe(txid);
    });
  });
  it("setPackedTransaction and getLatestPackedTransaction should be success", async () => {
    let setResult = await requestStore.setPackedTransaction(
      mockPackedTransaction(1)
    );
    let setResult2 = await requestStore.setPackedTransaction(
      mockPackedTransaction(2)
    );
    const ltx = await requestStore.getLatestPackedTransaction(chainId);
    expect(ltx?.id).toBe(Math.max(setResult, setResult2));
    const ltx2 = await requestStore.getLatestPackedTransaction(chainId, 1);
    expect(ltx2?.id).toBe(setResult);
  });
  it("getPackedTransaction should be success", async () => {
    let setResult = await requestStore.setPackedTransaction(
      mockPackedTransaction(1)
    );
    let setResult2 = await requestStore.setPackedTransaction(
      mockPackedTransaction(1)
    );
    let setResult3 = await requestStore.setPackedTransaction(
      mockPackedTransaction(2)
    );

    const ptxs = await requestStore.getPackedTransaction(1, chainId);
    expect(ptxs.length).toBe(2);
    const ptxs2 = await requestStore.getPackedTransaction(2, chainId);
    expect(ptxs2.length).toBe(1);

    const mpt = await requestStore.getMaxIDPackedTransaction(
      chainId,
      setResult3
    );
    expect(setResult2).toBe(mpt?.id);
    const mpt2 = await requestStore.getMaxIDPackedTransaction(
      chainId,
      await requestStore.setPackedTransaction(mockPackedTransaction(2))
    );
    expect(setResult3).toBe(mpt2?.id);
  });

  it("setPackedTransactionConfirmation should be success", async () => {
    const curNonce = 2;
    const randomconfirmation = 1244;
    const lstid = await requestStore.setPackedTransaction(
      mockPackedTransaction(curNonce)
    );
    await requestStore.setPackedTransactionConfirmation(
      lstid,
      randomconfirmation
    );

    const ptxs2 = await requestStore.getPackedTransaction(curNonce, chainId);
    let cur = 0;
    for (let ptx of ptxs2) {
      if (ptx.id == lstid) {
        cur++;
        expect(ptx.confirmation).toBe(randomconfirmation);
      }
    }
    expect(cur).toBe(1);
  });
});

function mockRequests(): Request[] {
  let reqs: Request[] = [];
  reqs.push({
    functionData: buildFunctionData1("0.01"),
    logId: 100,
    chainId: chainId,
  });
  reqs.push({
    functionData: buildFunctionData1("0.02"),
    logId: 101,
    chainId: chainId,
  });
  return reqs;
}
function mockPackedTransaction(nonce: number = 1): PackedTransaction {
  return {
    nonce: nonce,
    transactionHash: "",
    chainId: chainId,
    maxFeePerGas: "",
    maxPriorityFeePerGas: "",
    gasPrice: parseUnits("10", "ether").toString(),
    requestIds: [1, 2, 3],
    confirmation: 0,
  } as PackedTransaction;
}
