# Implementations of Features for Our Projects

We will use some features from this project to conduct tests and determine the best way to implement them in our projects. Note that this repository contains mixed files from different approaches and tests. We will cherry-pick the files we need for specific use cases and create new projects with them.

For example, the `idb-simple.ts` adapter cannot work simultaneously with the `idb-tenant.ts` adapter.

## Goals

- StarFX store setup
- Web workers for persistence handling
- Web workers for data processing
- Persistence in IndexedDB
- Back-up persisted data on the server
- Efficient hydration of the store
- Multi-tenant stores and persistence, including switching between tenants
- Handling large historical data scenarios:
  - Data fetching: load totals only, load details on demand
  - Data fetching: sharded data fetching
  - Persistence: recent shard persistence, older data directly in IndexedDB
