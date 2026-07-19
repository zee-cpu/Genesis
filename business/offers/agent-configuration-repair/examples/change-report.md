# Example change report

Example only — no customer evidence is represented.

- Changed `required` from a string to the JSON Schema-required array.
- Declared JSON Schema Draft 2020-12 explicitly.
- Rejected undeclared properties to make the interface predictable.
- Prevented an empty `city` value.
- Replaced country-code length checks with an uppercase two-letter pattern.

Verification cases:

- Valid: `{ "city": "Dubai", "country_code": "AE" }`
- Invalid: `{ "country_code": "AE" }` because `city` is required.
- Invalid: `{ "city": "Dubai", "country_code": "uae" }` because the country code must be two uppercase letters.

Run from the repository root:

```bash
node business/offers/agent-configuration-repair/verify-example.mjs
```
