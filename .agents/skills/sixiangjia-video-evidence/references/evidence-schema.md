# Evidence schema

Store one JSON object per line. Required fields:

- `evidence_id`: stable local identifier.
- `domain`, `subdomain`: controlled coverage labels.
- `atomic_claim`: one source-backed claim.
- `actionable_rule`: the production or evaluation consequence.
- `source_title`, `source_url`, `source_type`, `source_tier`.
- `author_org`, `published_at`, `retrieved_at`.
- `canonical_id`, `content_sha256` when locally archived.
- `platform_model_version`, `region_language`.
- `method_sample_metric`, `limitations`, `conflicts`.
- `applicability_to_sixiangjia`.
- `confidence`: 0–100 evidence-quality score.
- `verification_status`: `candidate`, `accepted`, `quarantined`, `superseded`, or `rejected`.
- `reviewer`, `last_checked_at`, `supersedes`, `superseded_by`, `tags`.

Every hard rule must resolve to accepted evidence and the applicable version/date. Keep direct quotations short and within source limits; prefer faithful paraphrase.

