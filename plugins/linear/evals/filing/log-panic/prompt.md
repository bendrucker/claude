File this on ENG. The ledger-sync worker crashloops in prod since this morning's deploy. Pod logs:

```
2026-10-21T08:14:02.118Z INFO  ledger-sync starting version=2.41.0 commit=9f3c1ab
2026-10-21T08:14:02.204Z INFO  connected to postgres host=ledger-db-primary pool=20
2026-10-21T08:14:02.311Z INFO  subscribed topic=ledger.entries group=ledger-sync partitions=12
2026-10-21T08:14:03.877Z INFO  batch received partition=4 offset=88213042 size=500
2026-10-21T08:14:03.902Z WARN  entry missing currency id=le_7Hq2 defaulting=USD
panic: runtime error: invalid memory address or nil pointer dereference
[signal SIGSEGV: segmentation violation code=0x1 addr=0x18 pc=0x9a4c1e]

goroutine 47 [running]:
github.com/acme/ledger/internal/sync.(*Applier).apply(0xc0001a6000, {0xc000412000, 0x1f4, 0x200})
	/src/internal/sync/applier.go:132 +0x1de
github.com/acme/ledger/internal/sync.(*Applier).Run(0xc0001a6000, {0xb81e20, 0xc00007e0f0})
	/src/internal/sync/applier.go:71 +0x2a5
github.com/acme/ledger/internal/sync.(*Worker).handle(0xc000130080, {0xb81e20, 0xc00007e0f0}, 0xc0003c2000)
	/src/internal/sync/worker.go:58 +0x14b
github.com/acme/ledger/internal/consumer.(*Group).dispatch.func1()
	/src/internal/consumer/group.go:203 +0x8e
created by github.com/acme/ledger/internal/consumer.(*Group).dispatch in goroutine 1
	/src/internal/consumer/group.go:198 +0x1c5

goroutine 1 [select]:
github.com/acme/ledger/internal/consumer.(*Group).Wait(0xc000130000)
	/src/internal/consumer/group.go:112 +0x105
main.main()
	/src/cmd/ledger-sync/main.go:44 +0x3f8
```

It started with 2.41.0. 2.40.3 was fine.
