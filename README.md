# Prompt Chain Tool

Superadmin tool for **The Humor Project**: build, order and run the prompt chains that turn a photo into captions. A separate Next.js 16 app and Vercel project, sharing the Supabase database (`wqkpatxsbxwjsupojjcq`) with the member app ([kaffy811/HumorProject](https://github.com/kaffy811/HumorProject)) and Humor Admin ([kaffy811/HumorProject-Admin](https://github.com/kaffy811/HumorProject-Admin)).

## What it does

| Page | Week 8 requirement |
| --- | --- |
| `/` Dashboard | Runs, success rate and tokens for the last 7 days, runs per day, the chain members use, recent runs and chain cards. |
| `/chains` | **Create** prompt chains; every chain as a card with its steps as a small flow, colour-coded by provider (Gemini / GPT / mixed), use by members and runs. |
| `/chains/[id]` | **Update / delete** the chain; **create / update / delete** steps; **reorder** steps with ↑ ↓ or by dragging the ⠿ handle (saved atomically, rolled back on failure). A **flow diagram** (photo → steps → captions, with `{stepN}` and photo inputs drawn as arcs) and the list of problems (such as `{previous}` in step 1) update the moment you reorder. Step forms show a **live preview**: placeholders highlighted green/red, the prompt filled with sample data, a token estimate, and one-click placeholder chips. |
| `/chains/[id]/run` | **Generate media**: upload a photo (or reuse a member post's photo), add an optional direction, optionally run **every step with one model** (e.g. the same chain on Gemini and on GPT), and run. The browser calls one step per request, so each step's output appears as soon as it is ready; a failed step can be retried without redoing earlier ones. |
| `/chains/[id]/media`, `/runs/[id]` | **View media produced by this chain**: every run (photo, captions, status) with every step's filled prompt, output, tokens and time; plus member posts generated with the chain's prompt version. |
| Top bar | **Avatar menu** (profile photo or initial, name, email, theme, link to Humor Admin, sign out) with **light / dark / system** theme, remembered per browser and applied before first paint. |

### How a chain runs
Each step has a model (Humor Admin → LLM models & providers), a system prompt, a user prompt, whether it **sees the photo**, and whether it **returns text** (passed on) or **captions** (final JSON `{"captions": [...]}`). User prompts can use:

- `{direction}`: the run's direction (`none` when empty)
- `{previous}`: the output of the step before
- `{stepN}`: the output of step N (must run earlier)

Example (seeded as `demo-three-step-v1`): 1. describe the photo (sees photo, text) → 2. write a comedy bit from `{previous}` (text) → 3. turn `{previous}` into five captions (captions).

Connectors: Gemini (`provider slug google`, `GEMINI_API_KEY`) and OpenAI (`openai`, `OPENAI_API_KEY`, Chat Completions with image input). A run copies every step's settings when it starts, so editing the chain later never rewrites history; runs survive deleting the chain. Runs never create member posts.

The member app still runs **single-step** chains only (Humor Admin → Model for members); a multi-step chain falls back to the built-in prompt there.

## Security

- Every route except `/login`, `/denied` and `/auth/*` needs a fresh **Google** session whose `profiles.is_superadmin` is strictly `true`. Humor Admin's `is_admin` role is **not** enough.
- Checked three times: `proxy.ts` (fails closed), `requireSuperadmin()` in every page, and again in every Server Action and API route. API routes also require the request's `Origin` to be this site.
- The Supabase secret and provider keys are server-only. Run photos live in the private `humor-chain-runs` bucket and are shown with 10-minute signed URLs. Pages are `private, no-store` and `noindex`.

## Database

Needs these migrations from kaffy811/HumorProject, applied in the Supabase SQL editor:

1. `supabase/migrations/202610280001_admin_catalog.sql` (chains, steps, models; already applied)
2. `supabase/migrations/202611050001_prompt_chain_tool.sql`: step `include_image` / `output_kind`, the atomic `humor_reorder_prompt_chain_steps()` function, `humor_chain_runs` / `humor_chain_run_steps`, the private `humor-chain-runs` bucket and the example chain.

Until the second one is applied, pages show a notice saying what to run.

## Deploy (separate Vercel project)

1. Vercel → Add New → Project → import **kaffy811/HumorProject-PromptChains**. Framework preset: Next.js.
2. Environment variables (Production + Preview): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` (secret), `GEMINI_API_KEY` and/or `OPENAI_API_KEY` (secret). Optional: `CHAINS_AUTH_ORIGIN=https://<production domain>`, `HUMOR_ADMIN_URL=https://<Humor Admin domain>` (link in the account menu).
3. Supabase → Authentication → URL Configuration → Redirect URLs: add `https://<tool domain>/auth/callback` (and `https://*-humor-project8.vercel.app/auth/callback` for preview deployments).
4. Vercel → Settings → Deployment Protection → turn off **Vercel Authentication**, so the page opens in an incognito window (the app's own Google + superadmin gate still protects everything).

## Develop and check

```bash
npm ci
cp .env.example .env.local   # fill in keys
npm run dev                   # http://localhost:3020
npm test                      # gate, validation, placeholders, reorder, problems, connectors
npm run lint && npx tsc --noEmit
npm run test:e2e              # builds against a local fake Supabase and checks every route's gate
```
