# OpenAI-Compatible API on Cloudflare Workers AI

## Overview

This implementation provides an OpenAI-compatible API deployed on Cloudflare Workers AI. It enables existing tools, SDKs, and automation platforms to interact with Workers AI models through familiar API interfaces.

The design supports experimentation, migration, and cost-managed workloads while maintaining compatibility with established OpenAI client integrations.

---

## Purpose

Many production workloads can achieve suitable outcomes using smaller or alternative models. Systems built around the OpenAI API can make evaluating these options difficult when integrations depend on a specific interface.

This project exposes OpenAI-compatible HTTP endpoints through Cloudflare Workers and delegates inference to Workers AI models. It provides a consistent integration layer for evaluating and operating alternative models.

---

## Scope

The implementation prioritises API compatibility over full behavioural parity with OpenAI services. It supports development workflows, internal platforms, automation, and controlled production deployments where Workers AI capabilities meet the workload requirements.

Model support and functionality depend on current Workers AI availability and account access.

---

## Features

| Feature    | Capabilities                                                            |
| ---------- | ----------------------------------------------------------------------- |
| Text       | Single-prompt text completions with streaming.                          |
| Chat       | Chat completions with native streaming and model-supported tool calls.  |
| Responses  | Non-streaming GPT-OSS responses through the native compatible endpoint. |
| Audio      | Whisper transcription, direct English translation, and subtitle output. |
| Speech     | Speech generation using supported Aura models and speaker voices.       |
| Embeddings | Batched text embeddings with float or base64 output.                    |
| Images     | Image generation with URL or base64 output and R2-backed retrieval.     |
| Models     | Model discovery, configured aliases, and individual model retrieval.    |

Audio translation uses Whisper's translation task directly. Chat, embeddings, and Responses use Cloudflare's native OpenAI-compatible endpoints where supported.

---

## Compatibility

- Both versioned (`/v1/...`) and unversioned routes are supported.
- Streaming responses follow OpenAI Server-Sent Events conventions.
- Model identifiers can be mapped to Workers AI models through configuration.
- Requests are validated, and errors use a consistent OpenAI-style structure.
- Responses supports the Workers AI GPT-OSS models with streaming disabled.

Compatibility depends on the selected model and the features used by each client. OpenAI-specific services and unsupported model capabilities are outside the project's scope.

---

## Architecture

- Cloudflare Workers handle routing, authentication, validation, and API compatibility.
- Workers AI performs inference through native endpoints and the AI binding.
- R2 stores generated images when URL output is requested.
- Secrets are supplied through Cloudflare environment bindings.

---

## Deployment

This repository is designed for deployment using Wrangler.

1. Configure `wrangler.toml` for your deployment.
2. Bind Workers AI, and add R2 when image URL output is required.
3. Set `ACCESS_TOKEN` and `CLOUDFLARE_API_TOKEN` using `wrangler secret put`.
4. Configure `CLOUDFLARE_ACCOUNT_ID` and any optional model mappings.
5. Deploy to your Cloudflare account.

The Cloudflare account ID and API token are required for native API endpoints and model discovery. Domain routing and custom hostnames must be configured for each deployment.

---

## Usage

- Development and testing of OpenAI-compatible clients
- Workflow engines and automation platforms
- Cost-sensitive AI workloads
- Edge-based inference gateways
- Controlled production deployments

---

## Limitations

Model availability, optional parameters, and token accounting depend on Workers AI. The implementation supports a defined set of OpenAI-style APIs, with explicit errors for unsupported adapter options.

Persistent conversation storage, background responses, OpenAI-hosted tools, and Realtime sessions are not implemented. Generated image URLs remain publicly accessible until the stored objects are removed.

Evaluate compatibility and model behaviour against the requirements of your workload.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Support

- [LinkedIn](https://www.linkedin.com/in/rubixvi/)
- [Rubix Studios](https://rubixstudios.com.au)

## Author

Rubix Studios  
[https://rubixstudios.com.au](https://rubixstudios.com.au)
