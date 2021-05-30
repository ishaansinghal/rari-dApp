require("@nomiclabs/hardhat-waffle");

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  solidity: {
    version: "0.5.17", // 0.5.17 for compound-protocol and 0.6.12 for fuse-contracts
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    hardhat: {
      forking: {
        url: "https://turbogeth.crows.sh",
        blockNumber: 12085726
      },
      blockGasLimit: 20000000,
      gasPrice: 1
    },
    dev: {
      url: "http://localhost:8546"
    }
  },
  paths: {
    root: "../../../compound-protocol" // compound-protocol or fuse-contracts
  }
};
