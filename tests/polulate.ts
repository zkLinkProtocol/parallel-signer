import { BigNumberish } from "ethers";
import { Request } from "../src/ParallelSigner";
import { parseUnits } from "ethers";
import hre, { artifacts, ethers } from "hardhat";
const TransferMulticall_POLYGON_ADDRESS =
  "0x2e4f557B103F3dc20F5b2b8B7680d55c4F254703";
//abi function batchTrasnfer(uint256[] memory amount)
export async function populateFun1(requests: Request[]): Promise<{
  to: string;
  data: string;
  value?: BigNumberish;
  gasLimit: BigNumberish;
  maxFeePerGas?: string | null;
  maxPriorityFeePerGas?: string | null;
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
    gasLimit: BigInt("100000") * BigInt(requests.length),
    maxFeePerGas: null,
    maxPriorityFeePerGas: null,
    gasPrice: parseUnits("10", "gwei").toString(),
  };
}
//function multicall(bytes[] calldata data)
export async function populateFun2(requests: Request[]): Promise<{
  to: string;
  data: string;
  value?: BigNumberish;
  gasLimit: BigNumberish;
  maxFeePerGas?: string | null;
  maxPriorityFeePerGas?: string | null;
  gasPrice?: string;
}> {
  const factory = await ethers.getContractFactoryFromArtifact(
    await artifacts.readArtifact("TransferMulticall")
  );
  const calldata = factory.interface.encodeFunctionData("multicall", [
    requests.map((v) => v.functionData),
  ]);

  return {
    to: TransferMulticall_POLYGON_ADDRESS,
    data: calldata,
    value: 0,
    gasLimit: BigInt("100000") * BigInt(requests.length),
    maxFeePerGas: null,
    maxPriorityFeePerGas: null,
    gasPrice: parseUnits("10", "gwei").toString(),
  };
}

export function buildFunctionData1(amount: string): string {
  return parseUnits(amount, "ether").toString();
}

//multicall accept
//function accept(address to, uint256 amount)
export async function buildFunctionData2(
  to: string,
  amount: bigint
): Promise<string> {
  const factory = await ethers.getContractFactoryFromArtifact(
    await artifacts.readArtifact("TransferMulticall")
  );
  return factory.interface.encodeFunctionData("accept", [to, amount]);
}
