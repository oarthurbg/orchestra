# orchestra brand

<img alt="orchestra mark" src="../assets/brand/mark.svg" width="96">

**Many voices. One composition.**

## The mark

Four flat shapes on a 100-unit grid, after the Bauhaus. Kandinsky and Itten paired the basic shapes with the primary colors (circle blue, square red, triangle yellow), and the mark keeps that pairing:

- **Circle**, cobalt: sits on the half circle.
- **Half circle**, pale blue: the ground the others rest on, from the circle's family. Kandinsky wrote about color the way a composer writes about pauses; this is the rest.
- **Rectangle**, vermilion.
- **Triangle**, saffron: the downbeat.

Geometry (in `assets/brand/mark.svg`), inside the square from (10, 10) to (90, 90): half circle `M10 90 A 27 27 0 0 1 64 90 Z`, circle at (34, 34) radius 24, rectangle at (62, 10) 28 by 42, triangle (66,90) (90,90) (78,56). The half circle is wider than the circle, and the triangle is big enough to read at 16 px.

## Colors

| Name | Hex | Use |
| --- | --- | --- |
| Cobalt | `#2450E0` | Circle; "full" mode |
| Vermilion | `#F0442C` | Rectangle; "ultra" mode; links and accents (`#C8341B` for small text on paper) |
| Saffron | `#FFC21A` | Triangle; "lite" mode |
| Pale blue | `#B9C8F2` | Half circle, on light and dark backgrounds; "off" mode |
| Ink | `#111114` | Text |
| Black | `#000000` | Dark background |
| Paper | `#FAF8F3` | Light background; text on dark |

On dark backgrounds only the wordmark changes, to paper. The half circle stays pale blue: the deep blue it used before (`#26335E`) disappeared on dark backgrounds. The dark background is true black, chosen over ink in a live preview of the liveview dashboard.

## Type

- **Wordmark:** "orchestra", always lowercase, Archivo ExtraBold (800), tight tracking (-0.02em).
- **Headings:** Archivo. **Body:** IBM Plex Sans. **Code:** IBM Plex Mono. All are open-licensed (SIL OFL) Google Fonts.

## Ponytail modes as shapes

The docs page marks each ponytail mode with one shape: **full** is the circle, **lite** the triangle, **ultra** the square, **off** the half circle (the rest).

## Files

| File | Size | Where it shows |
| --- | --- | --- |
| `assets/brand/mark.svg`, `mark-dark.svg` | vector | Source for everything else |
| `plugins/orchestra/.claude-plugin/icon.png` | 1024 px | Claude Code `/plugin` listing |
| `docs/favicon.svg` | vector | Docs page tab |
| `assets/brand/readme-hero-light.png`, `-dark.png` | 2560 by 800 | README, by GitHub theme |
| `assets/brand/social-preview.png` | 1280 by 640 | Link cards; upload under repo Settings, Social preview |

## Using the name and logo

The orchestra name and logo are not covered by the Apache License that covers the code. You may:

- use them unmodified to refer to orchestra, for example in an article, a talk, a list of tools or a link to this repository;
- show the plugin icon wherever Claude Code or a marketplace lists the plugin.

You may not use them, or anything confusingly similar, as the name or logo of a fork, a derivative product or a service, or in a way that suggests the project endorses you. A fork is welcome under the Apache License; give it its own name and mark.

## Do

- Keep the four shapes, their arrangement and their colors together.
- Give the mark clear space of at least a quarter of its width.
- Use the dark version (paper wordmark) on dark backgrounds.

## Don't

- Recolor, rotate or rearrange the shapes, or add new ones.
- Set the wordmark in capitals or another typeface.
- Put the mark on busy photos or on saturated color fields.
