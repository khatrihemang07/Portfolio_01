# Portfolio

A single-page personal site for Hemang Khatri that shows their own work to recruiters, freelance clients and anyone curious. Work comes first, with one call to action.

## Language

**Site**:
The whole public portfolio: one page made of the Hero, the Work section, the About section and the Contact section.
_Avoid_: Website, app, portfolio page

**Project**:
A piece of the owner's own work that is public and shown on the Site. Private or third-party repos are never Projects.
_Avoid_: Repo, app, case study

**Featured Project**:
A Project chosen to appear in the Work section. Currently Markuli, Mnemora and localAIWrapper.
_Avoid_: Highlight, top project

**Project Block**:
The Work-section entry for one Featured Project: a full-width glass block. On wide screens its top band holds the name, with its stack line as a subheader under it, and the one-line pitch beside it on the same row. Under that, one row holds the Download and Source buttons with the four Facts beside them. Below sit the tabbed text (Story, Features, Under the hood), whose height never changes when switching tabs, and a Gallery. The Gallery sits on one side and swaps sides from one Project Block to the next.
_Avoid_: Card, tile, panel, thumbnail

**Gallery**:
The swipeable row of Slides inside a Project Block, with previous and next buttons and dots.
_Avoid_: Carousel, slider, lightbox

**Slide**:
One image in a Gallery together with its one-line caption. Each Slide has a light and a dark version of its image, and the one matching the visitor's current theme is shown; a Slide without a light version shows the dark one in both themes. Each Project Block has one to five.
_Avoid_: Screenshot, thumbnail, frame

**Dock**:
The floating navigation pill at the bottom of the Site, with a highlight that slides to the current section and a theme toggle. It is the only navigation on small screens.
_Avoid_: Side Nav, sidebar, menu, header

**Dock Tooltip**:
The small label pill that appears above a Dock item on hover or keyboard focus, naming it ("Work", "Theme"). The current item shows its label inline instead.
_Avoid_: Popover, title attribute

**Aurora**:
The soft multicolour glow behind the whole Site, one fixed layer that never moves or animates. The Hero and Contact text sit directly on it; Project Blocks and the About panel are translucent glass over it. The Site has no tile grid.
_Avoid_: Background, gradient, mesh

**Ruler**:
The slim row of ticks on the right edge of the Site, one per section and one per Featured Project, with the current tick stretched and labelled. Hidden on small screens.
_Avoid_: Scrollbar, progress bar, side nav

**Hero Chip**:
A small quiet pill under the Hero's Call to Action stating one fact about the owner's work (the stack: Rust, Go, TS and AI). It must never outweigh the name and intro. Replaces the earlier large Stat Tiles.
_Avoid_: Stat Tile, badge, counter, widget

**Hero Showcase**:
The deck of three cards in the right half of the Hero, one per Featured Project. Each card shows the project's name, its stack line and the first Slide's image, and links to that Project's Project Block. The Markuli card is in front.
_Avoid_: Hero image, collage, carousel

**Fact**:
A concrete, checkable claim on a Project Block, such as a size or a measured resource use. Each Project Block has four.
_Avoid_: Stat, metric, bullet

**Showcase Image**:
The picture in a Slide, captured from the real Project running with demo data, never with the owner's real data.
_Avoid_: Screenshot, thumbnail, hero image

**Demo Data**:
Throwaway, realistic content seeded into a Project only to make its Showcase Image look lived-in.
_Avoid_: Mock data, fixtures, real data

**Call to Action**:
The single contact prompt: "available for work and projects". It covers hiring and freelance alike.
_Avoid_: CTA button, hire me, freelance section

**Timeline**:
Three plain lines in the About section naming current employer and two schools, with no metrics.
_Avoid_: Experience section, résumé
