import { BigNumber, BigNumberish } from "ethers";
import { Request } from "../src/ParallelSigner";
import { parseUnits } from "ethers/lib/utils";
import { artifacts, ethers } from "hardhat";
import { TransferMulticall__factory } from "../typechain-types";

const TransferMulticall_POLYGON_ADDRESS =
  "0x2e4f557B103F3dc20F5b2b8B7680d55c4F254703";
//abi function batchTrasnfer(uint256[] memory amount)
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
//function multicall(bytes[] calldata data)
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

export function buildFunctionData1(amount: string): string {
  return parseUnits(amount, "ether").toString();
}

//multicall accept
//function accept(address to, uint256 amount)
export async function buildFunctionData2(
  to: string,
  amount: BigNumber
): Promise<string> {
  const factory = (await ethers.getContractFactoryFromArtifact(
    await artifacts.readArtifact("TransferMulticall")
  )) as TransferMulticall__factory;
  return factory.interface.encodeFunctionData("accept", [to, amount]);
}
