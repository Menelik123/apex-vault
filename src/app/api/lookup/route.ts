import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function lookupWithClaude(upc: string) {
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content: `A sneaker box has this UPC barcode: ${upc}

If you recognize this UPC or can identify the shoe from it, return the shoe details as JSON.
If you don't recognize the exact UPC, return null.

Return ONLY a JSON object or null:
{"brand": "Nike", "model": "Air Jordan 4 Retro", "colorway": "Military Black", "size": "10", "styleID": "DH6927-111"}`,
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text.trim() : "null";
  if (text === "null" || !text.includes("{")) return null;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  return JSON.parse(jsonMatch[0]);
}

export async function GET(req: NextRequest) {
  const upc = req.nextUrl.searchParams.get("upc");

  if (!upc) {
    return NextResponse.json({ error: "UPC required" }, { status: 400 });
  }

  // Try Barcode Spider first
  const key = process.env.BARCODE_SPIDER_KEY;
  if (key) {
    try {
      const res = await fetch(
        `https://api.barcodespider.com/v1/lookup?token=${key}&upc=${upc}`,
        { headers: { "Cache-Control": "no-cache" } }
      );

      if (res.ok) {
        const data = await res.json();
        const attrs = data?.item_attributes;
        const code = String(data?.item_response?.code ?? "");
        const status = data?.item_response?.status ?? "";
        const found = code === "200" || status === "OK" || (attrs && attrs.title);

        if (attrs && found) {
          const title: string = attrs.title || "";
          const brand: string = attrs.brand || attrs.manufacturer || "";
          const model = brand && title.toLowerCase().startsWith(brand.toLowerCase())
            ? title.slice(brand.length).trim()
            : title;

          return NextResponse.json({ brand, model, colorway: attrs.color || "", size: attrs.size || "", image: attrs.image || "" });
        }
      }
    } catch {
      // Fall through to Claude
    }
  }

  // Fall back to Claude
  try {
    const result = await lookupWithClaude(upc);
    if (result && result.brand) {
      return NextResponse.json(result);
    }
  } catch {
    // Fall through to not found
  }

  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
