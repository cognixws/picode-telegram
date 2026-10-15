### Added
- Add separately admitted Assistant conversations through `/assistants` and one typed CLI/Assistant selection with canonical Reply routing.
- Support explicit host-granted channel tools over API 4/protocol 2 with durable, read-only delivery receipts and no automatic replay of uncertain operations.

### Fixed
- Recheck message-text consent and Assistant reply admission immediately before provider dispatch.
- Reserve Assistant input capacity before host execution and retain known-no-effect retries after temporary host verification failures.
- Reconcile pending Assistant responses at startup/reset without forwarding unrelated history; retain unknown outcomes after malformed provider receipts or metadata failures.
