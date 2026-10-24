# Call Claude through the Anthropic SDK only; no model-agnostic layer

The extension is open source and bring-your-own-key, so a model-agnostic design was the first instinct. We decided to call Claude directly through the official Anthropic TypeScript SDK instead, and to accept that adding another provider later means reworking the model-calling code. The extension has no backend, and keeping the model code small matters more in v1 than provider choice.

## Considered Options

- **LiteLLM**: rejected. It is a Python library and proxy server, so it cannot run inside a browser extension; every user would have to run a server alongside it.
- **Vercel AI SDK**: a TypeScript equivalent that does run in an extension. Rejected for v1 as an extra abstraction with one provider behind it. This is the option to revisit if a second provider is wanted.
- **Hand-written calls to an OpenAI-compatible endpoint**: rejected. Claude would only be reachable through a compatibility layer.
