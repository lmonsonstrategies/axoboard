# AxoBoard pricing and $5K MRR model

Status: launch hypothesis for design-partner validation
Updated: 2026-08-12

## Commercial objective

Build AxoBoard to at least **$5,000 in monthly recurring revenue**, while keeping infrastructure and routine support low enough to preserve an 80%+ gross margin.

Pricing is based on operational capacity rather than audience size. Every paid plan includes unlimited dashboards and viewers. The bill grows when a customer needs more connected accounts, editors, TV screens, refresh speed, history, workspaces, automation volume, or governance.

## Plans

| Plan | Monthly | Annual equivalent | Primary customer |
| --- | ---: | ---: | --- |
| Starter | $99/mo | $79/mo | One team replacing manual KPI screenshots |
| Growth | $249/mo | $199/mo | Core AxoBoard customer using celebrations and competition |
| Scale | $599/mo | $499/mo | Multiple teams or locations requiring governance |
| Enterprise | From $1,500/mo | Annual contract | Contracted security, SLA, SSO, and custom capacity |

### Starter — get visible

- 3 connected accounts
- 2 editors; unlimited viewers
- Unlimited dashboards
- 1 paired TV screen
- 15-minute refresh
- 90-day metric history
- Core KPI cards, goals, comparisons, drilldowns, and freshness
- Responsive web, mobile, and TV layouts
- Secure sharing and scheduled snapshots
- Basic alerts and 1,000 automation runs per month
- Starter celebration templates and stock sounds
- Email/community support

Starter deliberately excludes custom sound uploads, Kombat Studio, advanced branding, and multi-channel actions. It proves value without satisfying the full behavioral-engagement use case.

### Growth — create momentum

- Everything in Starter
- 10 connected accounts
- 5 editors; unlimited viewers
- 5 paired TV screens
- 5-minute refresh
- Two-year metric history
- Celebration HQ with customer templates
- My Sounds uploads, playlists, and quiet hours
- Kombat Studio with configurable teams, scoring, arenas, and win rules
- Customer logo, colors, language, and display branding
- Email, Slack, and webhook actions
- 10,000 automation runs per month with retry history
- Standard support

Growth is the hero plan and should win most trials. It contains AxoBoard's core differentiation, not merely additional capacity.

### Scale — run the operation

- Everything in Growth
- 30 connected accounts
- 15 editors; unlimited viewers
- 20 paired TV screens
- Up to one-minute refresh where provider APIs support it
- Five-year metric history
- Three isolated workspaces
- Full white-label dashboards, shares, and displays
- Advanced roles and publishing approvals
- Audit history and usage export
- 50,000 automation runs and controlled operational actions
- Priority support and guided rollout

### Enterprise — security and contract

- Negotiated connections, editors, screens, workspaces, history, and automation
- SAML/SSO and user provisioning
- Contracted SLA and support coverage
- Security review and data-processing terms
- Custom retention and optional infrastructure isolation
- Dedicated customer-success ownership
- Implementation scoped and priced separately

## Add-ons

| Add-on | Price |
| --- | ---: |
| Additional connected account | $15/mo |
| Additional TV screen | $10/mo |
| Additional workspace | $49/mo |
| Additional 10,000 automation runs | $25/mo |
| Assisted launch | $750 one-time |
| Done-for-you implementation | From $2,500 one-time |
| Enterprise implementation | From $5,000 one-time |

Warn customers at 80% and 100% of a capacity limit. Do not automatically charge overages without an explicit customer choice.

## Design-partner offer

The first five external design partners receive:

- $299/month for six months
- $1,500 implementation fee
- Growth features with selected Scale capabilities
- 12-month price protection
- Structured product feedback
- Permission to create an anonymized case study

Five design partners produce **$1,495 MRR** plus **$7,500 in one-time implementation revenue**. This is validation pricing, not a permanent public tier.

## Durable path to $5K MRR

Use annual-equivalent prices for planning so the target still works when customers take the discount.

| Customers | Plan | MRR per customer | MRR |
| ---: | --- | ---: | ---: |
| 5 | Starter | $79 | $395 |
| 16 | Growth | $199 | $3,184 |
| 3 | Scale | $499 | $1,497 |
| **24** |  |  | **$5,076** |

This is the conservative durable target: **24 paying customers**, with two-thirds on Growth. Customers paying monthly or buying add-ons create upside.

### Faster design-partner bridge

| Customers | Offer | MRR |
| ---: | --- | ---: |
| 5 | Design partner at $299 | $1,495 |
| 12 | Growth monthly at $249 | $2,988 |
| 1 | Scale monthly at $599 | $599 |
| **18** |  | **$5,082** |

This reaches the number sooner, but it is not durable until design partners convert to a standard plan.

## Revenue milestones

1. **Proof — $1,495 MRR:** five paid design partners.
2. **Repeatability — $2,500 MRR:** roughly ten Growth-equivalent accounts with at least 70% of each deployment configured without custom code.
3. **Target — $5,076 MRR:** 24 annual-equivalent customers in the durable mix above.
4. **Owner-income buffer — $6,000+ MRR:** recommended target if “make $5K” means cash remaining before personal income tax rather than gross subscription revenue.

## Current and expected operating cost

### Beta today

- Domain: $60/year = **$5/month equivalent**
- Railway Hobby: **$5/month minimum**, including $5 of resource usage
- Current known infrastructure floor: **about $10/month**

Railway remains usage based. Hobby currently prices RAM at $10/GB-month, CPU at $20/vCPU-month, egress at $0.05/GB, and volume storage at $0.15/GB-month beyond included usage. Source: [Railway pricing plans](https://docs.railway.com/pricing/plans), checked 2026-08-12.

### Paid-customer launch budget

Do not promise commercial reliability from a plan positioned for personal projects. Upgrade to Railway Pro when external paying customers depend on AxoBoard.

| Cost category | Initial monthly budget at launch |
| --- | ---: |
| Domain | $5 |
| Railway Pro and application usage | $20–$100 |
| Database backups/object storage | $15–$50 |
| Transactional email, monitoring, and logs | $20–$75 |
| Payment processing reserve | 4% of collected revenue |
| Support/refund contingency | 5% of revenue |

At $5,076 MRR, reserve roughly **$457** for payment and support variability plus **$60–$225** for infrastructure/tooling. Expected contribution before labor and tax is approximately **$4,394–$4,559**, or an 87%–90% contribution margin.

If Leroy wants $5,000 left before personal income tax, target at least **$6,000 MRR**. If he means $5,000 after personal income tax, set the target after consulting the relevant tax assumptions rather than treating MRR as take-home pay.

## Cost guardrails

- Keep total infrastructure and customer-success software below 10% of MRR.
- Keep payment, refunds, and routine support contingency below another 10%.
- Cache published viewer payloads; a dashboard view must not trigger provider API calls.
- Normalize one metric snapshot and reuse it across cards, alerts, games, exports, and celebrations.
- Track Railway usage and gross margin per workspace before opening self-serve signup.
- Move any customer with unusual refresh/data requirements to Scale or a scoped implementation.
- No custom connector is included in a standard subscription unless it is reusable across customers.

## Fastest MVP path

1. Sell five design partners before building automated checkout.
2. Manually provision Growth entitlements and invoice the $299 + $1,500 offer.
3. Deliver Google Sheets, one live dashboard, one display, one celebration, and one deterministic rule end-to-end.
4. Measure onboarding hours, support minutes, provider calls, storage, and Railway cost per workspace.
5. Add subscription checkout only after at least three customers have reached first value and paid.

## Top failure modes and detection

1. **Custom-services trap:** more than 30% of deployments need customer-specific code. Detect through implementation hours and reused-versus-custom components.
2. **Starter cannibalizes Growth:** most active teams stay on Starter while requesting sounds, games, or branding. Detect trial feature demand and upgrade conversion; keep differentiators out of Starter.
3. **Cheap hosting hides bad unit economics:** beta costs look tiny because customers and sync jobs are not live. Detect Railway cost, provider calls, worker time, and retained snapshots per workspace every month.

## Pricing review trigger

Review packaging after ten paying customers or three months of paid usage, whichever comes first. Change public pricing only from measured conversion, support load, infrastructure cost, and willingness-to-pay evidence.
