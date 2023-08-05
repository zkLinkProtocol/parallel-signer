import { JsonRpcProvider } from "ethers";
import hre from "hardhat";
import * as _ from "lodash";
import { PackedTransaction, ParallelSigner } from "../src/ParallelSigner";
import { OrderedRequestStore } from "./OrderedRequestStore";
import { dbConnect, initialDatabaseTables } from "./db";
import { buildFunctionData1, populateFun1 } from "./polulate";

async function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms * 1000);
  });
}
const requestStore = new OrderedRequestStore();
const chainId = hre.config.networks[hre.config.defaultNetwork].chainId ?? 0;
beforeEach(async () => {
  await initialDatabaseTables();
  const db = await dbConnect();
  db.exec("DELETE FROM requests;");
  db.exec("DELETE FROM packed_transactions;");
});
afterEach(async () => {
  const db = await dbConnect();
  db.exec("DELETE FROM requests;");
  db.exec("DELETE FROM packed_transactions;");
});

describe("OrderedRequestStore", () => {
  it("Test if transactions can be sent immediately without delay", async () => {
    const limit = 3;
    const delaytime = 0;
    const signer = initParallelSigner(populateFun1, delaytime, limit);
    signer.setLogger((msg) => {
      console.log(`TEST1: ${msg}`);
    });
    const rqs = [{ functionData: buildFunctionData1("0.01"), logId: 100 }];
    signer.mockProvider["sendTransaction"] = function (
      tx,
      rawTx,
      packedTx: PackedTransaction
    ) {
      expect(packedTx.requestIds.length).toBe(Math.min(rqs.length, limit));
    };
    signer.mockProvider["getTransactionCount"] = function (tag) {
      return 100;
    };
    await signer.sendTransactions(rqs);

    const aptx = await requestStore.getAllPackedTransaction(chainId);
    expect(aptx.length).toBe(1);
  });
  it("Test the case where sendTransactions exceeds the limit, and repack success", async () => {
    const limit = 3;
    const delaytime = 0;
    const signer = initParallelSigner(populateFun1, delaytime, limit);
    signer.setLogger((msg) => {
      console.log(`TEST1: ${msg}`);
    });
    const rqs = [
      { functionData: buildFunctionData1("0.01"), logId: 100 },
      { functionData: buildFunctionData1("0.01"), logId: 101 },
      { functionData: buildFunctionData1("0.01"), logId: 102 },
      { functionData: buildFunctionData1("0.01"), logId: 103 },
    ];
    expect(limit).toBeLessThan(rqs.length);
    signer.mockProvider["sendTransaction"] = function (
      tx,
      rawTx,
      packedTx: PackedTransaction
    ) {
      expect(packedTx.requestIds.length).toBe(Math.min(rqs.length, limit));
    };
    signer.mockProvider["getTransactionCount"] = function (tag) {
      return 100;
    };
    await signer.sendTransactions(rqs);

    const aptx = await requestStore.getAllPackedTransaction(chainId);
    expect(aptx.length).toBe(1);
  });
  it("Test the basic repack process, including expired repack and new data repack", async () => {
    const limit = 3;
    const delaytime = 5;
    const signer = initParallelSigner(populateFun1, delaytime, limit);
    signer.setLogger((msg) => {
      console.log(`TEST2: ${msg}`);
    });
    const rqs = [{ functionData: buildFunctionData1("0.01"), logId: 100 }];
    signer.mockProvider["sendTransaction"] = function (
      tx,
      rawTx,
      packedTx: PackedTransaction
    ) {
      expect(packedTx.requestIds.length).toBe(Math.min(rqs.length, limit));
    };
    signer.mockProvider["getTransactionCount"] = function (tag) {
      return 100;
    };
    // Insert data once
    const requestId1 = await signer.sendTransactions(rqs);

    let aptx = await requestStore.getAllPackedTransaction(chainId);
    // Never repacked before, so there is no data
    expect(aptx.length).toBe(0);
    await signer.__rePack(); // Should have an effect
    await signer.__rePack();
    aptx = await requestStore.getAllPackedTransaction(chainId);
    // Only the first repack should take effect, the second one does not meet the timeout requirement
    expect(aptx.length).toBe(1);

    signer.__setTimeout(chainId, 1);
    await sleep(2);
    await signer.__rePack(); // Should have an effect
    aptx = await requestStore.getAllPackedTransaction(chainId);
    // After setting a timeout of 1000ms, repack will insert data into the database
    expect(aptx.length).toBe(2);
    // The nonce of the two data should be the same
    expect(aptx[0].nonce === aptx[1].nonce).toBeTruthy();
    expect(_.isEqual(aptx[0].requestIds, aptx[1].requestIds)).toBeTruthy();
    // Although repacked, there is still only one actual data
    expect(aptx[1].requestIds.length).toBe(1);

    // Reset the mock because we need to add new data
    signer.mockProvider["sendTransaction"] = function (
      tx,
      rawTx,
      packedTx: PackedTransaction
    ) {
      expect(packedTx.requestIds.length).toBe(Math.min(2, limit));
    };

    // Add new data
    const requestId2 = await signer.sendTransactions(rqs);
    // Increase the expiration time
    signer.__setTimeout(chainId, 100);
    // Although it is not expired, repack should have an effect because new data is added
    await signer.__rePack();
    aptx = await requestStore.getAllPackedTransaction(chainId);
    expect(aptx.length).toBe(3);
    // Because new data is added, the actual number of repacked data is 2
    expect(aptx[aptx.length - 1].requestIds.length).toBe(2);
    // Also check if the packed requests meet the requirements
    expect(
      _.isEqual(aptx[aptx.length - 1].requestIds, [
        ...requestId1,
        ...requestId2,
      ])
    ).toBeTruthy();
  });
  // Test the scenario where the request data remains unchanged and the nonce increases:
  // the latest txid can be found and cannot be found on the chain
  it("Test the scenario where the request data remains unchanged and the nonce increases", async () => {
    const limit = 3;
    const delaytime = 5;
    const signer = initParallelSigner(populateFun1, delaytime, limit);
    signer.setLogger((msg) => {
      console.log(`TEST3: ${msg}`);
    });
    const rqs = [{ functionData: buildFunctionData1("0.01"), logId: 100 }];
    signer.mockProvider["sendTransaction"] = function (
      tx,
      rawTx,
      packedTx: PackedTransaction
    ) {};
    signer.mockProvider["getTransactionCount"] = function (tag) {
      return 100;
    };
    // Insert data once
    const requestId1 = await signer.sendTransactions(rqs);

    // Perform one repack
    await signer.__rePack();
    let aptx = await requestStore.getAllPackedTransaction(chainId);
    // Only the first repack should take effect, the second one does not meet the timeout requirement
    expect(aptx.length).toBe(1);
    // Increase the nonce to simulate external exceptions that cause the nonce to increase
    signer.mockProvider["getTransactionCount"] = function (tag) {
      return 102;
    };
    let checksignal = 0;
    signer.mockProvider["getTransactionReceipt"] = function (txid) {
      // During the second repack, check if the earlier txid is on the chain
      expect(aptx[0].transactionHash).toBe(txid);
      // Return null to indicate that it is not found on the chain
      checksignal += 1;
      return null;
    };
    // Since no new data comes in, the timer task will continue to trigger repack
    // Normally, it will query whether the tx exists on the chain
    await signer.__rePack();
    expect(checksignal).toBe(1);
    // The current simulation is that the nonce increases, but all txids that are not found in the database are on the chain
    // Therefore, next, we should re-retrieve the request from the position where minimalid = 1. At this time, we should be able to observe the log with nonce = 102
    aptx = await requestStore.getAllPackedTransaction(chainId);
    // Only the first repack should take effect, the second one does not meet the timeout requirement
    expect(aptx.length).toBe(2);
    expect(_.isEqual(aptx[0].requestIds, aptx[1].requestIds)).toBeTruthy();

    signer.mockProvider["getTransactionReceipt"] = function (txid) {
      if (txid === aptx[1].transactionHash) {
        checksignal += 1;
        return {
          async confirmations() {
            return 0;
          },
        }; //not null
      }
    };
    // Must increase the nonce, otherwise the logic of executing getTransactionReceipt will not be entered
    signer.mockProvider["getTransactionCount"] = function (tag) {
      return 103;
    };
    // Reset the mock getTransactionReceipt. When the timer task is executed again
    // The minimalId can be found, but there is no new data in the request table, that is, there is no actual sendTx next.
    await signer.__rePack();
    expect(checksignal).toBe(2);

    aptx = await requestStore.getAllPackedTransaction(chainId);
    // There will be no new packed, because all the old requests have been sent to the chain
    expect(aptx.length).toBe(2);

    // Insert data again, simulate nonce increase, but found the request that should be processed from the database
    const requestId2 = await signer.sendTransactions(rqs);

    signer.mockProvider["getTransactionReceipt"] = function (txid) {
      if (txid === aptx[1].transactionHash) {
        checksignal += 1;
        return {
          async confirmations() {
            return 0;
          },
        }; //not null
      }
    };
    expect(aptx[1].nonce).toBe(102);
    // Must increase the nonce, otherwise the logic of executing getTransactionReceipt will not be entered
    signer.mockProvider["getTransactionCount"] = function (tag) {
      return 105; // The previous data is actually still 102,
    };

    await signer.__rePack();
    expect(checksignal).toBe(3);
    const lpx1 = await signer.requestStore.getLatestPackedTransaction(chainId);
    const lpx2 = await signer.requestStore.getLatestPackedTransaction(
      chainId,
      105
    );
    expect(lpx1?.id === lpx2?.id).toBeTruthy();
    expect(lpx1?.requestIds.length).toBe(1);
    expect(_.isEqual(lpx1?.requestIds, requestId2)).toBeTruthy();
  });
  it("Test with historical data and normal nonce growth, but nonce rollback occurs", async () => {
    const limit = 2;
    const delaytime = 5;
    const signer = initParallelSigner(populateFun1, delaytime, limit);
    signer.setLogger((msg) => {
      console.log(`TEST4: ${msg}`);
    });
    const rqs = [
      { functionData: buildFunctionData1("0.01"), logId: 100 },
      { functionData: buildFunctionData1("0.01"), logId: 100 },
      { functionData: buildFunctionData1("0.01"), logId: 100 },
      { functionData: buildFunctionData1("0.01"), logId: 100 },
      { functionData: buildFunctionData1("0.01"), logId: 100 },
      { functionData: buildFunctionData1("0.01"), logId: 100 },
      { functionData: buildFunctionData1("0.01"), logId: 100 },
    ];
    signer.mockProvider["sendTransaction"] = function (
      tx,
      rawTx,
      packedTx: PackedTransaction
    ) {
      return null;
    };
    let checksignal = 0;
    // Insert data once
    const requestId1 = await signer.sendTransactions(rqs);
    signer.mockProvider["getTransactionCount"] = function (tag) {
      return 100;
    };
    // Perform one repack
    await signer.__rePack();
    signer.mockProvider["getTransactionCount"] = function (tag) {
      return 101;
    };

    {
      let lpx = await signer.requestStore.getLatestPackedTransaction(chainId);
      signer.mockProvider["getTransactionReceipt"] = function (txid) {
        if (lpx?.transactionHash === txid) {
          checksignal += 1;
          return {
            async confirmations() {
              return 0;
            },
          };
        }
        return null;
      };
      await signer.__rePack();
      expect(checksignal).toBe(1);
    }
    signer.mockProvider["getTransactionCount"] = function (tag) {
      return 102;
    };

    {
      let lpx = await signer.requestStore.getLatestPackedTransaction(chainId);
      signer.mockProvider["getTransactionReceipt"] = function (txid) {
        if (lpx?.transactionHash === txid) {
          checksignal += 1;
          return {
            async confirmations() {
              return 0;
            },
          };
        }
        return null;
      };
      await signer.__rePack();
      expect(checksignal).toBe(2);
    }

    // Perform three consecutive repacks, each with limit = 2, and check the requestid of the last inserted data
    const lpx1 = await signer.requestStore.getLatestPackedTransaction(chainId);
    expect(lpx1?.nonce).toBe(102);
    expect(
      _.isEqual(lpx1?.requestIds, [requestId1[4], requestId1[5]])
    ).toBeTruthy();

    // Start rolling back nonce
    signer.mockProvider["getTransactionCount"] = function (tag) {
      return 101;
    };

    {
      // After rollback, the first check on the chain should start from 100
      let lpx = await signer.requestStore.getLatestPackedTransaction(
        chainId,
        100
      );
      signer.mockProvider["getTransactionReceipt"] = function (txid) {
        if (lpx?.transactionHash === txid) {
          checksignal += 1;
          return {
            async confirmations() {
              return 0;
            },
          };
        }
        return null;
      };
      await signer.__rePack();
      expect(checksignal).toBe(3);
    }

    // nonce = 100, can be found on the chain, so start packing from position rqs[2]
    let lpx = await signer.requestStore.getLatestPackedTransaction(chainId);
    expect(lpx?.nonce).toBe(101);
    expect(
      _.isEqual(lpx?.requestIds, [requestId1[2], requestId1[3]])
    ).toBeTruthy();
  });
  //
  it("The number of confirmations exceeds the specified value, request txid should be set successfully", async () => {
    const limit = 10;
    const delaytime = 5;
    const signer = initParallelSigner(populateFun1, delaytime, limit);
    signer.setLogger((msg) => {
      console.log(`TEST5: ${msg}`);
    });
    const rqs = [
      { functionData: buildFunctionData1("0.01"), logId: 100 },
      { functionData: buildFunctionData1("0.01"), logId: 100 },
      { functionData: buildFunctionData1("0.01"), logId: 100 },
      { functionData: buildFunctionData1("0.01"), logId: 100 },
      { functionData: buildFunctionData1("0.01"), logId: 100 },
      { functionData: buildFunctionData1("0.01"), logId: 100 },
      { functionData: buildFunctionData1("0.01"), logId: 100 },
    ];
    signer.mockProvider["sendTransaction"] = function (
      tx,
      rawTx,
      packedTx: PackedTransaction
    ) {
      return null;
    };

    const requestId1 = await signer.sendTransactions(rqs);
    signer.mockProvider["getTransactionCount"] = function (tag) {
      return 100;
    };
    // Perform one repack
    await signer.__rePack();
    let lpx = await signer.requestStore.getLatestPackedTransaction(chainId);

    signer.__setTimeout(chainId, 1);
    await sleep(2);
    await signer.__rePack();

    signer.mockProvider["getTransactionReceipt"] = function (txid) {
      if (txid === lpx?.transactionHash) {
        return {
          async confirmations() {
            return signer.options.confirmations + 1;
          },
        };
      }
      return null;
    };

    signer.mockProvider["getTransactionCount"] = function (tag) {
      return 105;
    };

    await signer.__checkPackedTx();
    expect(requestId1.length).toBe(Math.min(limit, rqs.length));

    const requests = await signer.requestStore.getRequests(
      chainId,
      Math.min(...requestId1),
      limit
    );
    requests.forEach(async (v, i) => {
      expect(v.txId).toBe(lpx?.transactionHash);
    });
  });
});

function initParallelSigner(
  populateFun,
  delaySecond: number = 0,
  limit: number = 10
) {
  const provider = new JsonRpcProvider(
    hre.config.networks[hre.config.defaultNetwork]["url"],
    {
      name: hre.config.defaultNetwork,
      chainId: chainId,
    }
  );
  const parallelSigner = new ParallelSigner(
    hre.config.networks[hre.config.defaultNetwork]["accounts"][0],
    provider,
    requestStore,
    populateFun,
    {
      requestCountLimit: limit,
      delayedSecond: delaySecond,
      checkPackedTransactionIntervalSecond: 15,
    }
  );
  return parallelSigner;
}
