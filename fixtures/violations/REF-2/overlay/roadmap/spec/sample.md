---
domain: sample
updated: 2026-07-01
---

# Spec: sample

## C0001: サンプル実装の公開値
```yaml
kind: invariant
stability: draft
source: src/missing.ts
verified_by: manual
since: S0001
verified: S0001
```
サンプル契約。source のパスが実在しない(REF-2 の最小変異)。

## C0003: タスク一覧の形式
```yaml
kind: file-format
stability: draft
source: src/sample.ts
verified_by: manual
since: S0002
verified: S0002
```
status.md の Next はチェックボックス箇条書きで保つ(C 番号には廃止済みの欠番がある)。
