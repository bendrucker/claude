---
fail: []
---
```text
handleCheckout
  checkout
    holdInventory
    authorize        throws CardDeclinedError
    releaseInventory
  catch → 402 card_declined
```

`capture`, `awardPoints`, `scheduleShipment`, and `sendReceipt` never run.
