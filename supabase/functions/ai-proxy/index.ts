import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Limits per user per 24 hours
const LIMIT_GEMINI = 20;
const LIMIT_BRAPI = 100;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Check Auth Header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Unauthorized: Missing Authorization header');
    }
    const token = authHeader.replace('Bearer ', '');

    // Setup Supabase Client
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    // Verify User
    const supabaseUserClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    
    const { data: { user }, error: userError } = await supabaseUserClient.auth.getUser(token);
    if (userError || !user) {
      throw new Error(`Unauthorized: ${userError?.message || 'Invalid user'}`);
    }

    const { action, payload } = await req.json();

    // Check Rate Limits using Service Role (to bypass RLS for counting logs quickly)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const group = action.startsWith('brapi') ? 'brapi' : 'gemini';
    const limit = group === 'gemini' ? LIMIT_GEMINI : LIMIT_BRAPI;

    const { count, error: countError } = await supabaseAdmin
      .from('api_usage_logs')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .like('action', `${group}%`)
      .gte('created_at', yesterday);

    if (countError) {
      throw new Error(`Error checking rate limit: ${countError.message}`);
    }

    if (count !== null && count >= limit) {
      return new Response(
        JSON.stringify({ error: `Rate limit exceeded. You have reached your limit of ${limit} requests per day for ${group}.` }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Process the Request
    const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY');
    const BRAPI_KEY = Deno.env.get('BRAPI_API_KEY');
    let apiResponse: Response;

    switch (action) {
      case 'gemini': {
        if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY not configured.');
        apiResponse = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          }
        );
        break;
      }
      case 'brapi-quote': {
        if (!BRAPI_KEY) throw new Error('BRAPI_API_KEY not configured.');
        const { tickers } = payload;
        if (!tickers || !tickers.length) throw new Error('tickers required for brapi-quote.');
        apiResponse = await fetch(
          `https://brapi.dev/api/quote/${tickers.join(',')}?token=${BRAPI_KEY}`
        );
        break;
      }
      case 'brapi-chart': {
        if (!BRAPI_KEY) throw new Error('BRAPI_API_KEY not configured.');
        const { ticker, range, interval } = payload;
        if (!ticker) throw new Error('ticker required for brapi-chart.');
        apiResponse = await fetch(
          `https://brapi.dev/api/quote/${ticker}?range=${range || '1d'}&interval=${interval || '5m'}&token=${BRAPI_KEY}`
        );
        break;
      }
      default:
        throw new Error(`Unknown action: ${action}`);
    }

    // Log the successful usage (only when the upstream API actually returned data)
    if (apiResponse.ok) {
      await supabaseAdmin.from('api_usage_logs').insert({
        user_id: user.id,
        action: action
      });
    }

    const responseBody = await apiResponse.text();
    return new Response(responseBody, {
      status: apiResponse.status,
      headers: {
        ...corsHeaders,
        'Content-Type': apiResponse.headers.get('Content-Type') || 'application/json',
      },
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal proxy error';
    const status = message.includes('Unauthorized') ? 401 : 400;
    return new Response(
      JSON.stringify({ error: message }),
      { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
