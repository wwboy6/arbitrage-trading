# Blockchain Arbitrage Trading

This is part 2 of a demo for arbitrage trading. This part is trying to scan for best routes between 2 currencies (that may or may not involve other currencies), and check if the forward (from A to B) and backward (from B to A) trading would form profitable arbitrage attack.

## Workflow Highlight

- Get related Pancakeswap V2 / V3 pools - the pools that involve either token A or B - and check trading routes from A to B, that may be direct exchange pool or a route that involve one more token.
- Keep checking best forward / backward trading route using SmartRouter.findBestTrade, and see if any profitable attack can be performed.

## Review

The scan take too long to form an attack and perform that before next block is committed. Another approach is implemented in part 3.
https://github.com/wwboy6/arbitrage-trading2.git
