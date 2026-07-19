# Delivery checklist

## Intake

- Confirm the package contains no more than five related JSON files.
- Confirm intended behavior and target validator/runtime are written down.
- Reject credentials, personal data, regulated data, and unnecessary proprietary code.
- Preserve the original files without silently overwriting them.
- Agree on acceptance checks before repair begins.

## Repair and verification

- Reproduce the reported failure locally.
- Record the validator and version used.
- Make only changes necessary for the agreed behavior.
- Parse every output with `JSON.parse`.
- Run schema validation where applicable.
- Test at least one valid case and one invalid case where applicable.
- Review the diff for accidental semantic changes.
- Scan the delivery package for obvious secret material.

## Delivery

- Deliver corrected files, change report, examples, and verification command.
- State limitations and anything that could not be verified.
- Record actual labor time, correction rounds, and acceptance result.
- Delete local customer material according to the later-approved retention rule.

This checklist does not authorize customer contact, payment collection, production access, or handling sensitive data.

