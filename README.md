# Apex Vault

Inventory and profit tracking for sneaker resellers and shoe plugs. It replaces the spreadsheet.

## What it does
- **Inventory:** brand, model, colorway, size, condition, cost, asking price, UPC, photos, barcode scanner, bulk add, CSV import
- **AI shoe search and UPC lookup:** type a shoe name or scan a barcode and the details fill in
- **Sales tracking:** mark items sold, record the sale price and channel (StockX, GOAT, eBay, Instagram, Personal)
- **Expenses:** log by category, export to CSV for taxes
- **Bank statement parser:** upload a statement and AI breaks the spending into categories. Combine multiple statements into one view.
- **P&L dashboard:** cost in, portfolio value, net profit, realized revenue
- **Accounts:** Supabase auth, so each reseller has their own private data

## Stack
Next.js (App Router) + TypeScript + Tailwind + shadcn/ui, Supabase (auth, Postgres, storage), Anthropic Claude API, deployed on Vercel.

## Setup

**1. Install**
```bash
npm install
```

**2. Create a Supabase project** at supabase.com. Then open **SQL Editor**, paste in everything from `supabase/schema.sql` and click Run. That creates the tables, the security rules and the `shoes` photo bucket.

**3. Add your keys**
```bash
cp .env.example .env.local
```
Fill in your Supabase URL and anon key (Project Settings > API) and your Anthropic API key.

**4. Run it**
```bash
npm run dev
```
Open http://localhost:3000, sign up, and you're in.

**5. Deploy (optional)**
Push to your own GitHub repo, import it on vercel.com, and add the same keys from `.env.local` under Environment Variables.

## Where things live
- `src/app/page.tsx`: landing page
- `src/app/login/`: sign in and sign up
- `src/app/dashboard/`: the main app (inventory, expenses, statements tabs)
- `src/app/api/search`, `api/lookup`: AI shoe search and UPC lookup
- `src/app/api/parse-statement`: bank statement parsing
- `src/components/`: add item, bulk add, CSV import, barcode scanner, statement parser
- `src/lib/supabase.ts`: Supabase client
