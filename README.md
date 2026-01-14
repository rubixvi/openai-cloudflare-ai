# OpenAI-Compatible API on Cloudflare Workers AI

## Overview

This implementation delivers a pragmatic, OpenAI-compatible API surface deployed on Cloudflare Workers AI. It enables existing tools, SDKs, and automation platforms to interact with Workers AI models without requiring application-level refactoring.

The design objective is to support experimentation, migration paths, and cost-managed workloads by maintaining alignment with established OpenAI client integrations while allowing the use of smaller or alternative models.

---

## Purpose

The project addresses a growing operational reality where many production use cases do not require premium, large-scale language models to achieve acceptable outcomes. Despite this, many systems remain tightly coupled to the OpenAI API interface, which creates friction when evaluating alternative providers.

This solution resolves that constraint by supporting the following outcomes:

- Exposing OpenAI-compatible HTTP endpoints
- Operating entirely within Cloudflare Workers
- Delegating inference to Workers AI models
- Preserving upstream client compatibility

Cloudflare Workers provide a globally distributed execution layer with low-latency characteristics. This makes the platform suitable for API mediation and AI request routing while maintaining predictable operational behaviour.

---

## Scope

The implementation prioritises API compatibility rather than full behavioural parity with OpenAI services. It is appropriate for development workflows, testing environments, internal platforms, and limited production scenarios where strict equivalence is not a regulatory or contractual requirement.

Model support and capabilities evolve in line with Workers AI availability. Functionality should be evaluated against current Workers AI constraints before inclusion in critical execution paths.

---

## Supported APIs

The following OpenAI-style endpoints are implemented or partially implemented using Workers AI models.

### Text and Chat

- Completions
- Chat Completions
- Responses (modern OpenAI API)

### Audio

- Audio Transcription
- Audio Translation

Translation is performed by combining speech recognition, language detection, and translation models available on Workers AI.

### Embeddings

- Text Embeddings

### Images

- Image Generation
- Image Retrieval via R2-backed storage

---

## Compatibility

- Endpoints are compatible with common OpenAI SDKs and tools.
- Both versioned (`/v1/...`) and unversioned routes are supported where applicable.
- Streaming responses follow OpenAI Server-Sent Events conventions.
- Model identifiers can be mapped via configuration to underlying Workers AI models.

This project does not aim to replicate OpenAI-specific features that are not supported by Workers AI.

---

## Architecture

- Cloudflare Workers handle routing, authentication, and response shaping
- Workers AI performs inference
- R2 is used for generated image storage and retrieval
- Secrets are managed via Cloudflare environment bindings
- No secrets are stored in source control

---

## Deployment

This repository is designed to be deployed using Wrangler.

High-level steps:

1. Configure `wrangler.toml` for your environment
2. Bind required resources such as Workers AI and R2
3. Set required secrets using `wrangler secret put`
4. Deploy to your Cloudflare account

Domain routing and custom hostnames are intentionally excluded from the public configuration and must be set up per deployment.

---

## Intended Use Cases

- Development and testing of OpenAI-compatible clients
- Automation platforms such as workflow engines and orchestration tools
- Cost-sensitive AI workloads
- Regional or edge-based inference gateways
- Controlled production environments

---

## Limitations

- Model availability and behavior depend on Workers AI
- Token accounting may differ from OpenAI
- Not all OpenAI features are supported
- API behavior may change as Workers AI evolves

Users should evaluate suitability for their specific workload.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

For support or inquiries:

- LinkedIn: [rubixvi](https://www.linkedin.com/in/rubixvi/)
- Website: [Rubix Studios](https://rubixstudios.com.au)

## Author

Rubix Studios Pty. Ltd.  
[https://rubixstudios.com.au](https://rubixstudios.com.au)
