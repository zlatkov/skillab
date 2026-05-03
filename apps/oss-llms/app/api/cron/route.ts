import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { fetchAllProviders } from '@/lib/fetcher';

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: run, error: insertError } = await supabase
    .from('cron_runs')
    .insert({ status: 'running' })
    .select()
    .single();

  if (insertError || !run) {
    return NextResponse.json({ error: 'Failed to create run record' }, { status: 500 });
  }

  try {
    const { entries, providerResults, errors } = await fetchAllProviders();

    // Batch insert in chunks to avoid request size limits
    const CHUNK = 500;
    for (let i = 0; i < entries.length; i += CHUNK) {
      const chunk = entries.slice(i, i + CHUNK).map(e => ({
        run_id: run.id,
        model_id: e.modelId,
        model_name: e.modelName,
        family: e.family,
        params: e.params,
        provider_id: e.providerId,
        provider_model_id: e.providerModelId,
        input_price: e.inputPrice,
        output_price: e.outputPrice,
        free_tier: e.freeTier,
        context_length: e.contextLength,
        rpm: e.rpm,
        tpm: e.tpm,
        rpd: e.rpd,
        quantization: e.quantization,
        source: e.source,
      }));

      const { error: chunkError } = await supabase
        .from('model_snapshots')
        .upsert(chunk, { onConflict: 'run_id,model_id,provider_id', ignoreDuplicates: true });
      if (chunkError) {
        errors.push(`insert chunk ${i}: ${chunkError.message}`);
      }
    }

    await supabase.from('cron_runs').update({
      status: 'complete',
      completed_at: new Date().toISOString(),
      entries_count: entries.length,
      providers_count: Object.keys(providerResults).length,
      error: errors.length > 0 ? errors.join('; ') : null,
    }).eq('id', run.id);

    return NextResponse.json({ ok: true, count: entries.length, providers: providerResults });
  } catch (err) {
    await supabase.from('cron_runs').update({
      status: 'error',
      completed_at: new Date().toISOString(),
      error: String(err),
    }).eq('id', run.id);

    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
