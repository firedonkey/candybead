# Candy Bead Project Handoff

Generated: 2026-08-02  
Repository: `/Users/gary/candybead`  
GitHub remote: `git@github.com:firedonkey/candybead.git`  
Active branch: `redesign`  
Latest committed change at handoff start: `1f1e6ce Refine Candy Bead wordmark and story collage`

## Project Summary

Candy Bead is a Shopify storefront built on the Horizon theme. The work completed so far turns the default storefront into a more premium jewelry brand experience with editorial storytelling, cleaner merchandising, mood-based navigation, a dedicated Contact page, and a dedicated Our Story page.

Primary constraints followed throughout:

- Do not modify checkout or cart functionality.
- Do not alter prices, inventory, orders, customers, or product descriptions unless explicitly approved.
- Keep important homepage/page content editable through Shopify Theme Editor.
- Reuse Shopify products and collections rather than hard-coding product IDs.
- Keep `.env`, Admin API secrets, and access tokens out of Git.

## Shopify Environment

Store:

- Admin/store domain: `3x2tdq-nn.myshopify.com`
- Public domain: `https://www.candybead.com`

Themes last verified by `shopify theme list`:

- Live: `Candy Bead Premium Homepage`, theme ID `192411762869`
- Development/current: `Development (244d9c-Amys-MacBook-Air)`, theme ID `192411238581`
- Unpublished original: `Horizon`, theme ID `191467290805`

The latest wordmark and Our Story collage changes were pushed to the live theme before this handoff. This handoff file itself has not been published or committed unless done separately after creation.

## Architecture

This repo follows Shopify theme structure:

- `layout/`: top-level Liquid layouts.
- `templates/`: Shopify JSON templates for homepage, collection, contact, and story pages.
- `sections/`: configurable Liquid sections, including the custom premium sections.
- `blocks/`: Horizon block implementations and customized header/product blocks.
- `snippets/`: reusable Liquid/CSS helpers and theme variables.
- `assets/`: JS, CSS, fonts, SVGs, and image assets.
- `config/`: Theme Editor schema and current settings data.
- `scripts/shopify/`: Node automation for Shopify Admin GraphQL setup.
- `locales/`: Shopify translation files.

There is no `package.json` or local JS test harness. Validation is mainly through Shopify CLI:

```sh
shopify theme check
shopify theme dev --store 3x2tdq-nn.myshopify.com --theme 192411238581 --host 127.0.0.1 --port 9292 --live-reload off
```

Publishing should only happen when explicitly approved:

```sh
shopify theme push --store 3x2tdq-nn.myshopify.com --theme 192411762869 --allow-live --strict
```

Do not use `shopify theme publish` on the development theme. Shopify rejects publishing development themes. To update public production, push the exact local state to the live theme ID with `--allow-live`.

## Completed Work

### Homepage

Homepage template: `templates/index.json`

Current section order:

1. `premium-jewelry-hero`
2. `premium-product-showcase` for New Arrivals
3. `premium-mood-grid` for Shop by Mood
4. `premium-brand-story` for Our Story teaser
5. `premium-product-showcase` for Best Sellers
6. `premium-newsletter`

Removed or intentionally omitted homepage areas:

- Generic "Join our email list" footer-style section.
- "Service details that make gifting easier".
- "Considered from bead to box", pending better packaging photography.

Important anchors:

- `#shop-by-mood` exists on the mood grid.
- `#our-story` exists on the homepage brand story section.

### Homepage Our Story Collage

Section: `sections/premium-brand-story.liquid`

The old media layout used one large image plus one small accent image. It now renders an editorial 4-card layered image collage with:

- Four editable image pickers: `image_1`, `image_2`, `image_3`, `image_4`
- Four optional alt text settings.
- Legacy `image` and `accent_image` retained as fallbacks for existing saved content.
- Collection/product-image fallback if custom images are blank.
- CSS handling for 1, 2, 3, or 4 available images.
- Mobile 2-column overlapping composition with no horizontal overflow at 375, 390, and 430 px.

The copy, CTA, and `id="our-story"` anchor were preserved.

### Header And Wordmark

Files:

- `blocks/_header-logo.liquid`
- `config/settings_schema.json`
- `config/settings_data.json`
- `snippets/fonts.liquid`
- `snippets/theme-styles-variables.liquid`

The text wordmark "Candy Bead" now uses Shopify's native font system with a dedicated setting:

- Setting ID: `type_logo_wordmark_font`
- Default: `playfair_display_n6`
- Desktop size: `23px`
- Mobile size: `20px`
- Weight: `600`
- Letter spacing: `-0.02em`
- Style: normal, not italic

Navigation remains on the existing sans-serif menu font variables.

### Collection Pages

Files:

- `templates/collection.json`
- `sections/main-collection.liquid`

Collection pages were polished to better match the premium storefront:

- Warm collection heading band.
- Cleaner product grid spacing.
- Product imagery contained against a light surface.
- Product price duplication was removed by using a single price block in the collection product-card template.

### Contact Page

Files:

- `templates/page.contact.json`
- `sections/premium-contact-page.liquid`

The Contact page at `/pages/contact` was redesigned as an editorial customer-contact page while preserving Shopify's native contact form behavior. The section exposes copy, image, form labels, success message, and help items through Theme Editor.

### Our Story Page

Files:

- `templates/page.our-story.json`
- `sections/premium-story-intro.liquid`
- `sections/premium-story-chapter.liquid`
- `sections/premium-story-statement.liquid`

A dedicated page exists at `/pages/our-story` and uses the `page.our-story` template. The page includes:

- Editorial intro.
- Original design chapter.
- Handmade chapter.
- Individual character chapter.
- Shop by Mood section.
- Final brand statement with All Bracelets CTA.

Admin note: the Shopify Page record had to be created through the logged-in Shopify Admin UI because the existing app scopes did not include page/content write scopes.

### Shopify Collections And Navigation

Mood metafield:

- Namespace/key: `custom.mood`
- Type: `list.single_line_text_field`

Collections set up or verified:

- `new-arrivals`
- `best-sellers`
- `all-bracelets`
- `everyday-shine`
- `color-ritual`
- `gift-ready`
- `evening-polish`

Known collection behavior:

- `New Arrivals`: automatic membership by product tag `new-arrival`.
- `All Bracelets`: automatic membership by product type `Bracelet`.
- `Best Sellers`: automatic membership by product type `Bracelet`, sort order `BEST_SELLING`.
- Mood collections depend on `custom.mood` metafield values.

Existing catalog was normalized so the current products use `productType = Bracelet` when approved. Mood values were not automatically assigned to products.

Main Menu was updated in Shopify Admin to:

```text
Home -> /
Shop -> /collections/all-bracelets
  New Arrivals -> /collections/new-arrivals
  Best Sellers -> /collections/best-sellers
  Shop by Mood -> /#shop-by-mood
    Everyday Shine -> /collections/everyday-shine
    Color Ritual -> /collections/color-ritual
    Gift Ready -> /collections/gift-ready
    Evening Polish -> /collections/evening-polish
  All Bracelets -> /collections/all-bracelets
Our Story -> /#our-story
Contact -> existing Contact page
```

Footer and customer menus were not intentionally modified.

## Shopify Automation Scripts

Scripts:

- `scripts/shopify/setup-mood-collections.mjs`
- `scripts/shopify/setup-shopping-collections.mjs`

Common behavior:

- Use Shopify Admin GraphQL API `2026-07`.
- Load local `.env`.
- Use client credentials OAuth flow at `/admin/oauth/access_token`.
- Never print or store access tokens.
- Default to dry-run unless `--apply` is passed.
- Query current state before mutating.
- Designed to be idempotent.

Example dry runs:

```sh
node scripts/shopify/setup-mood-collections.mjs --dry-run
node scripts/shopify/setup-shopping-collections.mjs --dry-run
```

Apply only with explicit approval:

```sh
node scripts/shopify/setup-mood-collections.mjs --apply
node scripts/shopify/setup-shopping-collections.mjs --apply
```

Security:

- `.env` contains `SHOPIFY_SHOP`, `SHOPIFY_CLIENT_ID`, and `SHOPIFY_CLIENT_SECRET`.
- `.env` is ignored by `.gitignore`.
- Do not print, paste, log, or commit `.env` contents.
- Do not store Admin API access tokens in Git.

Known scopes from the setup work:

- `read_products`
- `write_products`
- `read_online_store_navigation`
- `write_online_store_navigation`

Do not assume page/content write scopes are available.

## Design Decisions

Visual language:

- Premium jewelry storefront rather than a generic Shopify template.
- Editorial storytelling inspired by Ffern.
- Clean ecommerce merchandising inspired by Pandora.
- Warm ivory and off-white backgrounds.
- Near-black text.
- Dusty rose accent.
- Pale sage and soft neutrals where needed.
- Subtle borders and soft shadows.
- Minimal rounded corners, generally 0-2 px for editorial cards.

Typography:

- Product/navigation/body UI stays sans-serif, currently Inter through Theme Editor settings.
- Editorial headings use local Spectral font files already in `assets/`.
- Header wordmark uses Playfair Display through Shopify's native font picker/font loading.

Content strategy:

- Avoid unverified claims about sourcing, sustainability, warranties, production location, business age, charitable giving, or shipping speed.
- Use factual brand claims only: original designs, designed by the brand, handmade, assembled by hand.
- Keep merchant-editable content in section schema wherever practical.

Merchandising strategy:

- Prefer real Shopify collections and product images.
- Use collection pickers and fallback collection handles.
- Avoid hard-coded product IDs.
- Best Sellers contains bracelet products and relies on Shopify `BEST_SELLING` sort order.

## Coding Conventions

- Keep changes scoped to the relevant Liquid section/template/snippet.
- Use section-scoped CSS selectors like `.premium-section-{{ section.id }}` to avoid global bleed.
- Prefer Shopify `image_url` and `image_tag` with responsive `widths` and `sizes`.
- Expose merchant-facing text, images, colors, spacing, links, and collection choices in section schemas.
- Preserve Horizon's existing blocks and snippets where possible.
- Do not edit cart, checkout, account, product data, app integrations, or order/customer flows unless explicitly approved.
- Run `shopify theme check` before handoff or publishing.
- Run `git diff --check` before committing.
- Treat JSON templates and `config/settings_data.json` as Theme Editor managed files. Admin edits may overwrite local JSON settings.

## Important Files

Homepage and premium sections:

- `templates/index.json`
- `sections/premium-jewelry-hero.liquid`
- `sections/premium-product-showcase.liquid`
- `sections/premium-mood-grid.liquid`
- `sections/premium-brand-story.liquid`
- `sections/premium-newsletter.liquid`

Pages:

- `templates/page.contact.json`
- `sections/premium-contact-page.liquid`
- `templates/page.our-story.json`
- `sections/premium-story-intro.liquid`
- `sections/premium-story-chapter.liquid`
- `sections/premium-story-statement.liquid`

Header/navigation:

- `blocks/_header-logo.liquid`
- `blocks/_header-menu.liquid`
- `snippets/header-drawer.liquid`
- `sections/header-group.json`

Fonts and global theme variables:

- `layout/theme.liquid`
- `snippets/fonts.liquid`
- `snippets/theme-styles-variables.liquid`
- `config/settings_schema.json`
- `config/settings_data.json`
- `assets/spectral-light.ttf`
- `assets/spectral-regular.ttf`

Collections:

- `templates/collection.json`
- `sections/main-collection.liquid`

Automation:

- `scripts/shopify/setup-mood-collections.mjs`
- `scripts/shopify/setup-shopping-collections.mjs`

Images/assets:

- `assets/newsletter-bracelet-lifestyle.jpg`

## Known Issues And Operational Notes

- Command-line `curl` requests to `https://www.candybead.com` may return HTTP `429`. Browser verification has been more reliable for public storefront checks.
- Shopify CLI auto-upgraded locally from `4.5.2` to `4.6.0` while checking the theme list during this handoff. Theme commands completed successfully after upgrade.
- No local package-based automated tests exist.
- Some visual validation depends on Shopify theme preview or the public storefront.
- Theme Editor or Admin changes can modify `templates/*.json` and `config/settings_data.json`; pull or compare remote state before heavy local edits if the merchant has been editing in Admin.
- The Our Story page template exists in Git, but the page record itself is Shopify Admin data and is not represented as a theme file.
- Mood collections will remain empty or incomplete until products receive matching `custom.mood` metafield values.
- The packaging/box storytelling section was intentionally removed until premium packaging imagery exists.

## Validation History

Recent validation results:

- `shopify theme check`: passed with `336 files inspected with no offenses found`.
- `git diff --check`: passed before recent commits.
- Live homepage after publish showed:
  - Wordmark using `"Playfair Display", serif`.
  - Wordmark size `23px` on desktop.
  - Homepage Our Story rendered 4 collage cards.
  - CTA points to `/pages/our-story`.
  - No horizontal overflow detected.
- Development preview checked at `1440`, `1024`, `430`, `390`, and `375` px for the Our Story collage with no horizontal overflow and no broken images.

## Pending Tasks

High priority:

1. Add final merchant-selected photography for homepage hero, Our Story collage, Contact page, Our Story page chapters, and newsletter.
2. Assign `custom.mood` metafield values to products when the merchant is ready to curate mood membership.
3. Review the public storefront manually on real mobile devices, especially header/menu, homepage hero, collage, product grids, and contact form.
4. Confirm all main menu dropdown behavior on desktop and mobile after any future Shopify Admin menu edits.
5. Add policy/customer-service content only when the merchant has approved facts for shipping, returns, warranty, and response times.

Medium priority:

1. Add packaging or "from bead to box" section once premium box photography is available.
2. Improve collection descriptions for SEO and merchandising.
3. Add alt text for all merchant-uploaded editorial images.
4. Add metadata/SEO descriptions for Contact and Our Story pages in Shopify Admin.
5. Build a lightweight manual QA checklist for each publish.

Lower priority:

1. Consider adding an unpublished staging theme workflow if multiple people edit the theme.
2. Consider adding a small Node-based visual smoke test setup if the project starts receiving frequent design changes.
3. Audit page speed after final photography is uploaded.

## Next Recommended Work Sequence

1. Pull latest Git changes on `redesign`.
2. Confirm no merchant made conflicting Theme Editor edits since the last push.
3. Replace fallback product imagery in editable image pickers with final brand photography.
4. Run `shopify theme check`.
5. Run `shopify theme dev` against development theme `192411238581`.
6. Check homepage, Contact, Our Story, and key collections at desktop, tablet, and mobile widths.
7. Push to live theme `192411762869` only after explicit approval.
8. Commit and push the exact published state to GitHub.

