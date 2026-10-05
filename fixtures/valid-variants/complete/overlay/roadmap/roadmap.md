---
project: fixture-app
updated: 2026-07-01
---

# Roadmap: フィクスチャ用サンプルアプリ

## Vision
規約に沿った最小構成のサンプルアプリを、小さなフェーズで完成させる。

## Principles
- フェーズは小さく刻む
- 骨格は素の TypeScript で書く(D-P0001-0001)

## Phases

### P0001: 最初のフェーズ — done
- type: build
- goal: サンプル実装を1本通す
- acceptance:
  - サンプルのテストが1件 pass する — 検証: テスト参照
- depends: —
- blockers: —

### P0002: 第二フェーズ — done
- type: build
- goal: タスク一覧を消化して仕上げる
- why: 骨格だけでは Vision の「完成」に届かない — 一覧のタスクを消化して初めてサンプルアプリになる
- outcome: サンプルアプリを起動すると、一覧にあった機能が一通り使える
- acceptance:
  - 残タスクがゼロになる — 検証: status.md の Next が空になること
- depends: P0001
- blockers: —

### P0004: 早期ドロップ — dropped

### P0005: 後期ドロップ — dropped
- type: build
- goal: 拡張機能(スコープ縮小により中止。着手後のためディレクトリあり)

### P0006: ブロック中 — dropped
- type: build
- goal: 社内配布(権限承認待ち)
- depends: P0002

### P0007: 第三フェーズ — dropped
- type: build
- goal: リリース準備
- why: 手元で動くだけでは配布できない

## Blockers
| ID | blocks | 内容 | 状態 |
|----|--------|------|------|
| B0002 | P0006 | 社内権限申請の承認待ち | open |

## Parking Lot
- (なし)

## Deferred
- (なし)
