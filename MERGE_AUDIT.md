# Merge Audit: HuggingClaw + Hugging Face JupyterLab Template

This audit tracks what was compared after cloning `https://github.com/anurag162008/HuggingClaw.git` and checking it against the Hugging Face JupyterLab Space template content used for the terminal.

## Source Coverage

| Source | Covered In This Repo | Notes |
| :--- | :--- | :--- |
| `anurag162008/HuggingClaw` runtime scripts | ✅ Yes | `start.sh`, `health-server.js`, Cloudflare helpers, sync, iframe fix, WhatsApp guardian, and key rotator are present. |
| `anurag162008/HuggingClaw` project metadata | ✅ Restored | `.env.example`, `CHANGELOG.md`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `LICENSE`, and `SECURITY.md` are included. |
| Hugging Face JupyterLab template login UX | ✅ Added | `login.html` keeps the HF logo, token form, and default-token guidance while labeling this merged terminal. |
| Hugging Face JupyterLab pinned packages | ✅ Added | Docker installs `jupyterlab==4.5.7`, `tornado==6.5.5`, and `ipywidgets==8.1.8`. |
| Hugging Face LFS defaults | ✅ Added | `.gitattributes` tracks common model/data artifacts through Git LFS. |
| GitHub-to-HF workflow from upstream | ⚠️ Intentionally not copied | The upstream workflow targets a specific HF Space path and could push to the wrong Space if copied blindly. Add a repo-specific workflow only after confirming the target Space name and `HF_TOKEN` secret. |

## Public Routing Contract

HF Spaces exposes a single public Docker port, so this merged image uses `7861` as the public entrypoint:

| Public Path | Internal Service | Internal Port |
| :--- | :--- | :--- |
| `/` | HuggingClaw dashboard | `7861` |
| `/app/` | OpenClaw Control UI / gateway | `7860` |
| `/terminal/` | JupyterLab terminal | `8888` |

The reverse proxy must preserve these public prefixes for normal HTTP responses, redirects, and WebSocket upgrades. That prevents common HF Spaces failures like `/terminal/...` or `/app/...` returning 404 after a backend redirects to `/login`, `/lab`, or an internal `127.0.0.1` URL.

## Restored Missing Items

- Full upstream README content, with merged terminal/routing sections.
- Upstream `.env.example`, updated with `JUPYTER_TOKEN`.
- Upstream security, contribution, license, changelog, and code-of-conduct files.
- Expanded `.gitignore` from upstream plus local dependency/temp ignores.
- HF template `.gitattributes` LFS rules.
- HF-style JupyterLab login template.

## Still Needs Deployment-Specific Confirmation

- Confirm the actual Hugging Face Space slug before adding any GitHub Actions workflow that pushes to HF.
- Set `JUPYTER_TOKEN` to a strong secret instead of relying on the template default.
- Open both `/app/` and `/terminal/` with trailing slashes after the HF Space rebuild completes.
