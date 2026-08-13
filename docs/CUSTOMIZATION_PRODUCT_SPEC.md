# AxoBoard customization product specification

## Product thesis

AxoBoard wins by making trusted performance data feel personal and alive. Customers should be able to build their own branded celebration system without needing a designer, developer, or AxoBoard support ticket.

The promise is simple:

> Connect the metric, choose the moment, make it yours, and celebrate automatically.

## Experience architecture

```text
Trusted metric or business event
              │
              ▼
      Trigger + eligibility rules
              │
       ┌──────┴────────┐
       ▼               ▼
 Dashboard/TV      Competition score
 celebration       and round state
       │               │
       └──────┬────────┘
              ▼
   Visual + copy + My Sounds asset
              │
              ▼
  Preview → draft → publish → rollback
```

## Brand direction

AxoBoard itself is inspired by a leucistic axolotl:

- warm white `#FFF9FB` for the main canvas;
- pale shell pink `#FBE7EF` for layered surfaces;
- leucistic pink `#F6A9C4` for friendly accents;
- coral `#E96F98` for primary actions and celebration energy;
- aquatic blue `#43BDE8` and pale water blue `#DDF6FF` for navigation, focus, depth and calm contrast;
- GFP green `#72DC67` with glow tint `#B8F58E` for live state, success, momentum and rare high-energy highlights;
- deep plum `#34233A` for accessible, warmer-than-black text;

Pink and warm white remain the dominant identity. Aquatic blue is the secondary system accent. GFP green is a restrained luminous signal—not a general-purpose background or primary-action color—so the interface evokes a GFP axolotl without becoming neon-heavy.
- restrained mint for success states.

Use Fredoka for expressive headings and DM Sans for controls and body copy. The mascot should feel friendly and energetic without turning a corporate product into a children’s app.

Customer branding is independent of the AxoBoard product theme. A customer can replace logos, colors, typography, terminology, sounds, sprites and game imagery while retaining accessible components and navigation.

## Core surfaces

### Celebration HQ

- Team goal, top performers, live wins and recent achievements.
- Replayable celebration moments with visual style, sound and intensity controls.
- Trigger templates for deal won, personal record, streak, team goal and custom event.
- Team, individual, TV-screen and private audience controls.
- Quiet hours, per-user mute, reduced motion and rate limiting.

### My Sounds

- Upload MP3, WAV or M4A with format, duration and size validation.
- Preview, trim/start-offset, normalize volume, tag, favorite and archive.
- Assign one sound to multiple celebration or game events.
- Tenant-owned library with roles for upload, approval and publish.
- Malware scan, ownership attestation and audit history.

### Team Competitions

- Rename the game and all player-facing terminology.
- Configure point sources, points per action, bonuses, penalties and win condition.
- Upload team sprites, arena backgrounds and effect assets.
- Choose colors, sounds, team names and winner copy.
- Preview scores and winner states before publishing.
- Publish versioned presets with scheduled activation and rollback.

Murphy Kombat is one preset. Its identity is configuration, not hardcoded product behavior.

### Brand Studio

- Workspace name, logo, domain, palette and typography.
- Default celebration wording, motion style, sound policy and mascot behavior.
- Live previews across dashboard, celebration and game contexts.
- Automated contrast checking and safe fallbacks.

## Generic contracts

### Celebration template

```json
{
  "id": "celebration_deal_won",
  "tenantId": "tenant_123",
  "trigger": { "eventType": "deal.won", "minimumValue": 1000 },
  "audience": { "teams": ["sales"], "destinations": ["dashboard", "tv"] },
  "presentation": {
    "headline": "{{winner.name}} closed {{event.amount}}!",
    "style": "confetti",
    "intensity": 3,
    "durationMs": 8000,
    "soundAssetId": "sound_victory_splash"
  },
  "controls": { "quietHours": true, "replayable": true, "rateLimitPerHour": 8 }
}
```

### Competition preset

```json
{
  "id": "game_murphy_kombat",
  "tenantId": "tenant_123",
  "name": "Murphy Kombat",
  "teams": [
    { "id": "bluefin", "name": "Bluefin", "color": "#38A8EA", "spriteAssetId": "sprite_bluefin" },
    { "id": "coral", "name": "Coral Crew", "color": "#F55286", "spriteAssetId": "sprite_coral" }
  ],
  "scoring": {
    "sourceMetricId": "net_sales",
    "mode": "points",
    "pointsPerEvent": 10,
    "bonuses": [{ "rule": "streak >= 3", "points": 20 }],
    "winCondition": { "type": "first_to", "target": 100 }
  },
  "presentation": {
    "arenaAssetId": "arena_axolotl",
    "victorySoundAssetId": "sound_victory_splash",
    "winnerCopy": "{{team.name}} wins!"
  }
}
```

## Ease-of-use rules

1. Never expose raw JSON in the normal editor.
2. Use presets and plain-language questions before advanced controls.
3. Keep live preview visible during editing.
4. Autosave drafts; require explicit publish.
5. Validate assets at upload and show the exact fix.
6. Provide undo, version history and one-click rollback.
7. Default to accessible contrast, safe sound levels and reduced-motion support.
8. Show where every score or celebration came from.

## MVP sequence

1. Brand tokens and versioned tenant theme.
2. Celebration trigger, visual, sound and audience contracts.
3. Celebration HQ viewer with replay and quiet-hour controls.
4. My Sounds upload, preview and assignment.
5. Generic competition scoring engine with one Murphy-configured preset.
6. Team Competitions asset/terminology editor and live preview.
7. TV mode, publishing, rollback and event audit.

## Top failure modes and quick detection

1. **Celebrations become annoying** — watch mute/dismiss rate and trigger volume; add quiet hours and caps.
2. **Scores are wrong or duplicated** — compare score events by unique source `event_id`; expose an admin correction ledger.
3. **Customization requires support** — measure time-to-first-publish and support touches; block features that cannot be completed from presets and inline guidance.
