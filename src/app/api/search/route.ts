import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 15;
export const dynamic = "force-dynamic";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Fetch a shoe image thumbnail via DuckDuckGo (no API key required)
async function getShoeImage(query: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);

    try {
      // Step 1 — get vqd token from DDG
      const tokenRes = await fetch(
        `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
        { headers: { "User-Agent": UA }, signal: controller.signal }
      );
      const html = await tokenRes.text();
      const vqdMatch = html.match(/vqd=['"]?([\d-]+)['"]?/);
      if (!vqdMatch) return "";
      const vqd = vqdMatch[1];

      // Step 2 — fetch image results
      const imgRes = await fetch(
        `https://duckduckgo.com/i.js?q=${encodeURIComponent(query)}&o=json&vqd=${vqd}&f=,,,,,&p=1`,
        { headers: { "User-Agent": UA }, signal: controller.signal }
      );
      const data = await imgRes.json() as { results?: Array<{ thumbnail?: string }> };
      return data?.results?.[0]?.thumbnail || "";
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return "";
  }
}

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q");

  if (!query || query.length < 2) {
    return NextResponse.json({ results: [] });
  }

  try {
    // Step 1 — Claude identifies the shoes (handles typos, abbreviations, slang)
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `You are a sneaker database. The user is searching for: "${query}"

Even if the query has typos, abbreviations, or style codes, identify the best matching sneakers.
Examples: "jaw3" = Air Jordan 3, "sb dunk low" = Nike SB Dunk Low, "yzy slide" = Yeezy Slide, "AJ1 chicago" = Air Jordan 1 Chicago.

Return ONLY a valid JSON array of up to 5 results. Each object must have:
- name: full shoe name (e.g. "Air Jordan 3 Retro")
- brand: brand name (e.g. "Jordan", "Nike", "Adidas", "New Balance")
- colorway: colorway name (e.g. "Fire Red", "Panda", "Zebra")
- retailPrice: original retail price as a number (e.g. 200)
- styleID: style code / SKU if known (e.g. "CT8532-160"), empty string if unknown

Return ONLY the JSON array, no other text.`,
        },
      ],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text.trim() : "[]";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return NextResponse.json({ results: [] });

    const shoes = JSON.parse(jsonMatch[0]) as Array<{
      name: string;
      brand: string;
      colorway: string;
      retailPrice: number;
      styleID: string;
    }>;

    // Step 2 — fetch images for all results in parallel (non-blocking — empty string on failure)
    const images = await Promise.all(
      shoes.map((shoe) =>
        getShoeImage(`${shoe.brand} ${shoe.name} ${shoe.colorway} sneaker`)
      )
    );

    const results = shoes.map((shoe, i) => ({
      ...shoe,
      thumbnail: images[i] || "",
    }));

    return NextResponse.json({ results });
  } catch (err) {
    console.error("Search error:", err);
    return NextResponse.json({ results: [] });
  }
}
