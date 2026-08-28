# Relay — WebMCP marketplace demo

## Use cases

WebMCP lets an external agent such as Codex operate the marketplace through structured tools while the ordinary website remains the shared context. For example, Codex can:

- Turn a natural-language request into a complex custom filter or personalized ranking, such as finding enthusiast-owned guitars under a budget with reassuring seller signals
- Compare listing details, prices, locations, seller voice, and price stance across a set of results
- Build and refine shortlists by saving items and organizing them into collections
- Draft and send a focused question to a seller about condition, history, included items, or availability
- Start a negotiation by sending an offer and continuing the conversation in the marketplace workflow
- Clear or revise a custom view as the user's priorities change

Relay is a project to demonstrate WebMCP capabilities for marketplaces: a polished second-hand marketplace that remains a normal website for people while exposing structured actions to a user's external agent.

The page is the shared context. An agent such as Codex can discover and operate marketplace tools for searching, filtering, saving, messaging, and making offers through WebMCP. There is no built-in assistant experience in the interface.

## What the demo includes

- 120 curated listings across cars, guitars, and pianos
- Seller-voice descriptions, price signals, locations, details, and source links
- Search, category filtering, price filtering, and sorting
- Listing details with favorites, collections, seller messages, and offers
- Intentionally empty categories for laptops, bikes, books, and kids' items
- A quiet footer explanation of the WebMCP connection

## WebMCP tools

The app registers marketplace actions through `document.modelContext.registerTool` when the browser provides a WebMCP model context.

Available tools include:

- `search_listings` and `get_listing`
- `apply_custom_view` and `clear_custom_view`
- `set_favorite`, `create_collection`, `add_to_collection`, and `get_collection`
- `send_message`, `get_conversation`, and `make_offer`

These tools update the same interface a person sees, so external agent actions remain visible and reviewable in the marketplace UI.

## Run locally

Install the frontend dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Create a production build:

```bash
npm run build
```

## Project structure

- `src/main.tsx` — React app, marketplace interactions, and WebMCP tool registration
- `src/styles.css` — visual system and responsive layout
- `src/data/listings.json` — listing data used by the app
- `public/images/listings/` — listing photography
- `public/images/background/` — marketplace background imagery
- `public/images/inspiration/` — visual reference assets

## Data boundaries

The demo uses a fixed local dataset and local image assets. It does not create additional listings, connect to a live marketplace, or include a built-in conversational assistant.
