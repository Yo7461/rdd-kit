---
domain: sample
updated: 2026-07-01
---

# Spec: sample

## C0001: サンプル実装の公開値
```yaml
kind: invariant
stability: draft
source: src/sample.ts
verified_by: manual
since: S0001
verified: S0001
```
サンプル契約。src/sample.ts が公開する値の存在を約束する(検証は manual)。

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
```text
