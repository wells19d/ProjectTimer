# Project Timer icon

Approved clock and play/pause artwork, generated with the built-in image generation tool. The original raster and transparent alpha are preserved in `project-timer.png`. `project-timer.icns` contains the standard macOS icon sizes, resized with `sips` and packaged into an ICNS container with JavaScript by `scripts/build-icon.js`.

The source PNG is used for the Dock icon when launching with `yarn start`. The packaged application uses the ICNS file for Finder and the Dock. `yarn build:mac` regenerates the ICNS, bundles both assets, and signs the app with the icon included.

## Generation prompt

```text
Use case: logo-brand. Asset type: single polished macOS desktop application icon for a small offline Project Timer widget. Primary request: a clock with a start/pause overlay. Composition: one centered icon, square 1024 by 1024 canvas, generous transparent padding outside a rounded-square charcoal graphite tile. On the tile, a large simple warm ivory analog clock face with bold dark hour and minute hands, a few understated tick marks, no numerals. One compact sage-green rounded control badge overlaps the lower-right of the clock, bearing an unmistakable dark play triangle beside two pause bars. Match a restrained dark charcoal and pale sage-green timer application, soft dimensional macOS-style material and subtle bevel, crisp contours, very clean silhouette and strong contrast recognizable at 32 pixels. Straight-on view, balanced, no perspective. Actual transparent background outside the rounded-square tile, preserve alpha. No text, no letters, no watermark, no extra elements, no surrounding scene, not an icon sheet, not a mockup.
```
