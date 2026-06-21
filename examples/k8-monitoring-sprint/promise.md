# Sprint 1 — a Kubernetes pod-monitoring dashboard

Planned: 2026-06-14T19:00:00Z
Waves: 5   Issues: 13   Budget: $45

A web UI that watches every running pod across your cluster: live status, CPU/memory
charts, a detail drawer per pod, and crashloop/restart alerts.

## Composition
| type | count |
|---|---|
| feature | 11 |
| improvement | 1 |
| qa | 1 |

## Issues
| # | type | title | files-owned | deps | wave |
|---|------|-------|-------------|------|------|
| 1  | feature     | k8s API client + auth       | backend/k8s/client.ts        | -          | 1 |
| 3  | feature     | time-series metrics store   | backend/store/timeseries.ts  | -          | 1 |
| 8  | feature     | dashboard shell + routing   | ui/Dashboard.tsx             | -          | 1 |
| 2  | feature     | pod metrics collector       | backend/collector/pods.ts    | 1          | 2 |
| 6  | feature     | metrics REST API            | backend/api/metrics.ts       | 3          | 2 |
| 4  | feature     | crashloop / restart alerts  | backend/alerts/rules.ts      | 2          | 3 |
| 5  | feature     | pods REST API               | backend/api/pods.ts          | 1, 2       | 3 |
| 7  | feature     | live pod status websocket   | backend/api/stream.ts        | 2          | 3 |
| 11 | feature     | cpu / memory charts         | ui/Charts.tsx                | 6          | 3 |
| 9  | feature     | pod list table              | ui/PodTable.tsx              | 5, 8       | 4 |
| 10 | feature     | pod detail drawer           | ui/PodDetail.tsx             | 5, 6       | 4 |
| 12 | improvement | live status indicators      | ui/LiveStatus.tsx            | 7, 8       | 4 |
| 13 | qa          | end-to-end dashboard test   | tests/e2e/dashboard.spec.ts  | 9, 10, 12  | 5 |

## Wave DAG
```mermaid
flowchart LR
  subgraph W1["Wave 1"]
    n1["#1 k8s API client + auth"]
    n3["#3 time-series metrics store"]
    n8["#8 dashboard shell + routing"]
  end
  subgraph W2["Wave 2"]
    n2["#2 pod metrics collector"]
    n6["#6 metrics REST API"]
  end
  subgraph W3["Wave 3"]
    n4["#4 crashloop / restart alerts"]
    n5["#5 pods REST API"]
    n7["#7 live pod status websocket"]
    n11["#11 cpu / memory charts"]
  end
  subgraph W4["Wave 4"]
    n9["#9 pod list table"]
    n10["#10 pod detail drawer"]
    n12["#12 live status indicators"]
  end
  subgraph W5["Wave 5"]
    n13["#13 end-to-end dashboard test"]
  end
  n1 --> n2
  n2 --> n4
  n1 --> n5
  n2 --> n5
  n3 --> n6
  n2 --> n7
  n5 --> n9
  n8 --> n9
  n5 --> n10
  n6 --> n10
  n6 --> n11
  n7 --> n12
  n8 --> n12
  n9 --> n13
  n10 --> n13
  n12 --> n13
```

## Out of scope
- Multi-cluster / multi-context switching
- Historical metrics beyond 24h retention
- Log streaming (only status + resource metrics this sprint)
- RBAC / per-namespace access control

## Definition of done (sprint)
- All sprint-1 issues merged
- `npm test` green, including the wave-5 end-to-end dashboard flow
- Dashboard runs locally against a kube context: pods list, statuses go live, a
  crashlooping pod raises an alert
