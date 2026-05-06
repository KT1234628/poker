import { Connection } from '@solana/web3.js';
import { NextResponse } from 'next/server';
import { vaultTokenAccountPda } from '@/lib/solana/vault';
import { supabaseAdmin } from '@/lib/supabase/server';

// Public audit endpoint: shows the on-chain vault balance vs. total credited chips.
// If `vault_balance < credited_total`, the operator is insolvent.
export async function GET() {
  const admin = supabaseAdmin();
  const [credited, vaultBal] = await Promise.all([
    admin
      .from('balances')
      .select('chips_sum:chips.sum(), locked_sum:locked_chips.sum()')
      .returns<{ chips_sum: number | null; locked_sum: number | null }[]>(),
    (async () => {
      try {
        const conn = new Connection(process.env.NEXT_PUBLIC_SOLANA_RPC ?? 'https://api.mainnet-beta.solana.com', 'confirmed');
        const [pda] = vaultTokenAccountPda();
        const r = await conn.getTokenAccountBalance(pda);
        return Number(r.value.amount);
      } catch {
        return 0;
      }
    })(),
  ]);
  const total = (credited.data?.[0]?.chips_sum ?? 0) + (credited.data?.[0]?.locked_sum ?? 0);

  return NextResponse.json({
    vault_total_user_balance: total,
    vault_onchain_balance: vaultBal,
    solvent: vaultBal >= total,
    timestamp: new Date().toISOString(),
  });
}
