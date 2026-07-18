import readline from "node:readline/promises";

function normalizeChoices(choices = []) {
  return choices.map((choice) => (
    typeof choice === "string"
      ? { label: choice, value: choice }
      : choice
  ));
}

export function createPrompter({ input, output }) {
  const interface_ = readline.createInterface({
    input,
    output,
  });

  async function ask(question) {
    return interface_.question(question);
  }

  async function choose(question, choices) {
    const normalized = normalizeChoices(choices);
    const lines = normalized.map((choice, index) => `  ${index + 1}. ${choice.label}`).join("\n");
    const answer = (await ask(`${question}\n${lines}\n> `)).trim();
    if (!answer) {
      return normalized[0]?.value;
    }

    const numeric = Number.parseInt(answer, 10);
    if (Number.isInteger(numeric) && numeric >= 1 && numeric <= normalized.length) {
      return normalized[numeric - 1].value;
    }

    const direct = normalized.find((choice) => (
      choice.value === answer || choice.label === answer
    ));
    return direct?.value ?? normalized[0]?.value;
  }

  async function confirm(question) {
    const answer = (await ask(question)).trim().toLowerCase();
    return ["y", "yes", "true", "1"].includes(answer);
  }

  async function close() {
    await interface_.close();
  }

  return {
    ask,
    choose,
    confirm,
    close,
  };
}
