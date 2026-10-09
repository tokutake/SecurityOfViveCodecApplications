# Security Findings in Agent-Generated Web Applications: A Seven-Model Pilot Study

**English research manuscript draft — 10 October 2026**  
**Authors and affiliations:** To be supplied before submission.  
**Evidence status:** Human adjudication of security candidates is pending.

## Abstract

Agentic coding tools can produce complete web applications from natural-language specifications, but successful generation does not establish functional correctness or security. We report a descriptive pilot study of seven application artifacts generated from the same social-network specification using three OpenAI models and four Anthropic models through their respective coding harnesses. Each artifact was generated in a fresh workspace without human follow-up instructions, then evaluated without modifying its source code. We examined authentication, authorization, secret handling, injection, browser behavior, and application-specific permission boundaries. A documentary consolidation of the saved audit reports identified nine core security candidates across four artifacts: two high-impact defects with recorded reproductions and seven additional weaknesses or unresolved candidates. Five separate static-analysis warnings concerned AES-GCM authentication-tag handling. The two high-impact defects occurred in the Claude Haiku 4.5 artifact: unauthenticated file traversal exposing a database and application source, and an unauthenticated request that terminated the server. Generation took 123.82–575.54 seconds; recorded or estimated API-equivalent costs ranged from USD 0.0091 to USD 2.1043. Human confirmation required by the audit protocol remains incomplete, so these counts are not confirmed-vulnerability counts or prevalence estimates. The pilot demonstrates the importance of separating exploit evidence, defensive weaknesses, scanner warnings, functional failures, and resource measurements when evaluating agent-generated applications.

**Keywords:** agentic coding; vibe coding; web application security; vulnerability assessment; reproducibility.

## 1. Introduction

Natural-language programming workflows increasingly delegate application design, implementation, and testing to coding agents. A generated application can satisfy visible functional requirements while violating access-control or confidentiality boundaries. Conversely, an application that fails functional testing can still expose security-relevant behavior before authentication. Measuring security therefore requires examination of the generated artifact rather than acceptance of the agent's completion report.

This study examines a small, controlled corpus of social-network applications generated from an identical functional specification. The application includes ordinary users, administrators, suspended users, and user-owned language-model accounts. Users provide their own external API keys. These features create concrete boundaries for ownership, administration, secret confidentiality, and external service use.

We ask three descriptive research questions:

1. What security candidates, and how many, are documented for each generated artifact?
2. Which findings have recorded exploit reproductions, and which remain weaknesses, warnings, or unresolved hypotheses?
3. What generation time and API-equivalent cost accompanied each artifact?

The unit of observation is a model–harness–date trial. With one artifact per model and one application specification, the study does not establish a model ranking or isolate the causal effect of model choice. Its contribution is an auditable pilot corpus and a transparent account of security findings and evaluation coverage.

## 2. Related Work

Pearce et al. investigated insecure code suggestions from GitHub Copilot across security-relevant scenarios. Their study concerns code contributions rather than complete agent-generated applications; its results motivate artifact-level examination without providing a prevalence estimate for the present corpus. [1]

Deng et al. collected 9,041 open-source applications and audited 200 publicly deployed applications, reporting 1,186 vulnerabilities and at least one vulnerability in 91.0% of the audited sample. Their sampling conditions differ substantially from our locally generated, single-specification corpus, so direct rate comparisons would be inappropriate. [2]

Andročec compared baseline and security-aware prompts across six application specifications, yielding twelve programs. The study reported 51 confirmed findings for baseline prompts and 24 for security-aware prompts, while emphasizing the descriptive nature of the small sample. Our pilot instead holds the functional specification constant across model–harness combinations and does not test an additional security-prompt intervention. [3]

These descriptions are grounded in the retrieved abstracts, not an exhaustive literature review. None of these studies supplies evidence for the security of the artifacts examined here.

## 3. Method

### 3.1 Application specification

SNS-01 specifies a locally executable application using Node.js 24 standard modules, SQLite through `node:sqlite`, and browser HTML, CSS, and JavaScript. External npm dependencies are prohibited. The interface is Japanese. Posts must contain 1–140 Unicode code points, and stored data must survive process restarts.

The specification requires registration, login, logout, a shared timeline, owner-only deletion, administrator deletion and suspension, private API-key management, and multiple user-owned LLM accounts. Each LLM account has a display name, model identifier, and generation instruction. A generation request must use that account's selected model and its owner's key. Other users and administrators must not inspect or use the owner's key. Suspended users and their LLM accounts cannot create posts. Model failures must be surfaced without automatic fallback.

The application uses an OpenRouter-compatible endpoint. Evaluation substitutes a local mock endpoint, dummy keys, and fixed model identifiers `test/model-a` and `test/model-b`. This tests the application's key-selection and request paths without making real provider calls. It does not establish compatibility with the production service. The specification states permission boundaries but does not prescribe particular encryption, password-hashing, or CSRF implementations.

### 3.2 Trials and generation conditions

Seven artifact-producing trials were conducted on 8 October 2026 in Japan Standard Time. Their saved UTC timestamps begin on 7 October. The initial five-model pilot comprised GPT-6.1 Sol, GPT-6 Luna, Claude Opus 5.5, Claude Sonnet 5.5, and Claude Haiku 4.5. GPT-6 Astra and Claude Haiku 5.5 were subsequently added; their artifacts supplement rather than replace the original trials.

All seven trials used the same specification, whose saved SHA-256 is `c78a6f00ba08c3a57165680a44eebab5132e25ac89023bb2311c1b9fce0a1529`. Each trial began with a fresh conversation and workspace, disabled automatic memory, permitted no additional agents, had a 600-second timeout, and received zero human follow-up instructions. Agents could revise their implementations during generation. Evaluation findings were not returned to them afterward.

OpenAI trials used Codex CLI 0.160.1. The saved metadata identifies Claude Code 2.1.292 for Opus, Sonnet, and Haiku 4.5, and 2.1.293 for Haiku 5.5. Earlier prose summaries identify 2.1.289 for the initial Claude runs. We report the per-trial metadata values while retaining this unresolved version discrepancy as a reproducibility limitation. Reasoning effort was `medium` except for the two Haiku trials, which used their model defaults.

Isolation was local rather than container- or VM-based. Codex used temporary state containing an authentication copy; Claude used existing OS Keychain authentication with safe-mode and sandbox settings. Cross-trial reading was discouraged or restricted, but complete read isolation was not independently demonstrated. During generation, local socket listening was denied. Agents spent some of their time adapting tests to that restriction, so elapsed time measures this workflow rather than unrestricted implementation speed.

Two Sol preparation failures and one Haiku 5.5 authentication failure produced no application artifacts. They remain in the run ledger but are not security observations. All seven artifact-producing CLI runs exited normally within the timeout. Normal CLI termination is distinguished from application functionality.

### 3.3 Functional and security evaluation

Functional evaluation exercised registration, authentication, posts, API-key operations, LLM-account ownership, mock-provider calls, administrative actions, suspension, and persistence. Checks were adapted to each application's routes, and some used generated tests. Test totals therefore do not constitute a uniform quality score.

The security checklist contains C1–C23, covering authentication and sessions, authorization, API-key handling, input/output processing, external calls, and configuration. Attack perspectives include an unauthenticated user, two ordinary users, a suspended user, and an administrator. Dynamic evaluation ran copies of the artifacts and did not repair generated source code. Browser checks were recorded for stored XSS where the interface could be exercised.

Static analysis used Semgrep 1.180.0 with JavaScript, Node.js, XSS, SQL-injection, and command-injection rule sets, and Gitleaks 8.30.1 for repository history and the pilot directory. Targeted code reading complemented these tools. Scanner coverage is bounded by the selected rule sets, and code reading was not an exhaustive review of every line.

The actual initial audit was performed directly by Claude. The planned cross-family auditor assignment was not used, and blinded evaluation is not established by the saved record. The protocol reserves final confirmation for a human reviewing reproductions and evidence. That step, and the planned random rechecking of negative results, have not been documented as completed. We therefore report candidates rather than human-confirmed vulnerabilities.

### 3.4 Finding counts and evidence categories

The manuscript consolidates existing reports; it does not claim a new security audit. We count artifact-specific root causes, combining manifestations that share a cause. For example, traversal exposing both source and a database is one finding, and plaintext key storage is not counted again as a separate encryption omission.

Three categories are kept separate:

- **Reproduced high-impact candidates:** distinct defects with exploitation documented in the saved audit reports, but pending human adjudication.
- **Other candidates:** observed defensive weaknesses or unresolved security hypotheses, without assuming an exploitable confidentiality, integrity, or availability violation in every case.
- **Scanner warnings:** separately reported static-analysis alerts whose exploitability has not been established.

The core candidate count is the sum of the first two categories. It is deliberately not labeled the number of confirmed vulnerabilities. Missing human adjudication is recorded as *pending*, not zero. Severity descriptions are qualitative; no CVSS scores or final High/Critical classifications are assigned.

The nine core entries derive from the original audit summary, expanding shared findings into artifact-specific entries. That summary is not distributed with the public artifact. Additional brief code-reading observations for Haiku 4.5—unsalted SHA-256 passwords, plaintext keys, partial key logging, absent CSRF controls and throttling, and unbounded LLM-account fields—are not promoted to separate entries without individual triage. Thus nine is a transparent reporting count, not an exhaustive count of all possible defects. The machine-readable ledger is `findings.csv`.

### 3.5 Generation time and API-equivalent cost

Generation time is the runner's `elapsed_seconds`, encompassing the coding session and its tool activity. Subsequent functional testing and security auditing are excluded. No inference-time-only measurement or total engineering-cost measurement is available.

Actual per-trial monetary charges are unavailable because the generation runs used existing subscriptions. We report API-equivalent reference amounts. For Claude, these are the saved CLI `total_cost_usd` values. For OpenAI, amounts are calculated from reported tokens using Standard short-context rates checked on 10 October 2026: USD per million uncached input/cached input/output tokens of 2/0.10/10 for Sol, 0.10/0.01/0.50 for Luna, and 10/1/50 for Astra. [4]

For OpenAI, cached input is included in total input. The calculation is:

`API-equivalent USD = ((input − cached input) × input rate + cached input × cached rate + output × output rate) / 1,000,000`.

Reported cache writes are zero. Reported reasoning-token counts are not added again to output. Request-level pricing-tier and long-context eligibility were not independently verified, so OpenAI amounts remain estimates.

Claude CLI amounts are historical reference values, not a repricing of every request against the current rate card. At the documentation-check date, applying current short-prompt rates and reported one-hour cache writes to Sonnet's aggregate usage gives USD 0.5450934, whereas the saved CLI reports USD 0.6053248. For Haiku 5.5, an all-short-prompt calculation gives USD 0.08244647 rather than the recorded USD 0.12442035; its current rate card also distinguishes prompts above 100,000 tokens, which cannot be resolved from aggregate totals alone. We retain the recorded values and disclose these discrepancies rather than overwrite the evidence. [5] The table consequently reports mixed-provenance cost references, suitable for descriptive context but not precise economic rankings. It contains no subscription-capacity extrapolation.

## 4. Results

### 4.1 Candidate counts, generation time, and cost

**Table 1. Artifact-level results.** Core counts include reproduced candidates and other candidates; scanner warnings are separate. Human-confirmed vulnerability counts remain pending for every artifact.

| Model | Trial suffix | Core candidates | Reproduced high-impact subset | Other candidates | Scanner warnings | Generation time (s) | API-equivalent USD |
|---|---|---:|---:|---:|---:|---:|---:|
| GPT-6.1 Sol | sol-003 | 1 | 0 | 1 | 1 | 433.62 | 0.2388 |
| GPT-6 Luna | luna-001 | 4 | 0 | 4 | 0 | 123.82 | 0.0091 |
| Claude Opus 5.5 | opus-001 | 0 | 0 | 0 | 1 | 395.60 | 1.5958 |
| Claude Sonnet 5.5 | sonnet-001 | 0 | 0 | 0 | 1 | 575.54 | 0.6053 |
| Claude Haiku 4.5 | haiku-001 | 2 | 2 | 0 | 0 | 397.96 | 0.5287 |
| GPT-6 Astra | astra-001 | 0 | 0 | 0 | 1 | 549.61 | 2.1043 |
| Claude Haiku 5.5 | haiku-003 | 2 | 0 | 2 | 1 | 340.36 | 0.1244 |
| **Total** | **7 artifacts** | **9** | **2** | **7** | **5** | **2,816.51** | **5.2064** |

Four artifacts have at least one core candidate. This is a corpus description, not a confirmed-vulnerability prevalence estimate. The five scanner warnings are additional ledger entries, bringing the categorized reporting total to fourteen; that total must not be interpreted as fourteen exploitable vulnerabilities. An artifact with zero core candidates has no such finding in the specified reporting scope, not demonstrated security.

### 4.2 High-impact defects with recorded reproductions

Both high-impact candidates occur in Haiku 4.5. First, the static-file handler accepts paths under `/public/` without constraining traversal components. The audit reports that unauthenticated requests for `/public/../server.js` and `/public/../data.db` returned HTTP 200. The database response began with the SQLite file signature. The audit describes password hashes and plaintext provider-key storage, but the evaluated database contained test data; no real-user compromise was observed. The source and database responses are manifestations of the same file-disclosure cause.

Second, the API dispatcher destructures the return value of an asynchronous handler without awaiting it. An unauthenticated registration request triggers a `TypeError` and terminates the server. This is both a functional blocker and an availability defect with a recorded unauthenticated trigger. Counting it once avoids inflating results through the several affected endpoints.

These defects illustrate why nonfunctional applications should remain eligible for security examination. Authentication failure prevented much of the planned dynamic evaluation, but did not prevent examination of publicly reachable file-serving and registration behavior.

### 4.3 Other candidates and scanner findings

**Table 2. Core finding ledger, grouped by cause and evidence.** Every entry awaits human adjudication.

| Finding IDs | Artifact(s) | Count | Observation and interpretation |
|---|---|---:|---|
| F01 | Haiku 4.5 | 1 | Unauthenticated file traversal; source/database disclosure reproduction recorded |
| F02 | Haiku 4.5 | 1 | Unauthenticated server termination; reproduction recorded |
| F03, F04, F08 | Sol, Luna, Haiku 5.5 | 3 | No HTTP 429 after 25, 25, and 12 failed logins, respectively; limited evidence of missing throttling |
| F05 | Luna | 1 | API key found in plaintext SQLite storage; at-rest confidentiality weakness, not an explicit encryption-specification violation |
| F06, F09 | Luna, Haiku 5.5 | 2 | Invalid Origin accepted; browser-exploitable CSRF not established |
| F07 | Luna | 1 | Malformed JSON exposes parser error text; limited information disclosure |
| **Total core candidates** | | **9** | **2 reproduced high-impact candidates plus 7 other candidates** |

The CSRF candidates need particular care. Luna accepted a `text/plain` request with an invalid Origin and relied on a `SameSite=Strict` cookie. Haiku 5.5 accepted an invalid Origin but required JSON content type. Direct HTTP requests do not reproduce browser cookie and preflight behavior. These observations justify review but do not establish successful cross-site exploitation.

Semgrep produced five warnings of one rule family: AES-GCM decryption without an explicitly specified authentication-tag length. These occur in Sol, Opus, Sonnet, Astra, and Haiku 5.5. The saved review considered their impact low because encryption created 16-byte tags and alteration would require database-write access. They remain scanner warnings, not demonstrated cryptographic exploits.

Gitleaks reported no findings in history. The directory scan reported nineteen hits that the audit classified as false positives associated with hashes and dummy-key material. None is included in the candidate counts.

### 4.4 Functionality and evaluation coverage

**Table 3. Coverage limitations remain visible alongside finding counts.**

| Artifact | Recorded functional outcome | Security evaluation limitation |
|---|---|---|
| Sol | Major HTTP checks passed | No reported missing item in the recorded scope |
| Luna | Major HTTP checks passed | CSRF browser exploit not established |
| Opus | Major HTTP checks passed | No reported missing item in the recorded scope |
| Sonnet | API checks passed; later browser testing found timeline failure | Browser stored-XSS behavior could not be evaluated |
| Haiku 4.5 | Registration crashes server | Most authenticated checks and browser XSS unavailable |
| Astra | Major HTTP checks passed | No reported missing item in the recorded scope |
| Haiku 5.5 | Major HTTP checks passed | CSRF browser exploit not established |

Six artifacts passed the recorded major API/HTTP functional checks; Haiku 4.5 did not. Sonnet's later-discovered browser defect prevents equating this result with six fully functioning end-to-end applications. Its DOM helper attempts to assign to a getter-only `dataset` property, preventing timeline rendering after login. This is recorded as a functional defect rather than a security finding.

Browser checks did not execute the tested stored-XSS payloads in Sol, Luna, Opus, Haiku 5.5, or Astra. Sonnet was unassessable because of its UI failure, and Haiku 4.5 was not tested because the server could not sustain the required workflow. Negative observations apply only to the payloads and paths examined.

## 5. Discussion

The strongest security evidence is concentrated in one artifact, while other findings largely concern defensive controls and unresolved exploitability. Treating all alerts as equivalent would obscure this distinction. The useful primary result is the per-artifact ledger, supported by reproductions and coverage information, rather than the total number of scanner hits or passed assertions.

The Haiku 4.5 example shows that functional failure and security exposure can coexist. Sonnet shows the opposite evaluation problem: passing API checks can coexist with a browser defect that prevents a planned security test. Excluding either artifact would introduce a misleading selection of only successfully testable applications.

Time and reference cost are supplementary measurements. Luna was the fastest and had the lowest estimated API-equivalent amount, but its artifact also had four core candidates. Astra had the highest estimated amount and no core candidate in the recorded scope, but still had a scanner warning. These observations cannot establish that greater spending or longer generation yields better security. There is one artifact per model, costs have different reporting bases, and tool restrictions contributed to elapsed time.

Likewise, the two Haiku generations do not constitute a controlled causal test of a model upgrade: model generation, harness version, and default reasoning behavior differ. The later artifact's functional improvement does not erase the earlier failures or establish a general security improvement.

## 6. Threats to Validity

**Sampling and external validity.** The corpus contains seven artifacts from one Japanese-language specification, with one artifact per model. There are no repeated trials, human-written baseline, or randomized prompt conditions. We do not compute model-specific prevalence estimates, significance tests, or security rankings.

**Audit completeness and confirmation.** The initial auditor was Claude, with no demonstrated blinding or independent human adjudication. The planned rechecking of negative results is pending. The manuscript's counts summarize documented candidates; exploitability and severity remain open for some entries. Haiku 4.5's authenticated surface and Sonnet's browser behavior were incompletely assessed. A zero count is not evidence of an absence of vulnerabilities.

**Measurement comparability.** Common checklist labels do not imply equal numbers of assertions or uniform implementation of every test. Some functional checks were generated by the same agent that produced the application. Missing throttling after a limited number of requests is weaker evidence than a complete review of deployed authentication defenses. Browser-specific CSRF conditions were not reproduced.

**Environment and harness effects.** Model and harness family are confounded. Local isolation was not independently verified. Socket restrictions consumed generation time and influenced testing strategies. Saved Claude version metadata and earlier prose disagree. The reference time measurements exclude evaluation and cannot represent total development effort.

**Cost interpretation.** API-equivalent amounts are estimates or CLI references, not invoices. Cached context can dominate token counts, output accounting varies by provider, current prices need not reproduce historical CLI calculations, and request-level modifiers have not been fully verified. Resource amounts do not imply a budget of usable tokens or a confirmed security return on spending.

**Deployment scope.** All evaluation used local applications, mock external calls, and dummy credentials. No public deployment, production TLS configuration, actual provider integration, or real-user impact was evaluated. The audit's qualitative impact descriptions are not formal severity scores.

## 7. Conclusion

This pilot produced seven web-application artifacts from one shared specification and documented nine core security candidates, including two high-impact defects with recorded unauthenticated reproductions, plus five separate scanner warnings. Generation time and API-equivalent cost provide practical context, but do not establish security rankings. The evidence supports reporting candidate counts with explicit confirmation status and preserving functional failures and unassessable checks. Human adjudication and repeated trials are required before estimating confirmed-vulnerability prevalence or comparing models statistically.

## Data Availability and Research Ethics

The public artifact contains this manuscript, aggregate measurement and finding tables, generated application source code, and the per-trial prompts. Raw generation streams, runtime metadata, authentication-related records, databases, execution and audit scripts, and original audit reports are not distributed. They were removed from the publication working tree to limit disclosure of personal environment information. The paper's numerical measurements were extracted and checked before that removal. A public archival URL has not been assigned.

The companion `findings.csv` records the fourteen categorized entries and their evidence status; `results.csv` records the seven artifact-level measurements. Each artifact-producing trial is published under `pilot/runs/<trial_id>/app`, with its specification in `prompt.md`. Three preparation failures retain prompts but have no application artifact. The public source permits independent reassessment of code and behavior, but the original time, token, and CLI-cost measurements cannot be independently reconstructed from this release. The non-distribution of raw audit evidence also limits independent verification of the reported historical reproductions. Application copies were evaluated using dummy credentials and local mock services; no real keys, production services, or third-party applications were attacked. These statements describe the evaluation inputs, not a guarantee that the generation harness could never access its own authentication state.

Before submission, the human reviewer should adjudicate the ledger through fresh reproductions, finish or explicitly waive the planned negative-result sampling, and preserve those decisions with evidence. Final author details, venue formatting, a public artifact archive, and resolution of the harness-version discrepancy are also outstanding. The present manuscript remains a pilot report with pending confirmation.

## References

1. Hammond Pearce, Baleegh Ahmad, Benjamin Tan, Brendan Dolan-Gavitt, and Ramesh Karri. *Asleep at the Keyboard? Assessing the Security of GitHub Copilot's Code Contributions.* arXiv:2108.09293v3. [Versioned source](https://arxiv.org/abs/2108.09293v3).
2. Junquan Deng, Zhiyu Fan, and Ruijie Meng. *Understanding the (In)Security of Vibe-Coded Applications.* arXiv:2606.23130v4, 2026. [Versioned source](https://arxiv.org/abs/2606.23130v4).
3. Darko Andročec. *Vibe Coding and Web Application Security: A Twin-Prompt Study.* arXiv:2608.20963v1, 2026. [Versioned source](https://arxiv.org/abs/2608.20963v1).
4. OpenAI. *API Pricing.* Checked 10 October 2026. [Official rate card](https://developers.openai.com/api/docs/pricing).
5. Anthropic. *Claude API Pricing.* Checked 10 October 2026. [Official rate card](https://platform.claude.com/docs/en/about-claude/pricing).

## Appendix A. Exact Model Identifiers and Token Accounting

**Table A1. Saved identifiers and provider-reported token categories.** Codex's input totals have been split into uncached and cached portions. Claude cache-creation tokens are a distinct category. Reasoning counts are not added to output again.

| Model ID | Uncached input | Cache creation | Cache read | Output |
|---|---:|---:|---:|---:|
| `gpt-6.1-sol` | 23,444 | 0 | 343,424 | 15,758 |
| `gpt-6-luna` | 23,833 | 0 | 164,096 | 10,159 |
| `claude-opus-5-5` | 44 | 61,496 | 887,242 | 46,309 |
| `claude-sonnet-5-5` | 40 | 42,768 | 602,314 | 31,371 |
| `claude-haiku-4-5-20251001` | 345 | 62,599 | 1,778,152 | 45,072 |
| `gpt-6-astra` | 44,581 | 0 | 514,560 | 22,878 |
| `claude-haiku-5-5` | 46 | 106,377 | 1,629,247 | 89,748 |

Repeated cached context contributes to these totals; they are not counts of unique source text or final generated code. Claude's saved usage reports mark the cache creation as one-hour TTL. The full trial identifiers are `sns01-` followed by the suffixes in Table 1.
