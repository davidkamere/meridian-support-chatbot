# Meridian Support Chatbot

A Vercel-friendly Next.js prototype for Meridian Electronics' public catalog assistant.

## Phase 1 scope

- Browse catalog by category
- Search products by keyword
- Check SKU details and availability

This first version intentionally exposes only the public catalog tools from the Meridian MCP server:

- `list_products`
- `search_products`
- `get_product`

The chat route uses OpenRouter tool calling so the model decides when to use each public tool.

## Run locally

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

## Environment

Copy `.env.local.example` to `.env.local`:

```bash
cp .env.local.example .env.local
```

Required environment variables:

- `MERIDIAN_MCP_URL`
- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL` such as `openai/gpt-4o-mini`

## Deploy to Vercel

- Import the repo into Vercel
- Set `MERIDIAN_MCP_URL`
- Deploy
