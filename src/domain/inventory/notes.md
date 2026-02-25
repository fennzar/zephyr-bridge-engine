// For preparing arb legs for execution, we can refer to our inventory and use these steps to move funds around as needed.
// Once the arb has been completed, we can use these steps to settle into any stable (if the arb legs did not end in a stable).
// Optionally, we can have a final profit settlement step that moves from either ZSD.n, WZSD.e or USDT.x into our "finalized stable" = USDT.e (if the settlement didn't end there).
// We then can also use these steps to rebalance inventory as needed outside of arbs.

// TODO we should define more details for each op:
// - Which ops are defined between which venues
// - Which rates we use for each op
// - What fees we need to consider.
// - Duration it takes to execute them.
// - What protocol restrictions we need to consider

// We'd need to "rebuild" the OP details often to caputre the native rates and restrictions.

// Types of nativeMint:
// We use the mintRate for each to asset (protocol state dependent - spot vs ma price, we use the "worst rate" aka we price zeph at the high rate, we get less ZSD/ZRS/ZYS)
// ZEPH.n -> ZSD.n
// ZEPH.n -> ZRS.n
// ZSD.n -> ZYS.n

// Types of nativeRedeem:
// We use the redeemRate for each to asset (protocol state dependent - spot vs ma price, we use the "worst rate" aka we price ZSD/ZRS/ZYS at the low rate, we get less ZEPH back)
// ZSD.n -> ZEPH.n
// ZYS.n -> ZSD.n (mint and redeem rate are the same - no moving average rate)
// ZRS.n -> ZEPH.n

// Conversion fees apply too.
// convertZSDFee = 0.1%
// convertZYSFee = 0.1% (mint and redeem rate are the same - no moving average rate)
// convertZRSFee = 1%

// Restrictions:

// ZSD:
// Mint ZSD disabled @ 400% RR (spot and ma).
// Redeem ZSD always allowed, however if RR <100% then we will get x% on our dollars back (x = RR%) in ZEPH term (althogh this is exteremely unlikely to happen).

// ZRS:
// Mint ZRS disabled @ 800% RR (spot and ma).
// Redeem ZRS disabled @ 400% RR (spot and ma).

// ZYS:
// Mint ZYS always allowed.
// Redeem ZYS always allowed.

// Time to execute
// techincally they happen "instantly", but there is a 10 block unlock time (20mins) before we can move funds again.
// So this might matter for prepping our arb legs, we might want to consider another path or at least we will have to wait.
// If our inventory rebalancing is good, and the arb legs don't exceed our inventory, then this shouldn't be an issue.
// Regardless we should define this time to execute for completeness.

// swapEVM:
// Gas fees need to be considered to execute these swaps.
// Slippage tolerance? Liquidity pool depth?
// Time to execute (basically instant, next block).

// wrap:
// Negligible zephyr tx fee to send coins to bridge (but they are a thing).
// claim fee: We have to claim the voucher that the bridge creates. We pay the evm gas in ETH from our evm wallet. We get the full amount of the coin we are wrapping.
// - We could consider adding admin priority here too, as in we skip the voucher claim process for us entirely.
// - The contract deployer could mint directly to our evm wallet when we wrap from native to evm. This would save gas and time.
// - Either way "we" are paying the gas fees, either from the arb wallet or the deployer wallet. We just need to ensure that the deployer wallet has ETH for gas.
// -- Top up the deployer from our arb wallet directly?
// --- It's a good idea to have a system where we or any other user can "prepay" gas to the deployer wallet in order to skip the voucher claim process entirely, esp for any arbitrageurs who'd want instant wrap mints.
// --- In the bridge, for each EVM wallet address, we'd just keep track of the prepaid gas amounts and how many wraps this covers. Arbers call the api to see if they have enough prepaid gas before they wrap...
// --- We'd have to extend our contract to that the non-claim mint function also consumes the zephyr tx hash - not sure it currently does this.
// -- In our contract itself, when a user claims a voucher, we could collect a small eth fee for gas from them there...

// unwrap:
// burn tx eth gas fee.
// bridge fee: 0.01% (we burn 1 WZEPH.e, bridge pays out 0.99 ZEPH.n)

// wrap/unwrap fee ideas:
// -- We could collect some extra fees for our deployer wallet gas from users wrapping/unwrapping or even swapping on the LPs we are providing liquidity to.
// -- We already take a small 0.01% bridge unwrap fee (they burn 1 WZEPH, bridge pays out 0.99 ZEPH.n). After TX fees there is a small amount of profit there.
// -- We could increase this fee to 0.1% and/or we could have a minimum fee of 1 asset.
// -- The bridge's zephyr wallet would accumulate native assets over time, and to get more gas we could wrap them, and swap on the LPs for ETH.e to fund gas for the deployer wallet.
// --- We would just have to ensure that ETH gas we have to pay to mint wrapped tokens + LP swap fees is less than the ETH we'd get from selling the wrapped tokens for ETH.e on the LPs....

// Time to execute:
// bridge time
// - default prod = 10 blocks confirmation ~20mins
// - We could consider a "special" priority rule for us as the admin of the bridge to have instant bridging (no wait time). Probs a really really good idea.
// - We can either wait for 1 block, or we can even do 0 block confirmation since we trust our own txs. This would make the wrap instant from our POV.
// - If anything was to go awry, we will always "honor" the bridge and top it up if we ever needed to do so.

// CEX deposit/withdraw/trade for ZEPH.x and USDT.x:
// - deposit time: confirmation target dependent on each exchange and their nonsenses. Maybe there is a MEXC api to get this info?
// -- Currently mexc requires 20 confirmations for ZEPH deposits.
// - withdraw time: usually pretty quick, but for ZEPH when we receive from zephyr network we still have 10 block unlock time before we can use the funds again.
// - fees: we need to consider taker fees and withdrawal fees, hopefully api for this stuff too.
// - limits: exchange dependent

// Venue fees
// evm
// - wrap: gasFee (ETH.e) (either voucher claim gas or prepaid gas fee)
// - unwrap: bridgeFee (0.01%) + gasFee (ETH.e) for burn tx
// - swapEVM: txGas, <swapFee> (pool fee?), do we include slippage or other trading stuff here too?
// native
// - nativeMint: mintFee (ZSD/ZRS/ZYS)%
// - nativeRedeem: redeemFee (ZSD/ZRS/ZYS)%
// cex
// - deposit: depositFee (usually 0)
// - withdraw: withdrawFee + txFee
// - tradeCEX: takerFee/makerFee %

// venue rates
// evm
// - wrap: wrapRate (1:1)
// - unwrap: unwrapRate (0.99:1)
// - swapEVM: swapRate (pool price dependent)
// native
// - nativeMint: mintRate (protocol state dependent)
// - nativeRedeem: redeemRate (protocol state dependent)
// cex
// - deposit: depositRate (1:1)
// - withdraw: withdrawRate (1:1)
// - tradeCEX: tradeRate (market price dependent)

// venue durations
// evm
// - wrap: bridgeTime (10 blocks default, instant for admin priority?)
// - unwrap: bridgeTime (10 blocks default, instant for admin priority?)
// - swapEVM: txTime (1 block)
// native
// - nativeMint: txTime (instant)
// - nativeRedeem: txTime (instant)
// cex
// - deposit: depositTime (exchange dependent)
// - withdraw: withdrawTime (exchange dependent)
// - tradeCEX: txTime (instant)

/////////////////////////
// Op Details //
/////////////////////////

// E.g. wrap op detail:
// sources: [ZEPH.n]
// destinations: [WZEPH.e]
// rates: { wrapRate: 1 } // 1:1
// fees: { gas: 0.001 } // in ETH.e for voucher claim process, or if we implement the skip claim process, then this is the prepaid gas fee we collect from users.

// export interface OpDetail {
// define the scaffold?
// sources: AssetId[];
// destinations: AssetId[];
// rates: {
// [key: string]: number; // e.g., mintRate, redeemRate, swapRate, tradeRate, etc.
// }
// fees: {
// [key: string]: number; // e.g., mintFee, redeemFee, swapFee, tradeFee, etc.
// }
// duration:

// }

// build the scaffold?
// const OPS: Record<string, OpDetail> = {
// // [key in Op]?:
// };
