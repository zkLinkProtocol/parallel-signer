import "@nomicfoundation/hardhat-toolbox";
import dotenv from "dotenv";
import { HardhatUserConfig } from "hardhat/config";

dotenv.config({ path: `.env` });
dotenv.config({ path: `.env.local`, override: true });

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.18",
        settings: {
          viaIR: true,
          optimizer: {
            enabled: true,
            runs: 100,
          },
        },
      },
      {
        version: "0.7.6",
        settings: {
          optimizer: {
            enabled: true,
            runs: 800,
          },
        },
      },
    ],
  },
  networks: {
    hardhat: {
      allowUnlimitedContractSize: true,
    },
    polygon: {
      url: process.env.POLYGON_WEB3_URL,
      accounts: [process.env.POLYGON_WEB3_PRIVATE_KEY],
      chainId: 80001,
    },
  },
  defaultNetwork: "polygon",
};

export default config;
