# Changesets

このディレクトリは [Changesets](https://github.com/changesets/changesets) が管理する。
変更内容とバージョン上げ方針（major / minor / patch）を記録するための仕組み。

## 使い方

変更を加えたら、リリース対象パッケージの変更を記録する changeset を作成する:

```bash
pnpm changeset
```

対象パッケージと semver の種類（major / minor / patch）を選び、変更概要を書く。
`.changeset/*.md` が生成されるので、これを通常のコミットに含めて push する。

`main` に push されると Release ワークフロー（`.github/workflows/release.yml`）が
未消化の changeset をまとめた "Version Packages" PR を自動作成する。
その PR をマージすると、バージョンと CHANGELOG が確定し、npm へ publish される。

publish は npm Trusted Publishing (OIDC) を利用するため、`NPM_TOKEN` などの長期トークンは不要。
詳細は `.github/workflows/release.yml` 冒頭のコメントを参照。
