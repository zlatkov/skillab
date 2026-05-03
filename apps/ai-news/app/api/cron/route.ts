import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { runNewsAgent } from '@/lib/agent';
import { langfuseSpanProcessor } from '@/instrumentation';

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: run, error: insertError } = await supabase
    .from('news_runs')
    .insert({ status: 'running' })
    .select()
    .single();

  if (insertError || !run) {
    return NextResponse.json({ error: 'Failed to create run record' }, { status: 500 });
  }

  try {
    const items = await runNewsAgent();

    await supabase
      .from('news_runs')
      .update({ status: 'complete', items, item_count: items.length })
      .eq('id', run.id);

    await langfuseSpanProcessor?.forceFlush();
    return NextResponse.json({ ok: true, count: items.length });
  } catch (err) {
    await supabase
      .from('news_runs')
      .update({ status: 'error', error: String(err) })
      .eq('id', run.id);

    await langfuseSpanProcessor?.forceFlush();
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
