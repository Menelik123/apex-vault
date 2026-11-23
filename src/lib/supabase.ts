import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type InventoryItem = {
  id: string;
  user_id: string;
  brand: string;
  model: string;
  colorway: string | null;
  size: string | null;
  condition: string;
  cost: number | null;
  asking_price: number | null;
  upc: string | null;
  photo_url: string | null;
  notes: string | null;
  sold: boolean;
  sold_price: number | null;
  sale_channel: string | null;
  purchased_from: string | null;
  created_at: string;
};

export type Expense = {
  id: string;
  user_id: string;
  description: string;
  amount: number;
  category: string;
  date: string;
  notes: string | null;
  created_at: string;
};
