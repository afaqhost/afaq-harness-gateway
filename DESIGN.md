# AFAQ Harness Gateway — DESIGN.md

## 1. Design Purpose

AFAQ Harness Gateway is a developer-focused infrastructure product for running, routing, managing, and orchestrating multiple AI coding Harnesses behind a unified interface.

The visual identity must communicate:

- Developer infrastructure
- AI orchestration
- Security
- Reliability
- Modularity
- Open Source
- Multi-Harness architecture

The product must not visually resemble a generic AI chatbot, hosting panel, crypto product, or consumer SaaS.

## 2. Brand Direction

### Core Positioning

> One Gateway. All Harnesses.

AFAQ Harness Gateway is the bridge between applications and multiple AI coding Harnesses.

The visual language should emphasize:

```text
Gateway
Routing
Connections
Nodes
Systems
Infrastructure
AI
Developer tooling
```

### Brand Personality

The interface should feel:

- Technical
- Premium
- Modern
- Precise
- Calm
- Trustworthy
- Open
- Modular

Avoid excessive gradients, generic AI imagery, robot illustrations, overuse of glassmorphism, excessive glow, overly colorful dashboards, and consumer-app patterns.

## 3. Logo

### Primary Mark

The AFAQ Harness Gateway mark is a stylized gateway/network symbol built around an abstract "A" form with connected nodes.

The mark represents:

```text
AFAQ
  ↓
Gateway
  ↓
Multiple Harnesses
```

The lower nodes represent connected Harnesses, systems, or execution targets.

### Logo Lockups

Supported lockups:

**Horizontal**

```text
[ AFAQ Symbol ]  AFAQ
                 HARNESS GATEWAY
```

**Compact**

```text
[ AFAQ Symbol ]
AFAQ
```

**Symbol Only**

```text
[ AFAQ Symbol ]
```

Use the symbol-only mark for favicons, app icons, collapsed sidebars, social avatars, and small UI locations.

Do not stretch, rotate, recolor arbitrarily, or rebuild the mark from generic icons.

## 4. Color System

### Primary

| Token | Hex | Usage |
|---|---|---|
| `brand.primary` | `#3B82F6` | Primary actions, links, focus, selected states |
| `brand.primaryDark` | `#1D4ED8` | Hover/active blue |
| `brand.accent` | `#8B5CF6` | AI/orchestration emphasis |
| `brand.cyan` | `#22D3EE` | Optional gateway/network highlight |

### Core UI

| Token | Hex | Usage |
|---|---|---|
| `bg.primary` | `#0B1020` | Main background |
| `bg.surface` | `#111827` | Cards and surfaces |
| `bg.surfaceElevated` | `#162033` | Modals and high elevation |
| `border.default` | `#253149` | Borders/dividers |
| `text.primary` | `#F8FAFC` | Main text |
| `text.secondary` | `#CBD5E1` | Secondary text |
| `text.muted` | `#94A3B8` | Metadata/hints |

### Semantic

| Token | Hex | Usage |
|---|---|---|
| `status.success` | `#22C55E` | Healthy/active/success |
| `status.warning` | `#F59E0B` | Warning/degraded/pending |
| `status.error` | `#EF4444` | Failure/critical |
| `status.info` | `#38BDF8` | Informational |

Semantic colors must communicate state consistently and must not be decorative.

## 5. Gradient System

Primary brand gradient:

```text
#22D3EE → #3B82F6 → #8B5CF6
```

Use for hero highlights, logo glow, large marketing accents, and key visual elements. Do not put gradients on every button or card.

Dashboard UI should generally use flat colors and reserve gradients for restrained brand accents.

## 6. Typography

Primary typeface:

```text
Inter
```

Fallback:

```text
ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
```

Type scale:

```text
Display     56px / 1.05 / 700
H1          40px / 1.15 / 700
H2          30px / 1.2  / 700
H3          22px / 1.3  / 600
Body Large  18px / 1.6
Body        15px / 1.55
Small       13px / 1.45
Label       12px / 1.35 / 600
```

Prefer weights 400, 500, 600, 700.

## 7. Spacing

Use a 4px base system:

```text
4 8 12 16 20 24 32 40 48 64 80 96 128
```

Typical UI spacing:

```text
Card padding: 20–24px
Page padding: 24–32px
Section gap: 32–48px
Major section spacing: 64–96px
```

## 8. Radius

```text
Small control: 8px
Input: 10px
Card: 12–14px
Large panel: 16px
Modal: 16–20px
```

Use pills mainly for badges, tags, and compact controls.

## 9. Shadows

Prefer borders and surface contrast over heavy shadows.

Use subtle elevation such as:

```text
0 8px 30px rgba(0, 0, 0, 0.18)
```

Glow effects are reserved for brand identity, hero visuals, focus states, and major accents.

## 10. Iconography

Recommended icon library:

```text
Lucide
```

Typical sizes:

```text
16px 18px 20px 24px
```

Avoid mixing icon families. Official Harness/vendor logos may be used where appropriate and legally permitted.

## 11. Dashboard Design

The dashboard is a professional developer control center prioritizing:

```text
Status
Health
Harnesses
Installations
Credentials
Models
Routing
Usage
Logs
Security
```

### Main Layout

Persistent desktop sidebar:

```text
┌───────────────────────────────────────────────┐
│ AFAQ Logo                         Search      │
├─────────────┬─────────────────────────────────┤
│ Sidebar     │ Main Content                    │
│ Overview    │                                 │
│ Harnesses   │                                 │
│ Installations                                 │
│ Credentials │                                 │
│ Models      │                                 │
│ Routing     │                                 │
│ Usage       │                                 │
│ Updates     │                                 │
│ Health      │                                 │
│ Logs        │                                 │
│ Audit       │                                 │
│ Settings    │                                 │
│ Security    │                                 │
└─────────────┴─────────────────────────────────┘
```

Sidebar background: `#08101F`.

Selected item: blue surface + subtle blue emphasis + white text.

## 12. Dashboard Overview

Recommended KPI cards:

- Harnesses
- Installations
- Requests
- Success Rate
- Average Latency

Harness status should expose:

- Name
- Status
- Version
- Installation count
- Request volume
- Small trend visualization

System health should cover:

- API Gateway
- Database
- Task Queue
- Storage
- Tenant Services
- Update Service

Recent activity examples:

```text
Installation created
Credential added
Model sync completed
Update available
Backup completed
```

Resource usage should cover CPU, memory, and storage. Managed deployments may additionally show resource limits.

## 13. Harness Management UI

Harness management is a core product surface.

Example:

```text
Harnesses
────────────────────────────────────────────

[ + Add Harness ]

┌─────────────────────────────────────────┐
│ Command Code                            │
│ Healthy   v1.26.0                      │
│ 1 Installation   8 Models              │
│                                         │
│ [Manage] [Health] [Disable]             │
└─────────────────────────────────────────┘
```

Each Harness should expose:

- Definition
- Installations
- Version
- Capabilities
- Credentials
- Health
- Models
- Update status
- Enabled state

## 14. Installation UI

Installation should use a guided workflow:

```text
Choose Harness
      ↓
Choose Version
      ↓
Installation Method
      ↓
Install
      ↓
Verify
      ↓
Health Check
      ↓
Configure Account
      ↓
Ready
```

Security-sensitive operations must not be hidden.

## 15. Credential UI

Never show raw secret material after setup.

Preferred display:

```text
Claude Code
Profile: Personal
Status: Authenticated
Auth: CLI Login
Last Checked: 2 min ago
```

Actions may include:

```text
Check
Reconnect
Disable
Remove
```

Never expose tokens, API keys, environment variables, or raw credential paths in normal UI.

## 16. Model Management

Show:

```text
Model
Harness
Provider
Capabilities
Enabled
Cost Estimate
```

Use monospace for model IDs.

## 17. Routing UI

Represent routing as:

```text
Client
   ↓
Model ID
   ↓
Harness
   ↓
Installation
   ↓
Credential Profile
   ↓
Model
```

Use simple flow diagrams where they clarify routing.

## 18. Usage & Observability

Prioritize:

- Requests
- Tokens
- Estimated cost
- Duration
- Harness
- Model
- API Key
- User/Tenant
- Status

Always label calculated provider cost as:

```text
Estimated cost
```

## 19. Logs

Useful default fields:

```text
timestamp
level
run_id
request_id
harness
model
status
duration
```

Do not expose secrets or sensitive message content in standard logs.

## 20. Chat UI

The Chat UI should feel like a developer console, not a consumer chatbot.

Top controls:

```text
Harness
Provider
Model
```

Message metadata:

```text
Harness
Model
Tokens
Estimated Cost
Duration
```

Actions:

```text
Stop
Retry
Copy
```

Tool events may be collapsible. Raw CLI output should not be the default presentation.

## 21. Landing Page

The landing page must communicate the product in under 10 seconds.

### Hero

Primary headline:

```text
One Gateway.
All Harnesses.
```

Supporting message:

```text
Connect, route, and orchestrate AI coding Harnesses through a single,
secure, OpenAI-compatible gateway.
```

Primary CTA:

```text
Get Started
```

Secondary CTA:

```text
View on GitHub
```

### Hero Visual

Use:

- AFAQ mark
- Gateway/network motif
- Multiple Harness cards
- restrained blue/violet glow
- dark navy background

Supported Harness examples should only be listed if actually supported/documented.

### Landing Page Sections

```text
Hero
↓
Open Source / trust strip
↓
Why AFAQ?
↓
How It Works
↓
Supported Harnesses
↓
Simple Integration
↓
Architecture
↓
Security
↓
Open Source
↓
Get Started
↓
Footer
```

## 22. Marketing Visual Language

Marketing pages may use stronger effects than the dashboard.

Allowed:

- gradient mesh
- radial glow
- subtle grid
- node connections
- animated lines
- soft blue/violet light
- product screenshots

Avoid cyberpunk excess, generic AI brain imagery, stock photography, rainbow neon palettes, and decorative effects without meaning.

## 23. Background System

Primary background:

```text
#0B1020
```

Optional decorative layers:

- radial blue glow
- radial violet glow
- subtle grid
- curved gateway lines

The background should remain darker and quieter than the product content.

## 24. Component Style

### Buttons

Primary marketing CTAs may use the brand gradient.

Dashboard primary buttons should normally use flat blue.

Secondary buttons use dark/transparent surfaces with borders.

Destructive actions use semantic red.

Do not turn every button into a gradient.

### Status Badges

```text
● Healthy
● Degraded
● Offline
● Disabled
● Update Available
● Installing
● Authenticating
```

Use green, amber, red, and blue consistently by state.

## 25. Responsive Design

Desktop is the primary target, especially 1440px+ layouts.

Tablet should collapse secondary panels while preserving navigation hierarchy.

Mobile should use:

- collapsible navigation
- stacked KPI cards
- horizontally scrollable data tables
- overflow actions

Do not destroy information hierarchy just to fit desktop tables onto mobile.

## 26. Accessibility

Minimum requirements:

- WCAG AA contrast target
- keyboard navigation
- visible focus states
- semantic HTML
- accessible labels
- no color-only state indicators
- reduced-motion support

Important states should use icon + color + text.

## 27. Motion

Normal product motion:

```text
150–250ms
```

Use for panels, menus, dialogs, state changes, and loading transitions.

Marketing pages may use richer ambient motion but should remain calm and purposeful.

Avoid constant pulsing and distracting animated backgrounds.

## 28. Empty States

Empty states should explain what the user can do next.

Example:

```text
No Harnesses installed.

Install a Harness to start routing requests.

[ Install Harness ]
```

## 29. Error States

Errors should communicate:

```text
What happened
Why it happened
What can be done
```

Example:

```text
Claude Code is unavailable

The configured installation could not be found.

[ Check Installation ]
[ View Details ]
```

Do not show raw stack traces to normal users.

## 30. Developer / Code Styling

Use monospace for:

- model IDs
- API endpoints
- CLI commands
- IDs
- hashes
- versions
- code snippets

Recommended stack:

```text
ui-monospace,
SFMono-Regular,
Menlo,
Monaco,
Consolas,
Liberation Mono,
monospace
```

## 31. Brand Do / Don't

### Do

- Use dark navy as the foundation.
- Use blue as the main interaction color.
- Use violet for AI/orchestration emphasis.
- Keep UI dense but organized.
- Use subtle gradients.
- Use official Harness/vendor marks where appropriate.
- Preserve consistent status semantics.

### Don't

- Use AFAQ Host gold as the primary Gateway color.
- Make every component glow.
- Turn the dashboard into a cyberpunk interface.
- Mix random gradients.
- Mix icon libraries.
- Over-round every component.
- Make every page visually identical to the marketing landing page.

## 32. Architecture Visual Language

When showing architecture, prefer:

```text
Client
   ↓
OpenAI-Compatible API
   ↓
AFAQ Runtime
   ↓
Harness Platform
   ↓
Harness Installation
   ↓
Credential Profile
   ↓
Harness Adapter
   ↓
Model
```

Use nodes, connectors, and layered containers. The architecture should look modular, deterministic, and engineering-focused.

## 33. Official Design Tokens

```css
:root {
  --brand-primary: #3B82F6;
  --brand-primary-dark: #1D4ED8;
  --brand-accent: #8B5CF6;
  --brand-cyan: #22D3EE;

  --bg-primary: #0B1020;
  --bg-surface: #111827;
  --bg-surface-elevated: #162033;

  --border-default: #253149;

  --text-primary: #F8FAFC;
  --text-secondary: #CBD5E1;
  --text-muted: #94A3B8;

  --status-success: #22C55E;
  --status-warning: #F59E0B;
  --status-error: #EF4444;
  --status-info: #38BDF8;
}
```

These are the default product design tokens.

## 34. Design Priority

When visual decisions conflict, prioritize:

1. Usability
2. Clarity
3. Accessibility
4. Consistency
5. Performance
6. Brand expression

Brand effects must never reduce usability.

## 35. Final Design Principle

AFAQ Harness Gateway should visually communicate one idea:

> Many Harnesses. One clean control plane.

The design should feel like infrastructure built by experienced engineers:

```text
Clear
Modular
Secure
Precise
Powerful
Open
```

Not like an AI marketing product trying to look futuristic.
