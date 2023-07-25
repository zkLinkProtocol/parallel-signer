# README.md

# Project Description

This project is designed to ...

# Initialization Steps

To initialize the project, follow these steps:

1. Set up the network configuration in the `.env` file:

```
POLYGON_WEB3_URL=""
POLYGON_WEB3_PRIVATE_KEY=""
```

Note: The `POLYGON_WEB3_URL` should be obtained from chainlist.org for the Polygon testnet RPC node. The `POLYGON_WEB3_PRIVATE_KEY` are the private keys required for deploying test contracts and executing test case. You can export the private keys from Metamask.

2. Obtain the gas token for the Polygon testnet.

3. Execute the following command to deploy the test contracts:
   ```bash
   npx hardhat run tests/deploy.ts
   ```

# How to Use

## Call the normal batch execution function

```ts
export async function populateFun1(requests: Request[]): Promise<{
  to: string;
  data: string;
  value?: BigNumberish;
  gasLimit: BigNumberish;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  gasPrice?: string;
}> {
  const artifact = await artifacts.readArtifact("TransferMulticall");
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode);
  const calldata = factory.interface.encodeFunctionData("batchTrasnfer", [
    requests.map((v) => v.functionData),
  ]);

  return {
    to: TransferMulticall_POLYGON_ADDRESS,
    data: calldata,
    value: 0,
    gasLimit: BigNumber.from("100000").mul(requests.length),
    maxFeePerGas: null,
    maxPriorityFeePerGas: null,
    gasPrice: parseUnits("10", "gwei").toString(),
  };
}
```

```ts
export function buildFunctionData1(amount: string): string {
  return parseUnits(amount, "ether").toString();
}
```

## A contract that supports the multicall method

```ts
export async function populateFun2(requests: Request[]): Promise<{
  to: string;
  data: string;
  value?: BigNumberish;
  gasLimit: BigNumberish;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  gasPrice?: string;
}> {
  const factory = (await ethers.getContractFactoryFromArtifact(
    await artifacts.readArtifact("TransferMulticall")
  )) as TransferMulticall__factory;
  const calldata = factory.interface.encodeFunctionData("multicall", [
    requests.map((v) => v.functionData),
  ]);

  return {
    to: TransferMulticall_POLYGON_ADDRESS,
    data: calldata,
    value: 0,
    gasLimit: BigNumber.from("100000").mul(requests.length),
    maxFeePerGas: null,
    maxPriorityFeePerGas: null,
    gasPrice: parseUnits("10", "gwei").toString(),
  };
}
```

```ts
export async function buildFunctionData2(
  to: string,
  amount: BigNumber
): Promise<string> {
  const factory = (await ethers.getContractFactoryFromArtifact(
    await artifacts.readArtifact("TransferMulticall")
  )) as TransferMulticall__factory;
  return factory.interface.encodeFunctionData("accept", [to, amount]);
}
```
