# Usage and Cost

Record when available:

- input tokens;
- output tokens;
- cached input tokens;
- total tokens;
- duration;
- status;
- harness;
- model.

Cost is explicitly **estimated** unless a trusted billing signal is available.

```text
estimated_cost =
  input_tokens / 1,000,000 * input_rate
  + output_tokens / 1,000,000 * output_rate
```

Do not claim that a local estimate equals the provider's actual bill.
