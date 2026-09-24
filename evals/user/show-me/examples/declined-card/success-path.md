---
fail: [only-decline-path]
---
```text
checkout
  holdInventory
  authorize          throws CardDeclinedError
    releaseInventory
  capture
  awardPoints
  scheduleShipment
  sendReceipt
handleCheckout → 402
```
