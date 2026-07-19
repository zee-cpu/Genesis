import { GenesisError } from "./errors.mjs";

const METHODS = ["count", "sum", "average", "ratio", "percentage"];
const OPERATORS = ["gte", "gt", "lte", "lt", "eq"];

function calculationError(code, message, path, correction) {
  return new GenesisError(code, message, { path, correction, escalation: "analyst" });
}

function finite(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw calculationError("METRIC_VALUE_INVALID", `${field} must be a finite number`, `/calculation/${field}`, `Provide ${field} as a JSON number`);
  }
  return value;
}

function compare(value, operator, threshold) {
  if (operator === "gte") return value >= threshold;
  if (operator === "gt") return value > threshold;
  if (operator === "lte") return value <= threshold;
  if (operator === "lt") return value < threshold;
  return value === threshold;
}

export function calculateMetric(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw calculationError("METRIC_CALCULATION_INVALID", "Metric calculation must be an object", "/calculation", "Provide method, numerator, threshold, and operator");
  }
  const allowed = new Set(["method", "numerator", "denominator", "baseline", "threshold", "operator", "unit"]);
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw calculationError("METRIC_CALCULATION_FIELD_UNKNOWN", "Metric calculation contains unsupported fields", `/calculation/${unknown[0]}`, `Remove: ${unknown.join(", ")}`);
  }
  if (!METHODS.includes(input.method)) {
    throw calculationError("METRIC_METHOD_INVALID", "Metric calculation method is invalid", "/calculation/method", `Use one of: ${METHODS.join(", ")}`);
  }
  if (!OPERATORS.includes(input.operator)) {
    throw calculationError("METRIC_OPERATOR_INVALID", "Metric comparison operator is invalid", "/calculation/operator", `Use one of: ${OPERATORS.join(", ")}`);
  }
  const numerator = finite(input.numerator, "numerator");
  const threshold = finite(input.threshold, "threshold");
  const needsDenominator = ["average", "ratio", "percentage"].includes(input.method);
  let denominator = null;
  if (needsDenominator) {
    denominator = finite(input.denominator, "denominator");
    if (denominator === 0) {
      throw calculationError("METRIC_DENOMINATOR_ZERO", "Metric denominator cannot be zero", "/calculation/denominator", "Provide a non-zero denominator");
    }
  } else if (input.denominator !== undefined) {
    throw calculationError("METRIC_DENOMINATOR_UNEXPECTED", `${input.method} does not use a denominator`, "/calculation/denominator", "Remove denominator or use average, ratio, or percentage");
  }
  const baseline = input.baseline === undefined ? null : finite(input.baseline, "baseline");
  const observedValue = input.method === "percentage"
    ? (numerator / denominator) * 100
    : needsDenominator
      ? numerator / denominator
      : numerator;
  return {
    method: input.method,
    numerator,
    denominator,
    baseline,
    threshold,
    operator: input.operator,
    unit: typeof input.unit === "string" && input.unit.trim() ? input.unit.trim() : "count",
    observed_value: observedValue,
    change_from_baseline: baseline === null ? null : observedValue - baseline,
    threshold_met: compare(observedValue, input.operator, threshold),
    calculated_outcome: compare(observedValue, input.operator, threshold) ? "passed" : "failed",
  };
}
