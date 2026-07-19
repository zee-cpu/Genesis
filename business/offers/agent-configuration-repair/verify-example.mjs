import assert from "node:assert/strict";
import fs from "node:fs";

import Ajv2020 from "ajv/dist/2020.js";

const tool = JSON.parse(fs.readFileSync(new URL("./examples/after.weather-tool.json", import.meta.url), "utf8"));
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(tool.parameters);

assert.equal(validate({ city: "Dubai", country_code: "AE" }), true, JSON.stringify(validate.errors));
assert.equal(validate({ country_code: "AE" }), false, "A payload without city must fail");
assert.equal(validate({ city: "Dubai", country_code: "uae" }), false, "An invalid country code must fail");

console.log("Example verified: valid case passed and invalid cases were rejected.");
