# Graph Report - afaq-harness-gateway  (2026-08-25)

## Corpus Check
- 30 files · ~318,901 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 318 nodes · 429 edges · 54 communities (40 shown, 14 thin omitted)
- Extraction: 90% EXTRACTED · 10% INFERRED · 0% AMBIGUOUS · INFERRED: 41 edges (avg confidence: 0.65)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]

## God Nodes (most connected - your core abstractions)
1. `AFAQ Harness Gateway — DESIGN.md` - 36 edges
2. `$()` - 17 edges
3. `HarnessAdapter` - 16 edges
4. `api()` - 12 edges
5. `User` - 11 edges
6. `text()` - 10 edges
7. `Afaq Harness Gateway` - 9 edges
8. `render_page()` - 8 edges
9. `loadKeys()` - 8 edges
10. `HarnessPort` - 8 edges

## Surprising Connections (you probably didn't know these)
- `chat_completions()` --calls--> `get_adapter()`  [INFERRED]
  app/api/openai.py → app/harnesses/registry.py
- `lifespan()` --calls--> `refresh_models()`  [INFERRED]
  app/main.py → app/harnesses/registry.py
- `resolve_identity()` --calls--> `hash_api_key()`  [INFERRED]
  app/api/openai.py → app/core/security.py
- `Config` --uses--> `User`  [INFERRED]
  app/api/auth.py → app/db/database.py
- `create_key()` --calls--> `APIKey`  [INFERRED]
  app/api/admin.py → app/db/database.py

## Communities (54 total, 14 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.08
Nodes (12): ABC, refresh_harness_models(), ClaudeAdapter, CodexAdapter, CommandCodeAdapter, GenericAdapter, get_adapter(), HarnessAdapter (+4 more)

### Community 1 - "Community 1"
Cohesion: 0.13
Nodes (23): create_user(), KeyCreate, UserCreate, bootstrap(), Config, RegisterRequest, UserOut, chat_completions() (+15 more)

### Community 2 - "Community 2"
Cohesion: 0.22
Nodes (25): $(), addBubble(), api(), button, closeDrawer(), createKey(), createUser(), deleteKey() (+17 more)

### Community 3 - "Community 3"
Cohesion: 0.17
Nodes (9): ChatService, parse_model(), UnknownHarnessError, ChatInput, ChatOutput, HarnessPort, ModelInfo, Exception (+1 more)

### Community 4 - "Community 4"
Cohesion: 0.14
Nodes (13): Afaq Harness Gateway, code:bash (python3 -m venv .venv), code:bash (export AFAQ_BASE_URL="http://127.0.0.1:3500"), code:bash (cp .env.example .env), code:bash (python -m compileall -q app), Development Checks, Docker Compose, Documentation (+5 more)

### Community 5 - "Community 5"
Cohesion: 0.14
Nodes (13): code:bash (python3 -m venv .venv), code:bash (python -m uvicorn app.main:app --host 0.0.0.0 --port 3500), code:bash (curl -X POST http://127.0.0.1:3500/api/auth/bootstrap \), code:bash (curl http://127.0.0.1:3500/health), code:json ({"status":"ok","service":"Afaq Harness Gateway","version":"0), code:bash (cp .env.example .env), Create the First Administrator, Docker Compose (+5 more)

### Community 6 - "Community 6"
Cohesion: 0.15
Nodes (12): 16. Model Management, 1. Design Purpose, 22. Marketing Visual Language, 25. Responsive Design, 26. Accessibility, 34. Design Priority, 35. Final Design Principle, 9. Shadows (+4 more)

### Community 7 - "Community 7"
Cohesion: 0.27
Nodes (10): chat_page(), dashboard(), documentation_page(), harnesses_page(), keys_page(), lifespan(), login_page(), render_page() (+2 more)

### Community 8 - "Community 8"
Cohesion: 0.17
Nodes (11): Chat Completions, code:text (Authorization: Bearer afaq_YOUR_KEY), code:bash (curl http://127.0.0.1:3500/v1/models), code:bash (curl http://127.0.0.1:3500/v1/chat/completions \), code:bash (curl -N http://127.0.0.1:3500/v1/chat/completions \), code:json ({"detail":"Valid API key required"}), Dashboard Authentication Endpoints, Error Responses (+3 more)

### Community 9 - "Community 9"
Cohesion: 0.24
Nodes (5): harnesses(), install_harness(), models(), all_adapters(), cached_models()

### Community 10 - "Community 10"
Cohesion: 0.27
Nodes (9): create_key(), login(), create_access_token(), decrypt_secret(), encrypt_secret(), _fernet(), generate_api_key(), hash_api_key() (+1 more)

### Community 11 - "Community 11"
Cohesion: 0.20
Nodes (9): Architecture, Authentication Boundaries, code:text (Client), Current Boundaries, Main Components, Model Cache, Model Identifiers, Persistence (+1 more)

### Community 12 - "Community 12"
Cohesion: 0.22
Nodes (9): 21. Landing Page, code:text (One Gateway.), code:text (Connect, route, and orchestrate AI coding Harnesses through ), code:text (Get Started), code:text (View on GitHub), code:text (Hero), Hero, Hero Visual (+1 more)

### Community 13 - "Community 13"
Cohesion: 0.29
Nodes (7): 3. Logo, code:text (AFAQ), code:text ([ AFAQ Symbol ]  AFAQ), code:text ([ AFAQ Symbol ]), code:text ([ AFAQ Symbol ]), Logo Lockups, Primary Mark

### Community 14 - "Community 14"
Cohesion: 0.29
Nodes (6): Adding a Harness, code:text (codex//gpt-5.6-terra), Harness Integrations, Model Names, Refreshing Models, Supported Adapters

### Community 15 - "Community 15"
Cohesion: 0.50
Nodes (4): 11. Dashboard Design, code:text (Status), code:text (┌───────────────────────────────────────────────┐), Main Layout

### Community 16 - "Community 16"
Cohesion: 0.50
Nodes (4): 24. Component Style, Buttons, code:text (● Healthy), Status Badges

### Community 17 - "Community 17"
Cohesion: 0.50
Nodes (4): 2. Brand Direction, Brand Personality, code:text (Gateway), Core Positioning

### Community 18 - "Community 18"
Cohesion: 0.50
Nodes (4): 20. Chat UI, code:text (Harness), code:text (Harness), code:text (Stop)

### Community 19 - "Community 19"
Cohesion: 0.50
Nodes (4): 4. Color System, Core UI, Primary, Semantic

### Community 20 - "Community 20"
Cohesion: 0.50
Nodes (4): 6. Typography, code:text (Inter), code:text (ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,), code:text (Display     56px / 1.05 / 700)

### Community 21 - "Community 21"
Cohesion: 0.67
Nodes (3): BaseSettings, get_settings(), Settings

### Community 22 - "Community 22"
Cohesion: 0.50
Nodes (3): code:bash (python3 -c "import secrets; print(secrets.token_urlsafe(48))), Configuration, Secret Generation

### Community 23 - "Community 23"
Cohesion: 0.67
Nodes (3): 10. Iconography, code:text (Lucide), code:text (16px 18px 20px 24px)

### Community 24 - "Community 24"
Cohesion: 0.67
Nodes (3): 15. Credential UI, code:text (Claude Code), code:text (Check)

### Community 25 - "Community 25"
Cohesion: 0.67
Nodes (3): 29. Error States, code:text (What happened), code:text (Claude Code is unavailable)

### Community 26 - "Community 26"
Cohesion: 0.67
Nodes (3): 31. Brand Do / Don't, Do, Don't

### Community 27 - "Community 27"
Cohesion: 0.67
Nodes (3): 7. Spacing, code:text (4 8 12 16 20 24 32 40 48 64 80 96 128), code:text (Card padding: 20–24px)

## Knowledge Gaps
- **94 isolated node(s):** `translations`, `button`, `ModelInfo`, `What It Provides`, `code:bash (python3 -m venv .venv)` (+89 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **14 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AFAQ Harness Gateway — DESIGN.md` connect `Community 6` to `Community 12`, `Community 13`, `Community 15`, `Community 16`, `Community 17`, `Community 18`, `Community 19`, `Community 20`, `Community 23`, `Community 24`, `Community 25`, `Community 26`, `Community 27`, `Community 28`, `Community 29`, `Community 30`, `Community 31`, `Community 32`, `Community 33`, `Community 34`, `Community 35`, `Community 36`, `Community 37`, `Community 38`, `Community 39`, `Community 40`, `Community 41`?**
  _High betweenness centrality (0.087) - this node is a cross-community bridge._
- **Why does `refresh_models()` connect `Community 0` to `Community 9`, `Community 7`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **Why does `lifespan()` connect `Community 7` to `Community 0`?**
  _High betweenness centrality (0.021) - this node is a cross-community bridge._
- **Are the 9 inferred relationships involving `User` (e.g. with `ChatMessage` and `ChatRequest`) actually correct?**
  _`User` has 9 INFERRED edges - model-reasoned connections that need verification._
- **What connects `translations`, `button`, `ModelInfo` to the rest of the system?**
  _94 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.08108108108108109 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.1310344827586207 - nodes in this community are weakly interconnected._