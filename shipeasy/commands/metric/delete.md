---
description: Soft-delete a Shipeasy metric
argument-hint: "<id>"
---

Soft-delete a metric. The API refuses if the metric is referenced by a
running experiment — stop the experiment first.

```bash
shipeasy metrics delete <id>
```
