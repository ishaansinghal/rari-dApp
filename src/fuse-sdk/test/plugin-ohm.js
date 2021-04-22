var assert = require('assert');
var Big = require('big.js');

const Fuse = require("../dist/fuse.node.commonjs2.js");

assert(process.env.TESTING_WEB3_PROVIDER_URL, "Web3 provider URL required");
var fuse = new Fuse(process.env.TESTING_WEB3_PROVIDER_URL);

var erc20Abi = JSON.parse(fuse.compoundContracts["contracts/EIP20Interface.sol:EIP20Interface"].abi);
var cErc20Abi = JSON.parse(fuse.compoundContracts["contracts/CErc20Delegate.sol:CErc20Delegate"].abi);
var cEtherAbi = JSON.parse(fuse.compoundContracts["contracts/CEtherDelegate.sol:CEtherDelegate"].abi);

// Snapshot + revert + dry run wrapper function
var snapshotId = null;

function snapshot() {
  return new Promise(function(resolve, reject) {
    fuse.web3.currentProvider.send({
      jsonrpc: "2.0",
      method: "evm_snapshot",
      id: 1
    }, function(err, result) {
      if (err) return reject(err);
      snapshotId = result.result;
      resolve();
    });
  });
}

function revert() {
  return new Promise(function(resolve, reject) {
    assert(snapshotId !== null);
    fuse.web3.currentProvider.send({
      jsonrpc: "2.0",
      method: "evm_revert",
      params: [snapshotId],
      id: new Date().getTime()
    }, function(err, result) {
      if (err) return reject(err);
      assert(result.result);
      resolve();
    });
  });
}

function dryRun(promise) {
  return async function() {
    await snapshot();
    var error = null;

    try {
      await promise();
    } catch (_error) {
      error = _error;
    }

    await revert();
    if (error !== null) throw error;
  }
}

// Pass time
function increaseTime(seconds) {
  return new Promise(function(resolve, reject) {
    assert(seconds !== null);
    fuse.web3.currentProvider.send({
      jsonrpc: "2.0",
      method: "evm_increaseTime",
      params: [seconds],
      id: new Date().getTime()
    }, function(err, result) {
      if (err) return reject(err);
      assert(result.result);
      resolve();
    });
  });
}

// Test state variables
var accounts, assetAddresses, comptroller, simplePriceOracle;

// Deploy pool + assets
async function deployPool(conf, options) {
  if (conf.closeFactor === undefined) conf.poolName = "Example Fuse Pool " + (new Date()).getTime();
  if (conf.closeFactor === undefined) conf.closeFactor = Fuse.Web3.utils.toBN(0.5e18);
  else conf.closeFactor = Fuse.Web3.utils.toBN((new Big(conf.closeFactor)).mul((new Big(10)).pow(18)).toFixed(0));
  if (conf.maxAssets === undefined) conf.maxAssets = 20;
  if (conf.liquidationIncentive === undefined) conf.liquidationIncentive = Fuse.Web3.utils.toBN(1.08e18);
  else conf.liquidationIncentive = Fuse.Web3.utils.toBN((new Big(conf.liquidationIncentive)).mul((new Big(10)).pow(18)).toFixed(0));

  var [poolAddress, implementationAddress, priceOracleAddress] = await fuse.deployPool(conf.poolName, conf.isPrivate, conf.closeFactor, conf.maxAssets, conf.liquidationIncentive, conf.priceOracle, conf.priceOracleConf, options);
  return [poolAddress, priceOracleAddress];
}

async function deployAsset(conf, collateralFactor, reserveFactor, adminFee, options, bypassPriceFeedCheck) {
  if (conf.interestRateModel === undefined) conf.interestRateModel = "0x6bc8fe27d0c7207733656595e73c0d5cf7afae36";
  if (conf.decimals === undefined) conf.decimals = 8;
  if (conf.admin === undefined) conf.admin = options.from;
  if (collateralFactor === undefined) collateralFactor = Fuse.Web3.utils.toBN(0.75e18);
  if (reserveFactor === undefined) reserveFactor = Fuse.Web3.utils.toBN(0.2e18);
  if (adminFee === undefined) adminFee = Fuse.Web3.utils.toBN(0.05e18);

  var [assetAddress, implementationAddress, interestRateModel] = await fuse.deployAsset(conf, collateralFactor, reserveFactor, adminFee, options, bypassPriceFeedCheck);
  return assetAddress;
}

async function deployPoolWithEthAndOhm() {
  accounts = await fuse.web3.eth.getAccounts();

  // Deploy pool
  var [poolAddress, priceOracleAddress] = await deployPool({ priceOracle: "SimplePriceOracle" }, { from: "0xb8f02248d53f7edfa38e79263e743e9390f81942", gasPrice: "0", gas: 1000000 });
  comptroller = new fuse.web3.eth.Contract(JSON.parse(fuse.compoundContracts["contracts/Comptroller.sol:Comptroller"].abi), poolAddress);

  // Set initial token prices
  simplePriceOracle = new fuse.web3.eth.Contract(JSON.parse(fuse.compoundContracts["contracts/SimplePriceOracle.sol:SimplePriceOracle"].abi), priceOracleAddress);
  await simplePriceOracle.methods.setDirectPrice("0x0000000000000000000000000000000000000000", Fuse.Web3.utils.toBN(1e18)).send({ from: accounts[0], gasPrice: "0", gas: 1000000 });
  await simplePriceOracle.methods.setDirectPrice("0x383518188c0c6d7730d91b2c03a03c837814a899", "367772000000000000").send({ from: accounts[0], gasPrice: "0", gas: 1000000 });

  // Deploy assets
  assetAddresses = {};
  for (const conf of [
    { name: "Fuse ETH", symbol: "fETH" },
    { name: "Fuse OHM", symbol: "fOHM", underlying: "0x383518188c0c6d7730d91b2c03a03c837814a899" }
]) assetAddresses[conf.symbol] = await deployAsset({ comptroller: poolAddress, ...conf }, undefined, undefined, undefined, { from: accounts[0], gasPrice: "0", gas: 1000000 }, true);
}

// Function to set up OHM borrows
async function setupOhmBorrowWithEthCollateral() {
  // Supply ETH
  var cToken = new fuse.web3.eth.Contract(cEtherAbi, assetAddresses["fETH"]);
  await cToken.methods.mint().send({ from: accounts[0], gasPrice: "0", value: Fuse.Web3.utils.toBN(1e15) });

  // Supply OHM from other account
  var token = new fuse.web3.eth.Contract(erc20Abi, "0x383518188c0c6d7730d91b2c03a03c837814a899");
  var cToken = new fuse.web3.eth.Contract(cErc20Abi, assetAddresses["fOHM"]);
  await token.methods.approve(cToken.options.address, Fuse.Web3.utils.toBN(1e6)).send({ from: accounts[1], gasPrice: "0" });
  await cToken.methods.mint(Fuse.Web3.utils.toBN(1e6)).send({ from: accounts[1], gasPrice: "0" });

  // Borrow OHM using ETH as collateral
  await comptroller.methods.enterMarkets([assetAddresses["fETH"]]).send({ from: accounts[0], gasPrice: "0" });
  await cToken.methods.borrow(Fuse.Web3.utils.toBN(1e5)).send({ from: accounts[0], gasPrice: "0" });

  // Set price of ETH collateral to 1/10th of what it was
  await simplePriceOracle.methods.setDirectPrice("0x0000000000000000000000000000000000000000", Fuse.Web3.utils.toBN(1e17)).send({ from: accounts[0], gasPrice: "0" });
}

describe('OHMInterestRateModel', function() {
  this.timeout(10000);

  before(async function() {
    this.timeout(20000);
    await deployPoolWithEthAndOhm();
  });

  describe('#getBorrowRate()', function() {
    // Check borrow rate when there are no borrows
    it('should return the correct borrow rate when there are no borrows', dryRun(async () => {
      await setupOhmBorrowWithEthCollateral(undefined, true);
      console.log('your mom')
      // TODO: Check borrow rate against OHM staking rate
    }));

    // Check borrow rate
    it('should return the correct borrow rate when there are borrows', dryRun(async () => {
      await setupOhmBorrowWithEthCollateral(undefined, true);
      // TODO: Check borrow rate against expected borrow rate (given OHM staking rate and utilization rate)
    }));
  });

  describe('#getSupplyRate()', function() {
    // Check borrow rate
    it('should return the correct borrow rate', dryRun(async () => {
      await setupOhmBorrowWithEthCollateral(undefined, true);
      // TODO: Check borrow rate
    }));
  });
});

describe('COhmDelegate', function() {
  this.timeout(10000);

  before(async function() {
    this.timeout(20000);
    await deployPoolWithEthAndOhm();
  });

  describe('#mint()', function() {
    // Check borrow rate
    it('should return the correct supply balance', dryRun(async () => {
      await setupOhmBorrowWithEthCollateral(undefined, true);

      // Jump 30 days into the future
      await increaseTime(60 * 60 * 24 * 30);

      // TODO: Check supply balance against expected interest (given OHM staking rate and utilization rate)
    }));
  });

  describe('#borrow()', function() {
    // Check borrow rate
    it('should return the correct borrow balance', dryRun(async () => {
      // Setup OHM borrow with ETH collateral
      await setupOhmBorrowWithEthCollateral(undefined, true);

      // Jump 30 days into the future
      await increaseTime(60 * 60 * 24 * 30);

      // TODO: Check borrow balance against expected interest (given OHM staking rate and utilization rate)
    }));
  });
});
