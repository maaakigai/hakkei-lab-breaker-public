Ticket02 auto-select input mode

- Changed: src/main/index.ts, src/main/startupInputMode.ts, src/shared/types.ts, src/renderer/app.ts, and test/startup-input-mode.test.ts.
- Decision: CLI `--input-mode=<mode>` takes precedence over `HAKKEI_INPUT_MODE`; absent or invalid values resolve to `none`.
- Reason: Ticket02 fixes the startup contract to avoid silently starting the keyboard generator, while preserving an explicit presentation fallback.
- Synchronization: `config:get` returns Main's active input mode together with the validated configuration. The Renderer applies it before its first render, avoiding an unreliable startup IPC push.
- Ordering: Main calls `applyMode` only after `createReceiver`, so the receiver's active source matches the advertised startup mode.
- Verification: `npm.cmd run typecheck`, `npm.cmd run lint`, and `npm.cmd test` completed successfully; 79 tests passed and none failed.
