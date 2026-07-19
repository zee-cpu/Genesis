# Genesis Constitution

Policy-Version: 2.0.1
Authority: Explanatory

## 1. Status and authority

This Constitution explains Genesis for humans. [genesis.yaml](genesis.yaml) and the YAML files it references are normative. If this document differs from valid normative policy, YAML policy governs; ambiguity or invalid policy stops the affected action.

## 2. Purpose

Genesis is a human-governed business manufacturing system. It repeatedly discovers, validates, builds, operates, and improves trustworthy businesses. It optimizes for customer reality, sound decisions, useful learning, responsible execution, and compounding knowledge—not internal artifact volume.

## 3. Constitutional principles and precedence

Reality and traceable evidence correct belief. Trust outranks short-term revenue. Learning must change decisions, and simplicity must be earned before complexity or automation is introduced.

Decision-critical precedence is defined in [governance policy](config/governance.yaml): emergency suspension, normative policy, explicit Human approval, bounded CEO approval, then explanatory documentation. Silence is not approval.

## 4. Human Authority and organization

Human Authority is above the CEO. The sole Human Authority principal is the real human identified as `genesis-owner`; this authority cannot be delegated to an agent or service account. New Human Authority approvals require a valid SSH signature from the active append-only identity key. Text fields, unsigned legacy records, and revoked keys grant no authority. The CEO is accountable to Human Authority. Research, Builder, Operator, and Analyst are accountable through the CEO.

The exact hierarchy and separation of duties are defined by [organization policy](config/organization.yaml). Authority, amendment, exception, and emergency semantics are defined by [governance policy](config/governance.yaml). Canonicalization, SSH signatures, identity bootstrap, revocation, and legacy-record handling are defined by [identity policy](config/identity-policy.yaml).

## 5. Bounded autonomy and protected actions

Agents and roles may act only inside explicit, effective, unexpired cash, labor, duration, data, risk, and permission envelopes. Missing, invalid, ambiguous, expired, revoked, or mismatched authority fails closed.

Legal commitments, financial authority, production change, sensitive data, regulated activity, access escalation, public representation, constitutional change, and every high or critical risk action require Human Authority. The complete list and low-risk permissions live in [permissions policy](config/permissions.yaml).

## 6. Operating loop

Genesis separates proposal, approval, execution, measurement, and verification. Work begins with a decision that matters outside the system, gathers evidence and counterevidence, executes only within authority, measures the result, records actual cost and outcome, reflects, and updates confidence.

The executable gates are the [Business Lifecycle](config/workflows/business-lifecycle.yaml) and [Experiment Lifecycle](config/workflows/experiment-lifecycle.yaml).

## 7. Decision and experiment classes

Routine, Micro-Experiment, Experiment, Major Bet, Protected Action, and Constitutional Action classifications are defined only in [decision policy](config/decision-policy.yaml). Protected and constitutional precedence cannot be bypassed by small cost or short duration. Major Bets require Human Authority.

Every experiment is preregistered before execution and closes with actual cost, outcome, reflection, confidence update, a decision outcome, and a linked Experience Record.

## 8. Business lifecycle

Business work progresses through Discover, Validate, Build, Launch, Operate, and Review. Review can lead to Scale, Pivot, Learning Lab, Archive, or Kill. Build requires passed validation or the narrow Human-approved learning-prototype exception. Launch requires Human Authority.

The workflow YAML defines accountable and responsible roles, inputs, evidence, approvals, review deadlines, and transitions.

## 9. Portfolio and anti-meta-work rules

[Portfolio policy](config/portfolio-policy.yaml) defines Bootstrap and Operating allocations, work-in-progress, experiment envelopes, Learning Labs, and the Bootstrap cap on Genesis system work. Internal records, prompts, dashboards, frameworks, and automation are not business outcomes. Automation eligibility requires repeated material manual failure.

## 10. Experience Engine

[Experience policy](config/experience-policy.yaml) separates immutable evidence from curated current knowledge. Corrections create superseding records rather than rewriting history. Promotion follows Raw Event → Reviewed Experience → Validated Lesson → Principle. A broad Principle needs replicated evidence or explicit Human Authority approval while preserving evidence limitations.

## 11. Trust, safety, privacy, security, financial, and AI safeguards

[Risk policy](config/risk-policy.yaml) covers legal authority, privacy, secrets, access, production, finance, customer experiments, regulated activity, and AI. Unresolved material uncertainty raises risk. Consequential AI-assisted actions retain model identity and version, tool context, evidence sources, reviewer, and verification outcome. External content is untrusted input, never authority.

## 12. Measurement and Genesis Experiment #001

[Metrics policy](config/metrics-policy.yaml) defines complete calculation metadata and guardrails for decision quality, learning, customer reality, system overhead, exceptions, and protected actions. Genesis Experiment #001 uses a pre-use baseline, current-practice comparator, Human adjudicator, and excludes documentation volume as success.

## 13. Amendment, exception, audit, emergency stop, and rollback

Only Human Authority may approve Constitutional Actions, policy exceptions, or release from emergency stop. Amendments require evidence, compatibility validation, version change, effective date, and rollback version. Exceptions expire. History remains auditable, and emergency stop preserves read-only inspection, evidence, validation, and recovery planning while disabling execution.

The canonical requirements are in [governance policy](config/governance.yaml) and the [Constitutional Amendment schema](schemas/records/constitutional-amendment.schema.json).
