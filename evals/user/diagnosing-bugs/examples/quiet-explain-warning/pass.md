The pool allows at most 10 connections (`defaults.max`). When all 10 are busy, `acquire` logs that warning and queues the request until a connection is released or 30 seconds pass.
