import { ethers, config } from "hardhat";

async function main() {
  let provider = new ethers.JsonRpcProvider(
    config.networks[config.defaultNetwork]["url"]
  );

  const wallet = new ethers.Wallet(
    config.networks[config.defaultNetwork].accounts[0],
    provider
  );
  const signer = wallet.connect(provider);
  const contract = await ethers.getContractFactory("TransferMulticall", signer);
  const address = (await contract.deploy()).getAddress();
  console.log(await address);
  return;
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
