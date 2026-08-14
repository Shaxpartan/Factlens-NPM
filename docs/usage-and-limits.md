# Usage and limits

Quota, purchased balance, and throughput belong to the developer account. Creating or rotating projects and keys does not create another allowance or rate-limit bucket.

| Policy | Free | Paid |
|---|---:|---:|
| Active projects | 3 | 100 |
| Active keys per project | 1 | 10 |
| Daily free requests | 30 shared/account/day | 0 |
| Throughput | 20/min shared/account | 60/min shared/account |
| Purchased request balance | None before the first top-up | Shared across all projects and keys |

Paid API credits use the current FactLens API rate: **$1 funds 30 API checks**. Existing unused paid balances are converted to the current request-credit scale by the API backend; the SDK does not perform local balance conversion.

A paid account does not also receive the free daily pool. Reaching zero purchased requests does not convert the account back to free; the API returns `CREDITS_EXHAUSTED` until balance is added.

Project keys, logs, request history, endpoint activity, and metrics remain attributed to the project that produced them.

```ts
const runtimeUsage = await factlens.usage.get();
const accountUsage = await factlens.usage.getAccount();
const oneProject = await factlens.usage.getAccount({ projectId });
```
