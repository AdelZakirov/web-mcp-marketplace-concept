# Relay — WebMCP marketplace demo

## Use cases

WebMCP lets an external agent such as Codex operate the marketplace through structured tools while the ordinary website remains the shared context. For example, Codex can:

- Turn a natural-language request into a complex custom filter or personalized ranking, such as finding enthusiast-owned guitars under a budget with reassuring seller signals. You tell your agent what you want, it makes sure you see it on the page.
- Compare listing details, prices, locations, seller voice, and price stance across a set of results - you agent easily get the info and processes it.
- Build and refine shortlists by saving items and organizing them into collections - just tell your agent what collection do you want.
- Draft and send a focused question to a seller about condition, history, included items, or availability - agent can write multiple messages at once, continue converstations for you, negotiate.
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

- `search_listings` and batched `get_listings`
- `apply_custom_view` and `clear_custom_view`
- `set_favorite`, `create_collection`, `add_to_collection`, and `get_collection`
- `send_message`, `get_conversation`, and `make_offer`

These tools update the same interface a person sees, so external agent actions remain visible and reviewable in the marketplace UI. Every tool call also enters a visible WebMCP activity lifecycle:

- Search can return compact results or include descriptions, highlights, and detailed fields in the same call. When more records are needed, `get_listings` reads up to 20 listings at once.
- Search and custom-view tools open the marketplace results and reflect their query, filters, sorting, ranking, or annotations.
- Intermediate listing reads stay in the background and appear only in the activity dock, avoiding modal churn while the agent evaluates candidates. Explicit comparisons still open the comparison surface.
- Favorite and collection actions open the affected Saved section.
- Conversation reads, messages, and offers open Messages. A user request to write or send is treated as authorization: direct agent messages and offer notes stream through the composer and send one by one without a second confirmation.
- Seller replies are intentionally asynchronous: sellers pause, visibly type, and then answer from varied intent-aware response pools instead of returning one immediate canned response.
- A compact activity dock shows the current action and recent accepted actions. It can be hidden and restored, and the preference persists.
- Read and organization calls acknowledge immediately. Message and offer calls remain active until their ordered browser playback finishes, ensuring the user sees every streamed draft and sequential send.

The integration does not use browser clicking or DOM automation. External actions enter through tools registered with `document.modelContext`, and those tool handlers deliberately drive the visible React UI. Lightweight proxy tools register before React mounts; React binds them to the live application handlers during layout initialization.

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
