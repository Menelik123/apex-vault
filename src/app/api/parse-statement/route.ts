import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY is not configured in environment variables." }, { status: 500 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "File too large. Please upload a file under 10MB." }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const base64 = buffer.toString("base64");
    const isPDF = file.type === "application/pdf" || file.name.endsWith(".pdf");
    const isCSV = file.type === "text/csv" || file.name.endsWith(".csv");

    let textContent = "";

    if (isCSV) {
      textContent = buffer.toString("utf-8");
    }

    const prompt = `You are a professional bookkeeper specializing in sneaker resellers, streetwear shops, and small retail businesses. Analyze this bank statement and categorize every single transaction with high accuracy.

${isCSV ? `Here is the raw bank statement data:\n\n${textContent}` : "Analyze the attached bank statement document."}

CATEGORIZATION RULES — follow these exactly:

**Sales Income** (credits/deposits):
- Cash App, Venmo, Zelle, PayPal deposits = Sales Income (resellers get paid this way)
- StockX payouts, GOAT payouts, eBay payouts = Sales Income
- Any direct deposit labeled as payment or transfer in = Sales Income
- Square, Shopify, Clover payouts = Sales Income

**Inventory** (debits — buying product to resell):
- Any purchase at: Nike, Adidas, Jordan, Foot Locker, Finish Line, SNKRS, Champs, Dick's, Hibbett, DSW, Stadium Goods, Flight Club, Kith, Palace, Supreme, Concepts, Union, Fear of God, Off-White
- Any purchase with keywords: sneaker, shoe, kicks, retail, resell, stock
- GOAT or StockX charges (buying side)
- Any payment to another individual that looks like a shoe purchase

**Shipping & Fulfillment**:
- USPS, UPS, FedEx, DHL, Pirateship, Shippo, EasyPost
- Any charge with "shipping", "postage", "label", "freight"

**Platform Fees**:
- StockX seller fees, GOAT seller fees, eBay final value fees
- PayPal transaction fees
- Square fees, Stripe fees, Shopify fees

**Food & Dining**:
- Restaurants, fast food, cafes, food delivery (DoorDash, Uber Eats, GrubHub, Instacart)
- Chick-fil-A, McDonald's, Chipotle, Wingstop, Dominos, Subway, etc.

**Gas & Transportation**:
- Gas stations: Shell, BP, Chevron, Exxon, Circle K, QuikTrip, Wawa
- Uber, Lyft, tolls, parking

**Rent & Utilities**:
- Rent payments, mortgage, storage units
- Electric, water, gas utility, internet, phone bill (AT&T, Verizon, T-Mobile)

**Marketing & Advertising**:
- Meta Ads, Facebook Ads, Instagram Ads, Google Ads, TikTok Ads
- Canva, Adobe, Printful

**Software & Tools**:
- Shopify, GoHighLevel, Supabase, Vercel, AWS, Google Workspace
- Any SaaS subscription

**Cash App / Venmo / Zelle Transfers** (when purpose is unclear):
- P2P transfers where you can't tell if it's income or expense — put in this category and flag it

**Personal**:
- Clothing stores not related to resell inventory
- Entertainment, streaming (Netflix, Spotify, Apple)
- Personal care, gym, health

**Other Business**:
- Anything business-related that doesn't fit above

IMPORTANT RULES:
1. Every single transaction must be categorized — do not skip any
2. Separate income (credits) from expenses (debits) accurately
3. Cash App/Venmo/Zelle/PayPal require careful analysis — look at descriptions and amounts to determine if it's income or inventory purchase
4. If a transaction could be inventory, categorize it as Inventory (gives tax benefit)
5. Use the exact merchant name from the statement as the description

Return ONLY a valid JSON object with this exact structure:
{
  "summary": {
    "totalIncome": number,
    "totalExpenses": number,
    "netCashFlow": number,
    "dateRange": "string describing the date range",
    "transactionCount": number
  },
  "categories": [
    {
      "name": "Category Name",
      "total": number,
      "count": number,
      "isIncome": true or false,
      "transactions": [
        {
          "date": "YYYY-MM-DD",
          "description": "exact merchant/description from statement",
          "amount": number,
          "type": "debit" or "credit"
        }
      ]
    }
  ]
}

Sort income categories first, then expense categories by total amount descending. Include ALL transactions without exception.`;

    let response;

    if (isPDF) {
      response = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 8192,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: {
                  type: "base64",
                  media_type: "application/pdf",
                  data: base64,
                },
              },
              { type: "text", text: prompt },
            ],
          },
        ],
      });
    } else {
      response = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 8192,
        messages: [{ role: "user", content: prompt }],
      });
    }

    const text = response.content[0].type === "text" ? response.content[0].text : "";

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: "Could not parse statement" }, { status: 500 });
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return NextResponse.json(parsed);
  } catch (err) {
    console.error("Parse error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Failed to parse statement: ${message}` }, { status: 500 });
  }
}

