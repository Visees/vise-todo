# DESIGN.md — Todo

## Direction: "registro operativo"

The same look as the Edicola super admin (`app_localnews_2026/apps/admin/DESIGN.md`), which follows Enginy: a light, dense and quiet console. Personality comes from three things only: the red brand mark, the black primary button, and the toolbar pills.

## Themes

The sidebar footer has three choices: **System** (default, follows `prefers-color-scheme`), **Light** and **Dark**. The choice is stored in `localStorage` (`todo-theme`) and becomes the `dark` class on `<html>`. A small script in `index.html` applies it before the first paint (`ThemeService`).

Components use only the semantic tokens in `src/styles.css` (`bg-background`, `text-muted-foreground`, `bg-ok-surface`…), so **no `dark:` variants** appear in components. Spartan's own variables (`--primary`, `--border`…) are set to the same palette, so the generated components inherit the look.

## Tokens

| Role | Light | Dark |
|---|---|---|
| Page, cards | `#ffffff` | `#0f0f11` |
| Sidebar, columns, table heads (`subtle`) | `#fafafa` | `#141416` |
| Borders | `#e4e4e7`, hover `#a1a1aa` | `#2c2c31`, hover `#4e4e56` |
| Text | `#18181b` titles · `#27272a` body · `#71717a` secondary | flipped by role |
| Primary button | `#18181b` with white text | `#f4f4f5` with dark text (on purpose) |
| Brand | `#dc2626`, only the logo mark | same |
| Link | `#2563eb` | `#3b82f6` |
| Status | tint surface, tint border, dark tint text: `ok` emerald · `wait` amber · `late` red · `neutral` grey | veils of the tint, light text |

- **Font:** Inter Variable, self-hosted (`@fontsource-variable/inter`). Tabular figures on dates and counts.
- **Scale:** page title `text-xl font-semibold`; section titles `text-sm font-semibold`; cards and table text 13px; labels `text-xs`.
- **Radii:** 6px for controls and cards (`rounded-md`), 8px for frames and columns (`rounded-lg`).
- **Shadows:** only `shadow-xs` (buttons, pills, cards, the active sidebar item); `shadow-lg` only on the card being dragged.
- **Motion:** colour transitions, plus the CDK sort animation (200ms). `prefers-reduced-motion` turns them off.

## Recognisable moves

1. **Shell:** grey sidebar with small group labels; the active item is a white "sheet" with a border and a light shadow. A top bar shows the path `Tasks / Board`. Below `md` the sidebar becomes a drawer.
2. **Board:** three grey columns on a white page; white cards with a 1px border. While dragging, the drop spot is a dashed outline and the column receiving the card darkens slightly.
3. **Toolbar pills** (`.pill`): "Label Value ▾", highlighted (`.pill-active`) when the filter is set.

## Rules

- Status is always text + colour (badge), never colour alone.
- Colours come only from the tokens: no hex values in component classes or inline styles, which would not follow the theme.
- Every drag action also has a keyboard path (Alt + arrows) and is announced in a polite live region.
- Inputs are 40px tall on phones (touch) and 36px from `md` up.
- On phones the columns stack; the page must never scroll sideways.
