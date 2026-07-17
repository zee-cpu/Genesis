const SUGGESTIONS = Object.freeze({
  validation_methods: Object.freeze([
    "Customer interviews",
    "Preorders or letters of intent",
    "Concierge pilot",
    "Landing-page demand test",
  ]),
});

export function suggestionsFor(topic) {
  const suggestions = Object.hasOwn(SUGGESTIONS, topic) ? SUGGESTIONS[topic] : [];
  return Object.freeze([...suggestions]);
}
