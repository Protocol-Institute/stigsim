---
version: alpha
name: "Stigsim"
description: "A dark, instrument-like ant simulation interface built for close observation and controlled experimentation."
colors:
  background: "#0f0a04"
  surface: "#171007"
  surface-strong: "#191107"
  border: "#3d2e18"
  text: "#e5d5b5"
  text-strong: "#f4ead7"
  text-muted: "#927e5f"
  primary: "#f59e0b"
  danger: "#ef8b55"
typography:
  sans:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
rounded:
  sm: "0.4375rem"
  DEFAULT: "0.5rem"
  md: "0.6875rem"
  lg: "0.8125rem"
spacing:
  page-inline: "clamp(0.75rem, 2.4vw, 2.125rem)"
  panel-gap: "1.125rem"
components:
  button: {}
  panel: {}
  status: {}
  range: {}
---

# Stigsim Design System

## Overview

### Creative North Star

Stigsim should feel like a field biologist's observation instrument built into
a dark wooden workbench: warm amber controls, soil-dark surfaces, precise
readouts, and the living simulation as the brightest object. The interface is
not a game lobby reskin or a generic analytics dashboard.

### Product context and register

- **Audience and primary job:** workshop participants, players, and researchers
  configure ant-colony behavior, observe emergent coordination, and compare
  reproducible runs.
- **Target markets and evidence:** the project documentation describes a public
  browser experience for the Protocol Symposium; no country-specific market is
  encoded in the product.
- **Locale and language policy:** the current interface is English-only.
- **Usage scene:** desktop-first simulation work with responsive access on
  smaller screens; dense numeric state is expected during a run.
- **Register:** product UI with a restrained scientific-game identity.
- **Memorable signature:** the maze canvas and colony-colored instrumentation;
  replay uses one amber-bordered verification rail rather than a new theme.
- **Restraint:** settings, file actions, errors, and playback controls stay
  familiar, text-labeled, and keyboard operable.
- **Anti-references:** avoid neon cyberpunk dashboards, glass-card SaaS shells,
  and cartoon ant motifs; each would compete with the simulation itself.
- **Token ownership/runtime mapping:** this file documents the established
  runtime source in [`src/styles.css`](src/styles.css). CSS remains canonical;
  changes to durable visual values must update both locations.

## Colors

The application is dark-only. `background` carries the page, `surface` and
`surface-strong` separate instruments tonally, and `border` provides structure
without elevation. `primary` is both the action and verification color. Colony
colors remain data colors owned by the renderer. `danger` marks low energy,
replay divergence, and other recoverable warnings; it is not used decoratively.

## Typography

The system sans stack carries controls and prose. Compact uppercase labels use
weight and tracking to behave like instrument legends. Seeds and other exact
identifiers use the mono stack. Numeric readouts use tabular figures where
alignment matters. Copy is direct and describes the action or state.

## Layout

Simulation pages use wide centered content with responsive inline padding.
War's desktop arena keeps the maze central between two symmetric colony panels;
below 1100px the maze moves above the panels, and below 660px the panels stack.
Status and replay rails occupy the same centered width as the arena so new
state never appears detached from the run it describes.

## Elevation & Depth

Hierarchy comes from tonal surfaces and brown-gold borders. Strong shadows are
reserved for setup overlays and the maze glow. Static controls and research
status panels remain flat. Backdrop blur belongs only to overlays.

## Shapes

Buttons use the default 8px radius. Instrument panels use the medium and large
radii; pills are limited to compact setting summaries and status chips. Borders
are one pixel except the maze, whose heavier edge frames the simulation field.

## Components

### Foundational visual states

Enabled controls have a pointer cursor, amber border on hover/focus, and a
visible focus treatment. Disabled controls retain their footprint and lower
opacity. Errors use text and color together. Replay divergence stops playback
before unverified state is presented and exposes an explicit continuation.

### Buttons and actions

Amber solid buttons are the primary action; dark bordered buttons are neutral.
Actions use stable verb labels such as “Save record”, “Load record”, and “Exit
replay”. Destructive emphasis is not currently part of the simulation flows.

### Navigation and data display

Dense readouts use small labels with larger tabular values. Match settings are
compact chips. Playback state uses a dedicated rail with tick position,
verification status, and its controls in one place.

### Forms and overlays

Native range and file controls are retained for their platform accessibility;
file inputs are activated by labeled buttons. Setup is the established modal
surface. Persistent errors and verification messages use inline status regions.

### Iconography

The product primarily uses text labels and simple native marks. Do not introduce
an icon-only action unless it has an accessible name and the symbol is clearer
than the existing text.

### Motion

Motion is simulation-driven. UI transitions should be brief and functional;
do not add ambient movement around a canvas that is already continuously alive.
Reduced-motion preferences must not affect simulation correctness.

### Content and data visualization

Use plain research language: run, record, replay, tick, divergence, colony, and
doctrine. Never describe an unverified continuation as exact. The canvas remains
the primary visualization; metrics and exported channels are textual data
alternatives, not decorative charts.

## Do's and Don'ts

- **Do:** keep replay integrity visible and place recovery beside the failure.
- **Do:** reuse War's established controls, spacing, and colony symmetry.
- **Don't:** expose engine internals or transport terminology in player-facing copy.
- **Don't:** add decorative gradients or motion that competes with ant behavior.
