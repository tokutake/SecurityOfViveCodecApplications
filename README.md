# Security of Vibe-Coded Applications

自然言語の指示からAIコーディングエージェントが生成するWebアプリについて、情報漏洩や権限の逸脱につながる欠陥を調べる研究です。

共通のアプリ仕様に対する生成結果を比較し、どのようなセキュリティ上の問題が生じるかを明らかにすることを目的とします。

## 実験一覧

| 実験 | 状態 | 概要 |
| --- | --- | --- |
| [SNS-01予備実験](experiments/2026-10-08-sns01-pilot/README.md) | 終了 | 7モデルが生成したSNSアプリの機能とセキュリティを評価。脆弱性候補の人手による最終判定は未完了。 |
| [Framework Security Comparison — Luna 01](experiments/framework-security-comparison-luna-01/README.md) | 探索的パイロット終了 | フレームワーク指定とセキュリティ指示の6条件を各1回比較。機能要件を通過した4件をセキュリティ評価し、自動検出候補3件は未検証。結果から条件の優劣は結論できない。 |
