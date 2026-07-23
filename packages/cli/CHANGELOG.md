# @maronn-oidc/cli

## 0.1.0

### Minor Changes

- 45df806: CLI 生成 OpenID Provider の鍵検証、HTTP method/content-type 契約、view 拡張と HTML escaping、public client revocation、同意取り消し時の grant 失効を強化する。Hono の createApp/applyOidc を同等化し、Node adapter の複数 Set-Cookie を保持する。
- 45df806: CLI に機能トグル（--enable / --disable）を追加。pkce / refresh-token / introspection / revocation / request-object をデフォルトの全部入り構成から機能単位で増減して生成できるようにし、生成される conformance.test.ts も選択構成に合わせて無効挙動を契約テストとして固定するようにした。core は validateTokenRequest を grant 単位の validateAuthorizationCodeGrant / validateRefreshTokenGrant に分割して公開し、supportedGrantTypes（OP が提供する grant の制限）と requestObject.supported（OIDC Core 1.0 §6.3 の request_not_supported 拒否）オプションを追加した。デフォルト設定の挙動・生成出力は従来と完全互換。

## 0.1.1

### Patch Changes

- 9eadae8: sample version up

## 0.1.0

### Minor Changes

- 70035b4: Make the login / consent UI injectable and generate native React pages for Next.js.

  - All frameworks: the generated provider now accepts a `views?: Partial<Views>`
    option (`createApp` / `applyOidc`) so you can inject your own login / consent /
    error UI from outside instead of editing `views.ts`. The default views remain
    the default. `views.ts` now exports `defaultViews` and a `createViews()` helper.
  - Next.js: login and consent are generated as real App Router `page.tsx` React
    Server Components backed by Server Actions (`actions.ts`) instead of HTML-string
    Route Handlers, so the generated code can leverage JSX, components and the rest
    of the React/Next.js ecosystem.

### Patch Changes

- d63778f: Trusted Package と Changelog によるライブラリ発行
