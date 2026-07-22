# Basic OP Conformance 検証計画（OIDF Conformance Suite 実行手順の整理）

## 1. タイトル

OpenID Foundation 公式 Conformance Suite を用いて、本リポジトリが Basic OP 認定を実際に通過できるかを検証するための準備・実行計画。

## 2. このトピックで確認したいこと

`tasks/basic-op-requirement-traceability.md` は静的監査（要件 → 実装の机上対応）であるのに対し、本ファイルは **動的検証**（実際に OIDF Conformance Suite を走らせて Pass/Fail を取る）に必要な前提・障害・段取りを整理する。

- どのテストプランを選ぶか
- 本リポジトリ特有の制約（DCR 非対応、開発用 http、PoC 前提）が検証実行をどうブロックするか
- 検証を「いつ」やるかは `RELEASE-v0.x-scope.md`（Conformance は v1.0 条件、v0.x のブロッカーにしない）に従う。本ファイルは「やる時の手順」に限定する

## 3. 関連する仕様・基準

仕様セクションの共通説明は `tasks/basic-op-requirement-traceability.md` の「3. 関連する仕様・基準」を参照（重複記載回避）。本トピック固有の差分のみ記載する。

- OIDF Conformance Suite は **テストプラン単位**で実行する。Basic OP に相当するプランは "OpenID Connect Core: Basic Certification Profile Authorization server test" 系（`response_type=code`）
- Suite からの **クライアント登録方法**は2系統:
  - 動的登録（Dynamic Client Registration, OIDC Registration 1.0）— 本リポジトリ **未対応**（`tasks/extension-dynamic-client-registration.md` 参照）
  - 静的登録（Suite に client_id/secret/redirect_uri を手で設定）— 本リポジトリで採るべき経路
- Suite はテスト対象 OP の **Discovery ドキュメント（`/.well-known/openid-configuration`）** を起点に各エンドポイントを発見する。Discovery の正確性が前提（不足フィールドは 📌 `tasks/T-021-discovery-metadata.md` で追跡中）
- Suite はテスト対象エンドポイントへ外部から到達する必要があり、実運用上 **公開 HTTPS エンドポイント**（または Suite が許容するトンネル）が必須。OAuth 2.1 / OIDC Core はエンドポイントの TLS を要求する

## 4. 参照資料

- OpenID Conformance Suite — https://www.certification.openid.net/ （実行環境・テストプラン選択）
- Conformance Suite GitHub — https://gitlab.com/openid/conformance-suite （セルフホスト時の根拠）
- OpenID Certification 手続き — https://openid.net/certification/ （正式認定の申請フロー）
- OpenID Connect Core 1.0 §3.1 / §15.1 — テスト対象要件（詳細は traceability ファイル参照）
- 本リポジトリ `RELEASE-v0.x-scope.md` — 検証タイミングの戦略的位置づけ（v1.0 条件）

## 5. 現在の実装確認

- Discovery: `packages/sample/src/oidc-provider/routes/discovery.ts`（および CLI テンプレート `packages/cli/src/frameworks/hono/templates.ts`）。`subjectTypesSupported: ['public']` 等を静的設定
- 静的クライアント設定: `packages/sample/src/oidc-provider/config.ts`（登録済みクライアント定義の所在）
- DCR エンドポイント: **存在しない**（`registration` ルートファイルなし。core の `discovery.ts` は `registrationEndpoint` を任意出力できるが sample/CLI は未設定 = `registration_endpoint` を広告しない）
- TLS: core では issuer の https を `discovery.ts` で検証するのみ。TLS 終端は利用者のデプロイ責務（`RELEASE-v0.x-scope.md` で本番運用はスコープ外）

## 6. 現在の実装との差分（検証実行の観点）

満たしていること:

- Authorization Code Flow / PKCE / RS256 ID Token / UserInfo / prompt 等、Basic OP 中核は実装済み（traceability マトリクス参照）
- Discovery 起点でエンドポイント発見が可能

検証実行をブロック／要確認の項目:

- 🔴 **DCR 非対応**: Suite のテストプランは「静的クライアント」設定で実行する必要がある。Suite 側でプラン設定時に client_id / client_secret / redirect_uri を本リポジトリの静的クライアントと一致させる手順を文書化する必要がある
- 🟡 **公開 HTTPS 到達性**: Suite は OP のエンドポイントに到達する必要がある。ローカル開発（http://localhost）のままでは正式 Suite 実行不可。検証時のみ公開 HTTPS（リバースプロキシ / トンネル / 一時ホスティング）を用意する段取りが要る。これは本番ハードニングではなく「検証のための一時環境」であり PoC スコープと矛盾しない
- 🟡 **Discovery フィールドの整合**: 📌 `tasks/T-021-discovery-metadata.md` / `tasks/p2-discovery-response-modes-supported.md` が未完だと、Suite がメタデータ不足で一部テストを進められない可能性。検証前にこれらの完了状況を確認
- 🟡 **redirect_uri の Suite 既定値**: Suite はテスト用 callback（`https://<suite-host>/test/a/.../callback` 等）を使う。静的クライアントの redirect_uri にこれを登録する必要があり、厳密一致実装（📌 `done/p0-redirect-uri-fragment-rejection.md`）と相性確認が必要

## 7. 改善・追加を検討する理由

- traceability の机上監査だけでは「実際に通る」保証にならない。Basic OP 認定（`RELEASE-v0.x-scope.md` の Tier B = v1.0 条件）に進む際、ここでつまずくと手戻りが大きい
- 特に DCR 非対応は Suite 実行の段取りに直結するため、検証フェーズ前に「静的設定での Suite 実行手順」を確立しておく価値が高い
- 検証しない場合のリスク: 「Fidelity（Conformance 準拠）」という差別化軸のシグナルを主張できない／主張が裏付けなしになる

## 8. 実装方針の候補

実装変更を伴わない準備タスクが中心。方針候補:

- A 案（推奨度: 判断材料）: セルフホスト Conformance Suite（Docker）を一時的に立て、静的クライアント設定で Basic OP プランをドライラン。公開 HTTPS は一時トンネルで暫定対応
- B 案: 公式ホスト版 Suite（certification.openid.net）を使う。一時公開 HTTPS エンドポイントを用意し、静的クライアントを Suite 設定に手入力
- C 案: 検証は v1.0 直前まで実施しない（`RELEASE-v0.x-scope.md` 準拠）。本ファイルは手順の凍結保存に留める

いずれを採るか、また公開 HTTPS をどう用意するか（PoC スコープを越えない一時手段に限定する条件）は人間が判断する。

## 9. タスク案

- [ ] OIDF Conformance Suite の Basic OP テストプラン名と必要パラメータ（client 静的設定欄、redirect_uri、scope）を一次資料で確定し本ファイルに追記
- [ ] 静的クライアント設定で Suite を実行する手順書を作成（DCR を使わない経路）
- [ ] 検証専用の一時公開 HTTPS 手段を1つ選定（本番運用と混同しない明示注記つき）
- [ ] `T-021-discovery-metadata.md` / `p2-discovery-response-modes-supported.md` の完了を検証前提条件として依存関係に明記
- [ ] ドライラン結果を traceability マトリクスの状態列へ反映する運用を確認
