---
"@maronn-oidc/cli": minor
"@maronn-oidc/core": minor
---

CLIに機能トグル（--enable / --disable）を追加。pkce / refresh-token / introspection / revocation / request-object をデフォルトの全部入り構成から機能単位で増減して生成できるようにし、生成される conformance.test.ts も選択構成に合わせて無効挙動を契約テストとして固定するようにした。coreは validateTokenRequest を grant 単位の validateAuthorizationCodeGrant / validateRefreshTokenGrant に分割して公開し、supportedGrantTypes（OPが提供するgrantの制限）と requestObject.supported（OIDC Core 1.0 §6.3 の request_not_supported 拒否）オプションを追加した。デフォルト設定の挙動・生成出力は従来と完全互換。
