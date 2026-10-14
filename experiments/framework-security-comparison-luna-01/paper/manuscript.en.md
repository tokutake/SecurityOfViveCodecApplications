# Framework Instructions, Security Guidance, and the Security of AI-Generated Web Applications: An Exploratory Six-Condition Study

**Manuscript status:** exploratory pilot report; findings are preliminary and not peer reviewed
**Study:** Luna study 01
**Date:** 14 October 2026

## Abstract

AI coding agents can generate similar applications under different framework and security-prompt conditions, but it is unclear whether the resulting security outcomes differ. We report an exploratory study in which Codex CLI with `gpt-6-luna` generated a micro-social application under six conditions: no named full-stack framework, Next.js, or TanStack Start, each with or without an added security instruction. We generated one application per condition, applied a predefined functional acceptance gate, and ran automated security checks only where the application passed the relevant functional prerequisites. Four of six applications passed all seven functional checks. Three of those four produced an automated candidate for an Origin/CSRF check; none of the candidates has yet been independently reproduced by a human. The no-framework, security-instruction condition passed all functional checks and produced no automated candidates. Its paired no-framework condition without the added instruction also passed functionality but produced one candidate. This single contrast does not establish that either prompt condition is safer, and it does not establish that having no named framework is best. The two framework-plus-security-instruction applications failed functional checks and therefore have no security outcome. Generation took 25 minutes 45 seconds in total. Because each cell contains one generation, some tests were incomplete or inconclusive, and candidate findings remain unverified, the study supports only descriptive observations and motivates replication and manual validation.

**Keywords:** AI-generated software; application security; web frameworks; security prompts; functional testing; exploratory study

## 1. Introduction

AI coding agents are increasingly used to produce complete web applications from natural-language specifications. Framework selection and explicit security guidance may influence the generated architecture and implementation, yet observed differences can also arise from model variation, dependencies, implementation choices, and execution environments. A small controlled comparison can help identify failure modes and improve evaluation methods, but it cannot establish broad rankings without repeated generations and reliable security confirmation.

This report describes six applications generated from the same micro-social application specification using one model and agent version. We varied whether the prompt named a full-stack framework and whether it included an additional security instruction. We evaluated functionality separately from security so that missing or broken functionality would not be misreported as successful security behavior.

The study is exploratory. In particular, “no framework” means that the prompt did not name a full-stack framework; it does not mean that the generated application used no libraries or runtime framework components.

### Research questions

- **RQ1:** What automated security-test outcomes were observed across the framework-instruction and security-guidance prompt conditions?
- **RQ2:** Which generated applications met the functional acceptance criteria and were consequently eligible for security evaluation?
- **RQ3:** What generation time and token usage were observed in these six runs?

## 2. Methods

### 2.1 Study design

We used a 3 × 2 exploratory design: no named full-stack framework, Next.js, or TanStack Start, crossed with absence or presence of an additional security instruction. Each of the six cells received one generation. The common application specification described a small social application with OpenID Connect (OIDC) login, public posts, private posts, direct-message groups, author and timestamp display, and SQLite persistence. Framework and security conditions were implemented as prompt additions to this shared specification.

The generation order was recorded before the study. The agent was Codex CLI 0.162.1 using `gpt-6-luna` via ChatGPT sign-in. Runs were conducted on macOS, with generated applications bound to loopback during evaluation. OIDC used a disposable mock identity provider and dummy credentials. No real user accounts or production credentials were used.

### 2.2 Functional acceptance gate

We evaluated seven functional checks (F0–F6) before security testing: application start and home response; successful OIDC login and logout; public post creation and retrieval; private post creation and owner access; direct-message group and member operations; display of author and timestamp; and persistence across a real process restart. Each check was recorded as pass, fail, or not evaluable. Security tests that depended on a legitimate operation failing were classified as inconclusive rather than defended. Security testing was conducted only for applications that passed all seven checks in this study.

### 2.3 Security checks

The automated harness assessed private-post access, direct-message read and write boundaries, HTML/script handling, OIDC state tampering, SQL-special-character handling, and cross-origin request handling. T6 and T9 were not implemented in the harness. Some checks had further observation limits: T4 could require browser-rendering confirmation, T5 required a successful normal OIDC callback control, and T8 did not emulate browser SameSite-cookie behavior. An automated “candidate” is a signal requiring manual reproduction; it is not counted as a confirmed vulnerability.

### 2.4 Measures and analysis

We report per-run functional status, available automated security outcomes, elapsed generation time, and token counts. We use descriptive case comparisons only. We do not perform significance testing, estimate vulnerability rates, or infer causal effects from one observation per cell. “Reference credits” are a standardized token-rate conversion for relative comparison and are not actual plan charges or measured subscription quota consumption.

## 3. Results

### 3.1 Functional and security outcomes

| Prompt condition | Functional gate | Automated security outcome |
|---|---:|---|
| No framework named, security instruction present (`none-on`) | 7/7 pass | 7 checks defended; no candidate observed |
| No framework named, security instruction absent (`none-off`) | 7/7 pass | 6 checks defended; T8 candidate |
| Next.js, security instruction absent (`nextjs-off`) | 7/7 pass | 4 defended; T4 and T5 inconclusive; T8 candidate |
| Next.js, security instruction present (`nextjs-on`) | F0 pass; F1 fail; F2–F6 not evaluable | Not run because the functional gate failed |
| TanStack Start, security instruction absent (`tanstack-off`) | 7/7 pass | 6 checks defended; T8 candidate |
| TanStack Start, security instruction present (`tanstack-on`) | F0 fail; F1–F6 not evaluable | Not run because the functional gate failed |

The T8 candidates occurred in the three functionally complete applications without the added security instruction. They have not been manually reproduced, and the harness did not model browser SameSite-cookie behavior. Therefore, the observation is a set of unverified automated signals, not evidence of three confirmed CSRF vulnerabilities. The no-framework condition with the added security instruction had no automated candidates in its one run; this is not proof that it is secure.

The Next.js application without the added instruction had inconclusive T4 and T5 results. T4 returned JSON in a way that left browser-rendered behavior unconfirmed. T5's valid callback control failed, preventing a meaningful state-tampering comparison. These outcomes are not counted as defended.

The Next.js application with the added security instruction rendered its home page, but a mock-IdP login callback did not establish a session and `/api/me` returned an unauthenticated result. The underlying cause was not fully isolated. The TanStack Start application with the added security instruction returned HTTP 500 at startup because its server entry did not export the fetch handler expected by the runtime. Neither application passed the full functional gate, so their security outcomes are unavailable; they must not be interpreted as secure or insecure.

### 3.2 Generation time and usage

| Prompt condition | Elapsed | Input tokens (cached) | Output tokens | Reference credits* |
|---|---:|---:|---:|---:|
| `none-on` | 2:24 | 596,765 (552,960) | 13,617 | 0.418 |
| `tanstack-on` | 6:06 | 1,986,103 (1,865,472) | 27,504 | 1.112 |
| `none-off` | 4:12 | 610,663 (560,384) | 8,607 | 0.373 |
| `nextjs-off` | 3:18 | 406,636 (340,736) | 14,032 | 0.425 |
| `nextjs-on` | 4:13 | 658,192 (610,304) | 19,288 | 0.513 |
| `tanstack-off` | 5:32 | 1,539,770 (1,423,872) | 19,200 | 0.886 |
| **Total** | **25:45** | **5,798,129 (5,353,728)** | **102,248** | **3.728** |

\* Standardized reference conversion based on the rates recorded in the experiment log. This is not a bill, API charge, or actual ChatGPT/Codex plan usage measurement. Cached tokens are shown separately and are included in the conversion.

## 4. Discussion

The most salient observation is not that “no instructions and no framework” was best. In the no-framework pair, the application generated with security guidance had no automated candidate, while the one generated without it had one unverified T8 candidate. Since there was only one run per condition, random generation variation and implementation details could explain this difference. The candidate also requires manual reproduction with browser behavior represented. The result is compatible with the possibility that explicit security guidance helped in this instance, but it does not establish that effect.

Nor can the study compare framework security in a balanced way. Both framework-plus-security-instruction runs failed a functional prerequisite, so security tests were not run for them. The three functionally complete conditions without the added instruction each produced a T8 candidate, but a single generation per framework condition and the harness limitation do not support a framework ranking. More generally, a framework-name condition is a prompt-level intervention that can change architecture, libraries, and generated code; this design does not isolate an intrinsic framework effect.

The functional gate was useful for distinguishing “not tested” from “defended.” It exposed two applications that were not ready for security evaluation and prevented normal-operation failures from being counted as security protections. This is important for generated-software studies: a security result is meaningful only when the tested feature and its legitimate control path work.

The generation-use figures show substantial variation across these six runs, but they are descriptive outputs from one run per condition. In particular, reference credits should not be presented as actual spend or plan consumption. More replications are required before drawing cost comparisons.

## 5. Limitations and next steps

This is a six-run pilot with one observation per cell, one model, one agent version, one application specification, and one test environment. The findings do not generalize to other models, tasks, framework versions, or deployment settings. Security evaluation was automated and incomplete: T6 and T9 were absent, some outcomes were inconclusive, T8 omitted browser SameSite behavior, and no candidate has been independently confirmed. Two conditions did not pass the functional gate and therefore have no security result. The exact cause of the Next.js/OIDC failure remains unresolved.

Before drawing stronger conclusions, the next steps are to manually reproduce and classify each T8 candidate, independently review selected candidate-free outcomes, diagnose the Next.js/OIDC failure, and decide whether to repair and rerun the functionally failing conditions as separate post-generation evaluations. A confirmatory study should use multiple independent generations per cell, predefine stopping and retry rules, preserve blinded review where feasible, and report functional completion, test coverage, confirmed findings, and resource measures separately.

## 6. Conclusion

In this pilot, the no-framework application generated with security guidance passed all functional checks and produced no automated security candidates. The corresponding no-framework application without that guidance also passed functionality but produced one unverified Origin/CSRF candidate. These observations do not establish that either condition is safest, and they do not show that the absence of a named framework improves security. The study instead demonstrates why functional acceptance, security evaluation availability, candidate validation, and repeated generations must all be reported before comparing AI-generated application security.

## Reproducibility materials

The experiment plan, full results, functional-test definition, prompts, run order, and harness records are maintained in the project workspace under `.private/framework-security-comparison-luna-01/`. The principal summary is [`../RESULTS.md`](../RESULTS.md), the protocol is [`../PLAN.md`](../PLAN.md), and the functional criteria are [`../evaluation/FUNCTIONAL-TESTS.md`](../evaluation/FUNCTIONAL-TESTS.md). These internal links are workspace references, not public archival identifiers. Before public release, logs and generated artifacts require a secrets and privacy review.
