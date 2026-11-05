# Prompt Chain Tool

Superadmin tool for **The Humor Project**: build, order and run the prompt chains that turn a photo into captions. A separate Next.js 16 app and Vercel project, sharing the Supabase database (`wqkpatxsbxwjsupojjcq`) with the member app ([kaffy811/HumorProject](https://github.com/kaffy811/HumorProject)) and Humor Admin ([kaffy811/HumorProject-Admin](https://github.com/kaffy811/HumorProject-Admin)).

## What it does

| Page | Week 8 requirement |
| --- | --- |
| `/` Dashboard | Runs, success rate and tokens for the last 7 days, runs per day, the chain members use, recent runs and chain cards. |
| `/chains` | **Create** prompt chains; every chain as a card with its steps as a small flow, colour-coded by provider (Gemini / GPT / mixed), use by members and runs. |
| `/chains/[id]` | **Chain settings** on top (name, prompt version, description, and the **one model every step uses**; switching it, e.g. Gemini → GPT, changes all steps in one save), with History / Duplicate / Delete. Below, the **canvas** ([React Flow](https://reactflow.dev)): Photo → steps → Captions, zoom (scroll, pinch, − / + / Fit), pan, minimap; red arrows pass output, blue arcs feed the photo, `{stepN}` references arc over the steps they skip. Each step node shows its inputs, output and model, problems in red, ▶ to test it and a ⋯ menu to move it left or right; **+** on an arrow inserts a step there. Clicking a step opens the **side panel** (resizable; **⤢ Full page** turns it into a whole page with settings on the left and big prompt boxes on the right, Esc returns; full screen on phones) with collapsible sections: Basics (name, sees the photo, returns), Inputs (click to insert `{direction}` / `{previous}` / `{stepN}`), System and User prompt (empty boxes explain that inputs go in curly braces `{…}` with an example for that position, and a hint under the user prompt lists the inputs it can use and what its output becomes; ⤢ expands to a large editor; live preview with valid placeholders in green, invalid in red), Output (JSON schema for captions) and **Test this step** (one model call with editable earlier outputs prefilled from the latest run; nothing saved). Saving is manual (Save step or Ctrl/⌘+S) with an "Unsaved" marker; switching steps or leaving the page with unsaved changes asks first. Every save is a version in History. |
| `/chains/[id]/history` | **Version history**: a numbered version is saved after every change (details, step add/edit/delete, reorder, model switch, restore), with who and when. Line-by-line diff between any version and the one before it or the current one; **Restore** puts an earlier version back in one transaction, keeping the current state as a version. |
| `/chains/[id]/run` | **Generate media**: upload a photo (or reuse a member post's photo), add an optional direction, optionally run **every step with one model** (e.g. the same chain on Gemini and on GPT), and run. The browser calls one step per request, so each step's output appears as soon as it is ready; a failed step can be retried without redoing earlier ones. |
| `/chains/[id]/media`, `/runs/[id]` | **View media produced by this chain**: every run (photo, captions, status) with every step's filled prompt, output, tokens and time; plus member posts generated with the chain's prompt version. |
| Top bar | **Avatar menu** (profile photo or initial, name, email, theme, link to Humor Admin, sign out) with **light / dark / system** theme, remembered per browser and applied before first paint. |

### How a chain runs
Each step has a model (Humor Admin → LLM models & providers), a system prompt, a user prompt, whether it **sees the photo**, and whether it **returns text** (passed on) or **captions** (final JSON `{"captions": [...]}`). User prompts can use:

- `{direction}`: the run's direction (`none` when empty)
- `{previous}`: the output of the step before
- `{stepN}`: the output of step N (must run earlier)

Example (seeded as `campus-captions-v4`, the chain members use): 1. look at the photo (sees photo, text) → 2. find five comic angles from `{previous}` (text) → 3. write four captions in four styles from `{step1}` and `{previous}` (captions).

Connectors: Gemini (`provider slug google`, `GEMINI_API_KEY`) and OpenAI (`openai`, `OPENAI_API_KEY`, Chat Completions with image input). A run copies every step's settings when it starts, so editing the chain later never rewrites history; runs survive deleting the chain. Runs never create member posts.

Members get the one chain chosen in Humor Admin → Model for members. The member app runs chains of up to 4 steps (earlier steps return text, the last returns the four captions); anything it cannot run falls back to the built-in Gemini prompt. To move members between Gemini and GPT, use **Model for every step** on that chain.

## Security

- Every route except `/login`, `/denied` and `/auth/*` needs a fresh **Google** session whose `profiles.is_superadmin` is strictly `true`. Humor Admin's `is_admin` role is **not** enough.
- Checked three times: `proxy.ts` (fails closed), `requireSuperadmin()` in every page, and again in every Server Action and API route. API routes also require the request's `Origin` to be this site.
- The Supabase secret and provider keys are server-only. Run photos live in the private `humor-chain-runs` bucket and are shown with 10-minute signed URLs. Pages are `private, no-store` and `noindex`.

## Database

Needs these migrations from kaffy811/HumorProject, applied in the Supabase SQL editor:

1. `supabase/migrations/202610280001_admin_catalog.sql` (chains, steps, models; already applied)
2. `supabase/migrations/202611050001_prompt_chain_tool.sql`: step `include_image` / `output_kind`, the atomic `humor_reorder_prompt_chain_steps()` function, `humor_chain_runs` / `humor_chain_run_steps`, the private `humor-chain-runs` bucket and the example chain.

3. `supabase/migrations/202611060001_member_three_step_chain.sql`: the members' three-step chain (replaces the earlier chains).
4. `supabase/migrations/202611060002_prompt_chain_versions.sql`: version history, restore and duplicate.
5. `supabase/migrations/202611070001_chain_model.sql`: the chain's model (before it, the tool uses the model most steps use).

Until the second one is applied, pages show a notice saying what to run; History shows its own notice until the fourth one is applied (edits still work without it).

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
npm test                      # gate, validation, placeholders, reorder, problems, connectors, version diff
npm run lint && npx tsc --noEmit
npm run test:e2e              # builds against a local fake Supabase and checks every route's gate
```
